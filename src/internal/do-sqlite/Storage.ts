import { Data, Result, Schema } from "effect"
import { JobPolicyIncompatible } from "../../JobContract.js"
import { EpochMillis, maximumMillis, type JobPolicy } from "../../JobPolicy.js"
import { JobStoreProtocolError } from "../../JobStore.js"

type SqlValue = ArrayBuffer | string | number | null
export type JobRow = Record<string, SqlValue>

export interface SqlStorage {
  exec<Row extends JobRow>(
    query: string,
    ...bindings: ReadonlyArray<SqlValue | ArrayBufferView>
  ): { toArray(): Row[]; one(): Row }
}

export interface Storage {
  readonly sql: SqlStorage
  transactionSync<A>(body: () => A): A
  sync(): Promise<void>
}

export interface TransactionStorage {
  readonly sql: SqlStorage
  transaction<A>(body: () => Promise<A>): Promise<A>
}

// SQL for application-owned migrations. Importing or constructing the adapter runs no DDL.
export const ddl = `
  CREATE TABLE IF NOT EXISTS jobs (
    jobId TEXT PRIMARY KEY NOT NULL,
    queue TEXT NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL,
    operation TEXT NOT NULL, operationId TEXT NOT NULL, slot TEXT NOT NULL,
    policy TEXT NOT NULL, initialAvailableAt INTEGER,
    state TEXT NOT NULL, availableAt INTEGER NOT NULL, createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL, finalizedAttempts INTEGER NOT NULL,
    stalledCount INTEGER NOT NULL, lifecycleVersion INTEGER NOT NULL,
    leaseToken TEXT UNIQUE, leaseExpiresAt INTEGER, completedAt INTEGER,
    lastFailureCode TEXT, finalizationReceipt TEXT,
    UNIQUE (operation, operationId, slot)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS payloads (
    jobId TEXT PRIMARY KEY NOT NULL REFERENCES jobs(jobId),
    formatVersion INTEGER NOT NULL, payload BLOB NOT NULL, projection BLOB NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS due ON jobs(queue, availableAt, jobId)
    WHERE state IN ('Pending','RetryScheduled');
  CREATE INDEX IF NOT EXISTS expired ON jobs(queue, leaseExpiresAt, jobId)
    WHERE state = 'Active';
`

export class SqliteSqlFault extends Data.TaggedError("SqliteSqlFault")<{}> {}

// Include cursor consumption in this FFI boundary: workerd may step SQL there.
export const attemptSql = <A>(run: () => A): Result.Result<A, SqliteSqlFault> => {
  try {
    return Result.succeed(run())
  } catch {
    return Result.fail(new SqliteSqlFault())
  }
}

export const storageTime = (sql: SqlStorage) =>
  Result.gen(function* () {
    const { now } = yield* attemptSql(() =>
      sql
        .exec<{ now: SqlValue }>(
          "SELECT CAST(round(unixepoch('subsec') * 1000) AS INTEGER) AS now"
        )
        .one()
    )
    return Schema.is(EpochMillis)(now)
      ? now
      : yield* Result.fail(new JobStoreProtocolError({ reason: "invalid-artifact" }))
  })

// Admission and claim share the same lease constraints. Claim rechecks them
// against its own SQLite time and the worker's current response budget.
export const incompatiblePolicy = (
  policy: JobPolicy,
  now: number,
  operationResponseBudgetMillis: number
) => {
  const reserveMillis = policy.leaseDurationMillis - policy.attemptTimeoutMillis
  if (reserveMillis < operationResponseBudgetMillis) {
    return new JobPolicyIncompatible({
      reserveMillis,
      requiredMillis: operationResponseBudgetMillis
    })
  }
  if (policy.leaseDurationMillis > maximumMillis - now) {
    return new JobPolicyIncompatible()
  }
  return undefined
}
