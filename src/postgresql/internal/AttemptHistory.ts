import { Effect, Schema } from "effect"
import { FailureCode } from "../../FailureCode.js"
import { JobId } from "../../JobId.js"
import { BatchLimit, Counter, type JobSnapshot } from "../../JobLifecycle.js"
import { EpochMillis } from "../../JobPolicy.js"
import { JobStoreProtocolError } from "../../JobStore.js"
import { PostgreSqlConfigurationError } from "../PostgreSqlSchema.js"
import {
  PostgreSqlFailure,
  type ApplicationAdapter,
  type PostgreSqlError,
  type TransactionQuery
} from "../PostgreSqlTransaction.js"
import { dbTime, Integer } from "./Rows.js"

const PositiveCounter = Counter.pipe(Schema.check(Schema.isGreaterThan(0)))
const Capture = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("off") }),
  Schema.Struct({
    mode: Schema.Literals(["problems", "all"]),
    ttlMillis: PositiveCounter
  })
])

/** Per-instance capture settings. Omitted settings default to off.
 * @category models
 */
export type AttemptHistoryCapture =
  | { readonly mode: "off" }
  | { readonly mode: "problems" | "all"; readonly ttlMillis: number }

const decodeCapture = Schema.decodeEffect(Capture, { onExcessProperty: "error" })
export const captureSettings = (input: AttemptHistoryCapture | undefined) =>
  decodeCapture(input === undefined ? { mode: "off" } : input).pipe(
    Effect.mapError(() => new PostgreSqlConfigurationError({ field: "attemptHistory" }))
  )

const common = {
  jobId: JobId,
  lifecycleVersion: Integer.pipe(Schema.decodeTo(PositiveCounter)),
  occurredAt: Integer.pipe(Schema.decodeTo(EpochMillis))
}
const finalizedAttempt = Integer.pipe(Schema.decodeTo(PositiveCounter))
const HistoryRow = Schema.Union([
  Schema.Struct({
    ...common,
    kind: Schema.Literal("Finalization"),
    state: Schema.Literal("Completed"),
    finalizedAttempt,
    failureCode: Schema.Null,
    retryAt: Schema.Null
  }).pipe(Schema.encodeKeys({ finalizedAttempt: "ordinal" })),
  Schema.Struct({
    ...common,
    kind: Schema.Literal("Finalization"),
    state: Schema.Literal("RetryScheduled"),
    finalizedAttempt,
    failureCode: FailureCode,
    retryAt: Integer.pipe(Schema.decodeTo(EpochMillis))
  }).pipe(Schema.encodeKeys({ finalizedAttempt: "ordinal" })),
  Schema.Struct({
    ...common,
    kind: Schema.Literal("Finalization"),
    state: Schema.Literals(["Dead", "Isolated"]),
    finalizedAttempt,
    failureCode: FailureCode,
    retryAt: Schema.Null
  }).pipe(Schema.encodeKeys({ finalizedAttempt: "ordinal" })),
  Schema.Struct({
    ...common,
    kind: Schema.Literal("LeaseRecovery"),
    state: Schema.Literals(["Pending", "Dead"]),
    stalledCount: Integer.pipe(Schema.decodeTo(PositiveCounter)),
    failureCode: FailureCode.pipe(Schema.NullOr)
  }).pipe(Schema.encodeKeys({ stalledCount: "ordinal" }))
])

/** Persisted worker outcome projected onto the stable operational read contract.
 * @category models
 */
export type AttemptHistoryEntry = {
  readonly jobId: JobId
  readonly lifecycleVersion: number
  /** Sampled database time in Unix epoch milliseconds. */
  readonly occurredAt: number
} & (
  | ({
      readonly kind: "Finalization"
      /** Persisted finalization ordinal, starting at 1. */
      readonly finalizedAttempt: number
    } & (
      | {
          readonly state: "Completed"
          readonly failureCode: null
          readonly retryAt: null
        }
      | {
          readonly state: "RetryScheduled"
          readonly failureCode: FailureCode
          readonly retryAt: number
        }
      | {
          readonly state: "Dead" | "Isolated"
          readonly failureCode: FailureCode
          readonly retryAt: null
        }
    ))
  | {
      readonly kind: "LeaseRecovery"
      readonly state: "Pending" | "Dead"
      readonly stalledCount: number
      readonly failureCode: FailureCode | null
    }
)

const Cursor = Schema.String.pipe(Schema.brand("effect-jobs/AttemptHistoryCursor"))
const cursor = Schema.decodeSync(Cursor)
/** Opaque continuation. Pass it back for the same job.
 * @category models
 */
export type AttemptHistoryCursor = typeof Cursor.Type

const ReadRequest = Schema.Struct({
  jobId: JobId,
  limit: BatchLimit,
  before: Cursor.pipe(Schema.optionalKey)
})
/** Reads up to 500 unexpired entries for one job.
 * @category models
 */
export interface AttemptHistoryRead {
  readonly jobId: JobId
  readonly limit: number
  readonly before?: AttemptHistoryCursor
}

/** Descending version page. Entries may expire or be removed between reads.
 * @category models
 */
export interface AttemptHistoryPage {
  readonly entries: ReadonlyArray<AttemptHistoryEntry>
  readonly nextCursor: AttemptHistoryCursor | null
}

/** Explicit PostgreSQL history reads and retention maintenance.
 * @category models
 */
export interface AttemptHistoryService {
  readonly read: (
    request: AttemptHistoryRead
  ) => Effect.Effect<AttemptHistoryPage, PostgreSqlError | JobStoreProtocolError>
  readonly cleanup: (
    limit: number
  ) => Effect.Effect<number, PostgreSqlError | JobStoreProtocolError>
}

const invalidInput = () => new JobStoreProtocolError({ reason: "invalid-input" })
const invalidArtifact = () => new JobStoreProtocolError({ reason: "invalid-artifact" })
const decodeRead = Schema.decodeEffect(ReadRequest, { onExcessProperty: "error" })
const decodeLimit = Schema.decodeEffect(BatchLimit)
const decodeHistory = Schema.decodeUnknownEffect(HistoryRow)

export const makeAttemptHistory = (
  adapter: ApplicationAdapter,
  history: Effect.Effect<string, JobStoreProtocolError>
): AttemptHistoryService => ({
  read: (input) =>
    Effect.gen(function* () {
      const request = yield* decodeRead(input).pipe(Effect.mapError(invalidInput))
      let before: number | null = null
      if (request.before !== undefined) {
        const prefix = `v1:${request.jobId}:`
        const key = request.before.slice(prefix.length)
        const version = Number(key)
        if (
          !request.before.startsWith(prefix) ||
          !Schema.is(PositiveCounter)(version) ||
          String(version) !== key
        ) {
          return yield* invalidInput()
        }
        before = version
      }
      const relation = yield* history
      return yield* adapter.ownedTransaction((query) =>
        Effect.gen(function* () {
          const now = yield* dbTime(query)
          const params: Array<unknown> = [request.jobId, now, request.limit + 1]
          const boundary = before === null ? "" : "AND lifecycle_version < $4"
          if (before !== null) {
            params.push(before)
          }
          const rows = yield* query.query(
            `SELECT job_id AS "jobId", lifecycle_version AS "lifecycleVersion",
                occurred_at AS "occurredAt", kind, state, failure_code AS "failureCode",
                retry_at AS "retryAt", ordinal
             FROM ${relation} WHERE job_id=$1 AND expires_at > $2 ${boundary}
             ORDER BY lifecycle_version DESC LIMIT $3`,
            params
          )
          const entries = yield* Effect.forEach(rows.slice(0, request.limit), (row) =>
            decodeHistory(row)
          ).pipe(Effect.mapError(invalidArtifact))
          const last = entries.at(-1)
          return {
            entries,
            nextCursor:
              rows.length > request.limit && last !== undefined
                ? cursor(`v1:${request.jobId}:${last.lifecycleVersion}`)
                : null
          }
        })
      )
    }),
  cleanup: (input) =>
    Effect.gen(function* () {
      const limit = yield* decodeLimit(input).pipe(Effect.mapError(invalidInput))
      const relation = yield* history
      return yield* adapter.ownedTransaction((query) =>
        Effect.gen(function* () {
          const now = yield* dbTime(query)
          const rows = yield* query.query(
            `WITH expired AS (
               SELECT job_id,lifecycle_version FROM ${relation}
               WHERE expires_at <= $1 ORDER BY expires_at,job_id,lifecycle_version
               LIMIT $2 FOR UPDATE SKIP LOCKED
             )
             DELETE FROM ${relation} h USING expired e
             WHERE h.job_id=e.job_id AND h.lifecycle_version=e.lifecycle_version RETURNING 1`,
            [now, limit]
          )
          return rows.length
        })
      )
    })
})

export const makeHistoryWriter =
  (relation: string, settings: Exclude<AttemptHistoryCapture, { mode: "off" }>) =>
  (query: TransactionQuery, kind: AttemptHistoryEntry["kind"], after: JobSnapshot) =>
    kind === "Finalization" && after.state === "Completed" && settings.mode === "problems"
      ? Effect.void
      : query
          .query(
            `INSERT INTO ${relation}
          (job_id,lifecycle_version,occurred_at,kind,state,ordinal,failure_code,retry_at,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$3::bigint + $9::bigint)`,
            [
              after.jobId,
              after.lifecycleVersion,
              after.updatedAt,
              kind,
              after.state,
              kind === "Finalization" ? after.finalizedAttempts : after.stalledCount,
              after.lastFailureCode,
              after.state === "RetryScheduled" ? after.availableAt : null,
              settings.ttlMillis
            ]
          )
          .pipe(Effect.asVoid)

export const readyHistory = (
  adapter: ApplicationAdapter,
  jobs: string,
  history: string
) =>
  adapter.ownedTransaction((query) =>
    Effect.gen(function* () {
      const [result] = yield* query.query(
        `WITH relation AS (
           SELECT c.oid FROM pg_catalog.pg_class c
           WHERE c.oid=pg_catalog.to_regclass($1) AND c.relkind='r'
         ), attrs AS (
           SELECT attname::text AS name, attnum, atttypid, attnotnull, attgenerated, attidentity
           FROM pg_catalog.pg_attribute JOIN relation ON attrelid=relation.oid
           WHERE attnum>0 AND NOT attisdropped
         )
         SELECT
           (SELECT count(*)=9 AND bool_and(
             a.name IS NOT NULL AND atttypid=e.ty::regtype AND attnotnull=e.required
             AND attgenerated='' AND attidentity <> 'a'
           ) FROM (VALUES
             ('job_id','text',true), ('lifecycle_version','bigint',true),
             ('occurred_at','bigint',true), ('expires_at','bigint',true),
             ('kind','text',true), ('state','text',true), ('ordinal','bigint',true),
             ('failure_code','text',false), ('retry_at','bigint',false)
           ) e(name,ty,required) FULL JOIN attrs a USING (name)) AS columns,
           EXISTS (SELECT 1 FROM pg_catalog.pg_constraint JOIN relation ON conrelid=relation.oid
             WHERE contype='p' AND conkey=ARRAY[
               (SELECT attnum FROM attrs WHERE name='job_id'),
               (SELECT attnum FROM attrs WHERE name='lifecycle_version')
             ]) AS pk,
           EXISTS (SELECT 1 FROM pg_catalog.pg_constraint JOIN relation ON conrelid=relation.oid
             WHERE contype='f' AND confdeltype='c' AND convalidated AND confrelid=$2::regclass
             AND conkey=ARRAY[(SELECT attnum FROM attrs WHERE name='job_id')]
             AND confkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute
               WHERE attrelid=$2::regclass AND attname='id' AND NOT attisdropped)]) AS fk,
           EXISTS (SELECT 1 FROM pg_catalog.pg_index JOIN relation ON indrelid=relation.oid
             JOIN pg_catalog.pg_class index_class ON index_class.oid=indexrelid
             JOIN pg_catalog.pg_am access_method ON access_method.oid=index_class.relam
             WHERE access_method.amname='btree' AND indisvalid AND indisready
             AND indpred IS NULL AND indnkeyatts=3
             AND indkey[0]=(SELECT attnum FROM attrs WHERE name='expires_at')
             AND indkey[1]=(SELECT attnum FROM attrs WHERE name='job_id')
             AND indkey[2]=(SELECT attnum FROM attrs WHERE name='lifecycle_version')
             AND indoption[0]=0 AND indoption[1]=0 AND indoption[2]=0) AS expiry`,
        [history, jobs]
      )
      if (
        result?.columns !== true ||
        result.pk !== true ||
        result.fk !== true ||
        result.expiry !== true
      ) {
        return yield* new PostgreSqlFailure({
          commitKnowledge: "NotCommitted",
          readiness: {
            reason: "attempt-history-migration-required",
            check: "attempt-history"
          }
        })
      }
    })
  )
