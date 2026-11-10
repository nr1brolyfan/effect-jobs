import { Effect, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import * as Producer from "effect-jobs/JobProducer"
import * as Policy from "effect-jobs/JobPolicy"
import { JobId } from "effect-jobs/JobId"
import {
  JobRepairCommand,
  JobRepairReceiptRequest,
  JsonValue
} from "@effect-jobs/playground-contracts/Repairs"
import { PlaygroundError, JobsRead } from "@effect-jobs/playground-contracts/Services"
import type { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import { SyntheticRepairs } from "../persistence/commands/RepairPersistence.js"
import * as Definitions from "../scenarios/Definitions.js"
import * as Tables from "../persistence/authority/Schema.js"
import { maxRetainedJobs } from "./Traffic.js"

const producer = Producer.make({
  operation: "playground.synthetic-showcase",
  slots: { "encrypted-document": Definitions.SyntheticDocumentExport }
})
// Trusted maintenance only. No route accepts this capability or caller-selected flags.
// All state/attempt changes belong to producer + real worker + repair reconciliation.
export const run = (schema: string, sandbox: SandboxView) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const backend = yield* PostgreSqlJobs
    const repairs = yield* SyntheticRepairs
    const read = yield* JobsRead
    const t = Tables.relations(schema)
    const ref = sandbox.ref
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const owned = yield* sql.unsafe(
          `SELECT sandbox_id FROM ${t.sandboxes} WHERE sandbox_id=$1 AND generation=$2 AND demo_owned AND expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint FOR UPDATE`,
          [ref.sandboxId, ref.generation]
        )
        if (owned.length !== 1) {
          return yield* new PlaygroundError({ code: "not-found" })
        }
        const existing = yield* sql.unsafe(
          `SELECT id FROM ${t.jobs} WHERE operation=$1 AND operation_id=$2 AND slot='encrypted-document'`,
          [producer.operation, `${ref.sandboxId}:${ref.generation}`]
        )
        if (existing.length) {
          return
        }
        const reserved = yield* sql.unsafe(
          `UPDATE ${t.sandboxes} SET retained_jobs=retained_jobs+1 WHERE sandbox_id=$1 AND retained_jobs<$2 RETURNING sandbox_id`,
          [ref.sandboxId, maxRetainedJobs]
        )
        if (reserved.length !== 1) {
          return yield* new PlaygroundError({ code: "limit-reached" })
        }
        const payload: Definitions.SyntheticExportPayload = {
          sandbox: ref,
          version: 1,
          seed: 123,
          sequence: 1,
          behavior: "success",
          actor: "demo-customer",
          tenant: "demo-tenant-a",
          order: "demo-order-a",
          document: {
            subject: "demo-customer",
            tenant: "demo-tenant-a",
            note: "Synthetic encrypted recorded fixture"
          }
        }
        const result = yield* Definitions.SyntheticDocumentExport.enqueue({
          producer: producer.identity({
            operationId: `${ref.sandboxId}:${ref.generation}`,
            slot: "encrypted-document"
          }),
          policy: Policy.make(),
          payload
        }).pipe(Effect.provideService(JobEnqueue, backend.producer))
        yield* sql.unsafe(
          `INSERT INTO ${t.associations}(sandbox_id,generation,job_id,relations) VALUES($1,$2,$3,$4::jsonb)`,
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
      })
    )
    const request = yield* Schema.decodeUnknownEffect(JobRepairReceiptRequest)({
      sandbox: ref,
      requestId: "synthetic-corrected-showcase-v1"
    })
    // Durable first admission absence is checked separately. Unknown receipt never permits replay.
    const admitted = yield* sql.unsafe(
      `SELECT request_id FROM "${schema}"."repair_admission" WHERE sandbox_id=$1 AND generation=$2 AND operation='Repair' AND request_id=$3`,
      [ref.sandboxId, ref.generation, request.requestId]
    )
    if (admitted.length) {
      return yield* repairs.receipt({ sandbox }, request)
    }
    const rows = yield* sql.unsafe<{ id: string }>(
      `SELECT j.id FROM ${t.jobs} j JOIN ${t.associations} a ON a.job_id=j.id JOIN ${t.ledger} l ON l.job_id=j.id AND l.sandbox_id=a.sandbox_id AND l.generation=a.generation WHERE a.sandbox_id=$1 AND a.generation=$2 AND j.state='Dead' AND j.kind='playground.welcome-email' AND NOT l.accepted AND j.last_failure_code IN ('fake_provider_terminal_rejected','fake_provider_retry_rejected') AND NOT EXISTS(SELECT 1 FROM "${schema}"."job_repair_members" m WHERE m.sandbox_id=a.sandbox_id AND m.generation=a.generation AND m.job_id=j.id) ORDER BY j.id COLLATE "C" LIMIT 1`,
      [ref.sandboxId, ref.generation]
    )
    if (!rows[0]) {
      return
    }
    const detail = yield* read.detail(
      { sandbox },
      { sandbox: ref, jobId: yield* Schema.decodeUnknownEffect(JobId)(rows[0].id) }
    )
    if (detail.payload._tag !== "Available" || detail.payload.encryption !== "None") {
      return
    }
    const old = yield* Schema.decodeUnknownEffect(Definitions.Payload)(
      detail.payload.encoded,
      { onExcessProperty: "error" }
    )
    const command = yield* Schema.decodeUnknownEffect(JobRepairCommand)(
      {
        ...request,
        jobId: detail.job.jobId,
        expectedState: "Dead",
        expectedLifecycleVersion: detail.job.lifecycleVersion,
        expectedResolutionVersion: detail.problem?.version ?? 0,
        action: "corrected-redrive",
        payload: yield* Schema.decodeUnknownEffect(JsonValue)({
          ...old,
          behavior: "success"
        }),
        reason: "Synthetic known-failure behavior corrected to success",
        confirmDuplicateEffects: true,
        investigation: { _tag: "KnownFailure" }
      },
      { onExcessProperty: "error" }
    )
    return yield* repairs.execute({ sandbox }, command)
  })
