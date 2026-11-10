// Real-PG reproduction uses the same app-owned unstable SQL boundary as Event.
// @effect-diagnostics unstableApiUsage:off
import { Cause, Effect, Exit } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import * as Event from "../../src/execution/Event.js"
import * as Demo from "../../src/demo/Manager.js"
import * as Executor from "../../src/execution/Executor.js"
import * as Runtime from "effect-jobs/JobWorkerRuntime"
export { migrations } from "../../src/persistence/MigrationRegistry.js"
export const prepare = (config: Event.Config) =>
  Event.run(
    config,
    Effect.void,
    Effect.gen(function* () {
      yield* Demo.tick(config.schema)
      for (const consumer of yield* Executor.consumers) {
        yield* Runtime.drain(consumer)
      }
      return yield* Demo.tick(config.schema)
    })
  )
export const tick = (config: Event.Config) =>
  Event.run(
    config,
    Effect.void,
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const [row] = yield* sql.unsafe<{ retained_jobs: unknown }>(
        `SELECT retained_jobs FROM "${config.schema}".sandboxes WHERE demo_owned`
      )
      const exit = yield* Effect.exit(Demo.tick(config.schema))
      const result = Exit.isSuccess(exit)
        ? exit.value
        : {
            phase: "defect",
            reasons: exit.cause.reasons.map((reason) =>
              Cause.isDieReason(reason)
                ? { type: "Die", message: String(reason.defect) }
                : { type: reason._tag }
            )
          }
      return {
        retainedJobs: String(row!.retained_jobs),
        driverType: typeof row!.retained_jobs,
        result
      }
    })
  )

export { batch, maxRetainedJobs } from "../../src/demo/Traffic.js"
