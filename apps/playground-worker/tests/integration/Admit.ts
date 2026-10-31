// Test-only app fixture. Use the public native transaction/enqueue APIs; never write lifecycle SQL.
// @effect-diagnostics unstableApiUsage:off
import { Duration, Effect, Redacted } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import * as Policy from "effect-jobs/JobPolicy"
import * as Event from "../../src/execution/Event.js"
import * as Plan from "../../src/scenarios/Plan.js"
import { Application } from "../../../website/src/server/Services.js"
import * as Retry from "effect-jobs/JobRetryPolicy"
export const delayed = (config: Event.Config, credential: string, requestId: string) =>
  Event.run(
    config,
    Effect.void,
    Effect.gen(function* () {
      const app = yield* Application
      const access = yield* app.authenticate(Redacted.make(credential))
      const backend = yield* PostgreSqlJobs
      const sql = yield* SqlClient
      return yield* backend.withTransaction(() =>
        Effect.gen(function* () {
          const rows = yield* sql.unsafe<{ now: string }>(
            `SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now FROM "${config.schema}".sandboxes WHERE sandbox_id=$1 AND generation=$2 AND expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint FOR UPDATE`,
            [access.sandbox.ref.sandboxId, access.sandbox.ref.generation]
          )
          if (!rows.length) {
            return yield* Effect.die("fixture authority unavailable")
          }
          const [job] = yield* Plan.plan(
            { sandbox: access.sandbox.ref, requestId, scenario: "success", count: 1 },
            access.sandbox.ref,
            0,
            Number(rows[0]!.now) + 2000
          )
          const policy = yield* Policy.make({
            leaseDuration: Duration.millis(1800),
            attemptTimeout: Duration.millis(200),
            retry: Retry.fixed(Duration.millis(500)).pipe(Retry.maxAttempts(3))
          })
          const result = yield* Plan.enqueue({ ...job!, policy })
          const reserved = yield* sql.unsafe(
            `UPDATE "${config.schema}".sandboxes SET retained_jobs=retained_jobs+1 WHERE sandbox_id=$1 AND retained_jobs<100 RETURNING sandbox_id`,
            [access.sandbox.ref.sandboxId]
          )
          if (!reserved.length) {
            return yield* Effect.die("fixture quota unavailable")
          }
          yield* sql.unsafe(
            `INSERT INTO "${config.schema}".associations VALUES ($1,$2,$3,'{}'::jsonb)`,
            [access.sandbox.ref.sandboxId, access.sandbox.ref.generation, result.jobId]
          )
          return result.jobId
        })
      )
    })
  )
