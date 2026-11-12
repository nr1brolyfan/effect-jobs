import { definitions as eventDefinitions } from "../scenarios/Setup.js"
// @effect-diagnostics unstableApiUsage:off
// Finite real-PG qualification helpers. No resource acquisition on import.
import { Effect, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import * as Producer from "effect-jobs/JobProducer"
import * as Codec from "effect-jobs/JobPayloadCodec"
import { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import * as Definitions from "../../src/scenarios/Definitions.js"
import * as Event from "../../src/execution/Event.js"
export { prepareRecorded, drainRecorded } from "./RepairPg.js"

export const seed = (
  config: Event.Config,
  input: unknown,
  behavior: Definitions.Behavior,
  note: string
) =>
  Effect.runPromise(
    Event.run(
      config,
      Effect.void,
      Effect.gen(function* () {
        const definitions = yield* Definitions.Definitions
        const ref = yield* Schema.decodeUnknownEffect(SandboxRef)(input)
        const sql = yield* SqlClient
        const jobs = yield* PostgreSqlJobs
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const payload: Definitions.SyntheticExportPayload = {
              sandbox: ref,
              version: 1,
              seed: 123,
              sequence: 1,
              behavior,
              actor: "demo-customer",
              tenant: "demo-tenant-a",
              order: "demo-order-a",
              document: { subject: "demo-customer", tenant: "demo-tenant-a", note }
            }
            const producer = yield* Producer.make(
              "playground.correction-qualification"
            ).pipe(
              Producer.withSlot("document", definitions.SyntheticDocumentExport, {
                queue: definitions.PrivateDataQueue
              })
            )
            const result = yield* producer
              .enqueue({ operationId: crypto.randomUUID(), slot: "document", payload })
              .pipe(Effect.provideService(JobEnqueue, jobs.producer))
            yield* sql.unsafe(
              `INSERT INTO "${config.schema}".associations(sandbox_id,generation,job_id,relations) VALUES($1,$2,$3,$4::jsonb)`,
              [
                ref.sandboxId,
                ref.generation,
                result.jobId,
                JSON.stringify({
                  syntheticActor: payload.actor,
                  syntheticTenant: payload.tenant,
                  syntheticOrderId: payload.order
                })
              ]
            )
            yield* sql.unsafe(
              `UPDATE "${config.schema}".sandboxes SET retained_jobs=retained_jobs+1 WHERE sandbox_id=$1`,
              [ref.sandboxId]
            )
            return result.jobId
          })
        )
      }),
      eventDefinitions
    ).pipe(Effect.timeout("30 seconds"))
  )

export const decodeArtifact = (payload: Uint8Array, projection: Uint8Array) =>
  Effect.runPromise(
    Codec.decodeJobPayload(eventDefinitions.SyntheticExportPayload, {
      formatVersion: 1,
      payloadBytes: new Uint8Array(payload),
      semanticProjectionBytes: new Uint8Array(projection)
    })
  )
