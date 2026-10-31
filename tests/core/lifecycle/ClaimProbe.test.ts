import { Cause, Effect } from "effect"
import { expect, it } from "vitest"
import { ClaimResults } from "../../../src/JobStore.js"
import { makeStore } from "../../../src/internal/postgresql/Store.js"
import {
  PostgreSqlFailure,
  PostgreSqlInvalidHandle
} from "../../../src/PostgreSqlTransaction.js"
import type {
  ApplicationAdapter,
  PostgreSqlError,
  TransactionQuery
} from "../../../src/PostgreSqlTransaction.js"
import { now, pending, prepared, request } from "./fixtures.js"

const row = () => {
  const snapshot = pending()
  const artifact = prepared()
  return {
    id: snapshot.jobId,
    policy: snapshot.policy,
    state: snapshot.state,
    available_at: snapshot.availableAt,
    updated_at: snapshot.updatedAt,
    created_at: null,
    attempts_made: snapshot.attemptsMade,
    stalled_count: snapshot.stalledCount,
    lifecycle_version: snapshot.lifecycleVersion,
    lease_token: null,
    lease_expires_at: null,
    completed_at: null,
    last_failure_code: null,
    queue: artifact.catalog.queue,
    kind: artifact.catalog.kind,
    version: artifact.catalog.version,
    operation: artifact.producer.operation,
    slot: artifact.producer.slot,
    operation_id: artifact.producer.operationId,
    initial_available_at: null,
    format_version: artifact.encoded.formatVersion,
    payload: artifact.encoded.payloadBytes,
    projection: artifact.encoded.semanticProjectionBytes
  }
}

const unknown = new PostgreSqlFailure({ commitKnowledge: "Unknown" })
const notCommitted = new PostgreSqlFailure({ commitKnowledge: "NotCommitted" })
const invalidHandle = new PostgreSqlInvalidHandle({ reason: "inactive-handle" })
const defect = new Error("probe defect")
const failures: ReadonlyArray<readonly [string, Cause.Cause<PostgreSqlError>]> = [
  ["unknown commit", Cause.fail(unknown)],
  ["known failure", Cause.fail(notCommitted)],
  ["unhandled tag", Cause.fail(invalidHandle)],
  ["defect", Cause.die(defect)],
  ["interruption", Cause.interrupt()],
  [
    "mixed failure and defect",
    Cause.fromReasons([Cause.makeFailReason(unknown), Cause.makeDieReason(defect)])
  ],
  [
    "mixed failure and interruption",
    Cause.fromReasons([Cause.makeFailReason(unknown), Cause.makeInterruptReason()])
  ]
]

it.each(failures)(
  "preserves claim probe recovery for %s without replay",
  async (_name, cause) => {
    let transactions = 0
    let writes = 0
    const query: TransactionQuery = {
      query: (sql) => {
        if (transactions === 2) {
          return Effect.failCause(cause)
        }
        if (sql.startsWith("SELECT floor")) {
          return Effect.succeed([{ now }])
        }
        if (sql.startsWith("SELECT j.*")) {
          return Effect.succeed([row()])
        }
        if (sql.startsWith("UPDATE")) {
          writes++
          return Effect.succeed([])
        }
        return Effect.die("unexpected query")
      }
    }
    const adapter: ApplicationAdapter = {
      validate: () => Effect.succeed(query),
      withTransaction: (body) => body({}),
      ownedTransaction: (body) =>
        Effect.suspend(() => {
          transactions++
          return body(query)
        })
    }
    const actual = await Effect.runPromiseExit(
      makeStore(adapter, "jobs", "payloads", 10).claim(request)
    )
    // Frozen original recovery operator is the differential oracle, including
    // Effect's handling of compound Causes; no database/commit guarantee is inferred.
    const expected = await Effect.runPromiseExit(
      Effect.failCause(cause).pipe(
        Effect.catchTags({
          PostgreSqlFailure: () => Effect.succeed(ClaimResults.Unknown())
        })
      )
    )
    expect(actual).toEqual(expected)
    expect(transactions).toBe(2)
    expect(writes).toBe(1)
  }
)
