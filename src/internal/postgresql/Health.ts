import { Effect, Result, Schema } from "effect"
import { CatalogIdentity, QueueName } from "../../JobIdentity.js"
import { BatchLimit } from "../../JobLifecycle.js"
import { JobStoreProtocolError } from "../../JobStore.js"
import { observe, recordHealth } from "../../JobTelemetry.js"
import { dbTime } from "./Rows.js"
import type { ApplicationAdapter, PostgreSqlError } from "../../PostgreSqlTransaction.js"

/** One explicit reporter per storage/queue. Counts are bounded lower bounds,
 * never a page count presented as a global exact queue depth. */
export interface HealthRequest {
  readonly queue: string
  readonly supportedCatalog: ReadonlyArray<CatalogIdentity>
  readonly limit: number
}
export interface HealthBucket {
  readonly count: number
  readonly saturated: boolean
  readonly oldestAt: number | null
}
export interface HealthSample {
  readonly sampledAt: number
  readonly supported: HealthBucket
  readonly unsupported: HealthBucket
  readonly expired: HealthBucket
  readonly cleanup: HealthBucket
}
const Request = Schema.Struct({
  queue: QueueName,
  supportedCatalog: Schema.Array(CatalogIdentity).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(500))
  ),
  limit: BatchLimit
})
export const makeHealth = (adapter: ApplicationAdapter, jobs: string) => ({
  sample: (
    input: HealthRequest
  ): Effect.Effect<HealthSample, PostgreSqlError | JobStoreProtocolError> =>
    Effect.gen(function* () {
      const decoded = Schema.decodeResult(Request)(input)
      if (
        Result.isFailure(decoded) ||
        !decoded.success.supportedCatalog.every(
          (catalog) => catalog.queue === decoded.success.queue
        )
      ) {
        return yield* new JobStoreProtocolError({ reason: "invalid-input" })
      }
      const request = decoded.success
      const sample = yield* adapter.ownedTransaction((query) =>
        Effect.gen(function* () {
          const now = yield* dbTime(query)
          const values: Array<unknown> = [request.queue, now, request.limit + 1]
          const catalogs = request.supportedCatalog
            .map((catalog) => {
              values.push(catalog.kind, catalog.version)
              return `(kind=$${values.length - 1} AND version=$${values.length})`
            })
            .join(" OR ")
          const bucket = (condition: string, column: string) =>
            query
              .query(
                `SELECT ${column} AS oldest_at FROM ${jobs} WHERE queue=$1 AND ${condition} ORDER BY ${column},id LIMIT $3`,
                values
              )
              .pipe(
                Effect.flatMap((rows) => {
                  const oldest = rows[0]?.oldest_at
                  const timestamp = oldest === undefined ? null : Number(oldest)
                  if (
                    timestamp !== null &&
                    (!Number.isSafeInteger(timestamp) || timestamp < 0)
                  ) {
                    return Effect.fail(
                      new JobStoreProtocolError({ reason: "invalid-artifact" })
                    )
                  }
                  return Effect.succeed({
                    count: Math.min(rows.length, request.limit),
                    saturated: rows.length > request.limit,
                    oldestAt: timestamp
                  } satisfies HealthBucket)
                })
              )
          const supported = yield* bucket(
            `state IN ('Pending','RetryScheduled') AND available_at <= $2 AND (${catalogs})`,
            "available_at"
          )
          const unsupported = yield* bucket(
            `state IN ('Pending','RetryScheduled') AND available_at <= $2 AND NOT (${catalogs})`,
            "available_at"
          )
          // Include catalog parameters in every query to retain exact bind arity.
          const allCatalogs = `AND ((${catalogs}) OR NOT (${catalogs}))`
          const expired = yield* bucket(
            `state='Active' AND lease_expires_at <= $2 ${allCatalogs}`,
            "lease_expires_at"
          )
          const cleanup = yield* bucket(
            `state IN ('Completed','Dead') AND cleanup_at <= $2 ${allCatalogs}`,
            "cleanup_at"
          )
          return { sampledAt: now, supported, unsupported, expired, cleanup }
        })
      )
      yield* recordHealth(sample)
      return sample
    }).pipe(observe("health", "maintenance"))
})
