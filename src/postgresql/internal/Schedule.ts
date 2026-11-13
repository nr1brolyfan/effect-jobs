import { Effect, Result, Schema } from "effect"
import * as Schedule from "../../JobSchedule.js"
import { CatalogIdentity, JobName, JobVersion, QueueName } from "../../JobIdentity.js"
import { BatchLimit } from "../../JobLifecycle.js"
import { EpochMillis } from "../../JobPolicy.js"
import type { ApplicationAdapter, PostgreSqlError } from "../PostgreSqlTransaction.js"
import { Integer } from "./Rows.js"

const Request = Schema.Struct({
  queue: QueueName,
  supportedCatalog: Schema.Array(CatalogIdentity).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(500))
  ),
  limit: BatchLimit
})
const Metadata = Schema.Struct({
  observedAt: Integer.pipe(Schema.decodeTo(EpochMillis)),
  nextRecoveryAt: Integer.pipe(Schema.decodeTo(EpochMillis.pipe(Schema.NullOr)))
}).pipe(Schema.encodeKeys({ observedAt: "observed_at", nextRecoveryAt: "recovery_at" }))
const Pending = Schema.Struct({
  kind: JobName,
  version: Integer.pipe(Schema.decodeTo(JobVersion)),
  availableAt: Integer.pipe(Schema.decodeTo(EpochMillis))
}).pipe(Schema.encodeKeys({ availableAt: "available_at" }))
const invalidObservation = () =>
  new Schedule.JobScheduleProtocolError({ reason: "invalid-observation" })

/** One read-only SQL snapshot. LIMIT bounds returned metadata, not total query work;
 * the qualified application's statement/operation deadline bounds source latency. */
export const makeSchedule = (
  adapter: ApplicationAdapter,
  jobs: string
): Schedule.Reader<PostgreSqlError> => ({
  read: (input) =>
    Effect.gen(function* () {
      const decoded = Schema.decodeResult(Request, { onExcessProperty: "error" })(input)
      if (
        Result.isFailure(decoded) ||
        !decoded.success.supportedCatalog.every(
          (entry) => entry.queue === decoded.success.queue
        )
      ) {
        return yield* new Schedule.JobScheduleProtocolError({ reason: "invalid-input" })
      }
      const request = {
        queue: decoded.success.queue,
        limit: decoded.success.limit,
        supportedCatalog: decoded.success.supportedCatalog.map((entry) => ({ ...entry }))
      }
      return yield* adapter.ownedTransaction((query) =>
        Effect.gen(function* () {
          const rows = yield* query.query(
            `WITH t AS MATERIALIZED (
        SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS observed_at
      ), pending AS MATERIALIZED (
        SELECT kind,version,available_at FROM ${jobs}
        WHERE queue=$1 AND state IN ('Pending','RetryScheduled')
        ORDER BY available_at,id LIMIT $2
      ) SELECT t.observed_at,p.kind,p.version,p.available_at,
        (SELECT lease_expires_at FROM ${jobs} WHERE queue=$1 AND state='Active'
         ORDER BY lease_expires_at,id LIMIT 1) AS recovery_at
        FROM t LEFT JOIN pending p ON true`,
            [request.queue, request.limit + 1]
          )
          if (rows.length === 0 || rows.length > request.limit + 1) {
            return yield* invalidObservation()
          }
          const metadata = yield* Schema.decodeUnknownEffect(Metadata)(rows[0]).pipe(
            Effect.mapError(invalidObservation)
          )
          const empty =
            rows.length === 1 &&
            rows[0]!.kind === null &&
            rows[0]!.version === null &&
            rows[0]!.available_at === null
          const supported = new Set(
            request.supportedCatalog.map((entry) => `${entry.name}\u0000${entry.version}`)
          )
          let nextAvailableAt: number | null = null
          for (const row of empty ? [] : rows.slice(0, request.limit)) {
            const pending = yield* Schema.decodeUnknownEffect(Pending)(row).pipe(
              Effect.mapError(invalidObservation)
            )
            if (supported.has(`${pending.kind}\u0000${pending.version}`)) {
              nextAvailableAt =
                nextAvailableAt === null
                  ? pending.availableAt
                  : Math.min(nextAvailableAt, pending.availableAt)
            }
          }
          return Object.freeze({
            ...metadata,
            nextAvailableAt,
            saturated: rows.length > request.limit
          })
        })
      )
    })
})
