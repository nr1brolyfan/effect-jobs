// Actual pinned Drizzle/native PgClient transaction joining; no library-owned pool.
// @effect-diagnostics unstableApiUsage:off
import { Data, Effect, Redacted } from "effect"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as Pg from "@effect/sql-pg/PgClient"
import * as Drizzle from "drizzle-orm/effect-postgres"
import * as Jobs from "effect-jobs/PostgreSqlJobs"
import * as Native from "effect-jobs/PostgreSqlNative"
import { PostgreSqlApplication } from "effect-jobs/PostgreSqlTransaction"
import type { JobOperatorExpected, JobOperatorTransition } from "effect-jobs/JobOperators"
class DrizzleProbeFailure extends Data.TaggedError("DrizzleProbeFailure")<{}> {}
export const cancel = (
  connectionString: string,
  schema: string,
  expected: JobOperatorExpected,
  rollback = false
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* Pg.make({
        url: Redacted.make(connectionString),
        maxConnections: 2,
        minConnections: 0,
        prepare: false,
        connectTimeout: "2 seconds"
      })
      const backend = yield* Jobs.make({
        schema,
        operationResponseBudgetMillis: 500
      }).pipe(
        Effect.provideService(
          PostgreSqlApplication,
          Native.make({ client, operationTimeoutMillis: 2000 })
        )
      )
      const db = yield* Drizzle.makeWithDefaults().pipe(
        Effect.provideService(Pg.PgClient, client)
      )
      const transaction: Effect.Effect<JobOperatorTransition, DrizzleProbeFailure> = db
        .transaction(() =>
          Effect.gen(function* () {
            const result = yield* backend.operators.cancel(expected)
            yield* client.unsafe(
              `INSERT INTO "${schema}".drizzle_operator_receipts(job_id,xid) VALUES ($1,txid_current())`,
              [expected.jobId]
            )
            if (rollback) {
              return yield* Effect.fail("fixture-rollback" as const)
            }
            return result
          })
        )
        .pipe(Effect.mapError(() => new DrizzleProbeFailure()))
      return yield* transaction
    })
  ).pipe(Effect.provide(Reactivity.layer))
