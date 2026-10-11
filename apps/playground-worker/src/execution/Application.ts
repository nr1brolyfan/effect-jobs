import { Effect, Layer } from "effect"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import * as Authority from "../persistence/authority/PostgreSqlAuthority.js"
import * as Commands from "../persistence/commands/Persistence.js"
import * as Executor from "./Executor.js"

/** Inert composition for the shared registrar. The application supplies one qualified
 * scoped PgClient/SqlClient and backend plus stable synthetic DocumentKeys.
 * Never acquire fresh encryption keys per event: retained jobs require the original keys.
 * This Layer neither starts a worker nor registers/runs migrations.
 */
export const layerNoDeps = (schema: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const backend = yield* PostgreSqlJobs
      const commands = Commands.layerNoDeps.pipe(
        Layer.provide(Authority.transactionsLayerNoDeps(schema)),
        Layer.provide(Layer.succeed(JobEnqueue, backend.producer))
      )
      return Layer.mergeAll(
        Authority.authorityLayerNoDeps(schema),
        commands,
        Executor.workerLayerNoDeps(schema)
      )
    })
  )
