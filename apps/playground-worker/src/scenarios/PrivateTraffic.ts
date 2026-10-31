// @effect-diagnostics unstableApiUsage:off
import { Duration, Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import * as Policy from "effect-jobs/JobPolicy"
import type { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import type { ScenarioId } from "@effect-jobs/playground-contracts/Scenarios"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import * as Plan from "./Plan.js"
import { DocumentKeys } from "./PrivateDocument.js"
import * as Mode from "../persistence/authority/PrivateMode.js"
import * as Tables from "../persistence/authority/Schema.js"

export const interactionMillis = 120_000
export const starterScenarios: ReadonlyArray<ScenarioId> = [
  "success",
  "delayed-success",
  "retry-then-success",
  "terminal-failure",
  "isolated",
  "deduplication"
]
export const starterCount = starterScenarios.length
export const profile = (sequence: number) => starterScenarios[sequence % starterCount]!

// Caller owns the native transaction and locked, authenticated sandbox row.
// Only enqueue creates lifecycle state. Receipts, quota and associations commit together.
export const make = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const local = yield* Mode.LocalPrivate
    const retainedMaximum = Mode.retainedMaximum(local)
    const admissionMaximum = Mode.admissionMaximum(local)
    const producer = yield* JobEnqueue
    const keys = yield* DocumentKeys
    const t = Tables.relations(schema)
    const query = (text: string, values: ReadonlyArray<unknown> = []) =>
      sql
        .unsafe<Record<string, unknown>>(text, values)
        .pipe(Effect.mapError(() => new PlaygroundError({ code: "unavailable" })))
    const append = (
      ref: SandboxRef,
      requestId: string,
      scenarios: ReadonlyArray<ScenarioId>,
      now: number,
      seed = 0
    ) =>
      Effect.gen(function* () {
        if (
          !Number.isInteger(scenarios.length) ||
          scenarios.length < 1 ||
          scenarios.length > 10
        ) {
          return yield* new PlaygroundError({ code: "limit-reached" })
        }
        const [budget] = yield* query(
          `SELECT count(*) AS n FROM ${t.admission} WHERE sandbox_id=$1`,
          [ref.sandboxId]
        )
        if (Number(budget!.n) >= admissionMaximum) {
          return yield* new PlaygroundError({ code: "limit-reached" })
        }
        const reserved = yield* query(
          `UPDATE ${t.sandboxes} SET retained_jobs=retained_jobs+$3::int
        WHERE sandbox_id=$1 AND generation=$2 AND NOT demo_owned AND retained_jobs<=${retainedMaximum}-$3::int RETURNING sandbox_id`,
          [ref.sandboxId, ref.generation, scenarios.length]
        )
        if (!reserved.length) {
          return yield* new PlaygroundError({ code: "limit-reached" })
        }
        yield* query(
          `INSERT INTO ${t.admission}(sandbox_id,generation,operation,request_id) VALUES ($1,$2,'PrivateTraffic',$3)`,
          [ref.sandboxId, ref.generation, requestId]
        )
        const trafficPolicy = yield* Policy.make({
          retryDelay: Duration.millis(interactionMillis)
        }).pipe(Effect.mapError(() => new PlaygroundError({ code: "unavailable" })))
        const jobIds = yield* Effect.forEach(
          scenarios,
          Effect.fnUntraced(function* (scenario, index) {
            const [job] = yield* Plan.plan(
              { sandbox: ref, requestId: `${requestId}-${index}`, scenario, count: 1 },
              ref,
              seed + index,
              scenario === "delayed-success" ? now + interactionMillis : now,
              "private-traffic-v1"
            ).pipe(Effect.mapError(() => new PlaygroundError({ code: "unavailable" })))
            const planned = {
              ...job!,
              policy: trafficPolicy
            }
            const enqueue = Plan.enqueue(planned).pipe(
              Effect.provideService(JobEnqueue, producer),
              Effect.provideService(DocumentKeys, keys),
              Effect.mapError(() => new PlaygroundError({ code: "unavailable" }))
            )
            const produced = yield* enqueue
            if (scenario === "deduplication") {
              const duplicate = yield* enqueue
              if (
                duplicate._tag !== "AlreadyPresent" ||
                duplicate.jobId !== produced.jobId
              ) {
                return yield* new PlaygroundError({ code: "unavailable" })
              }
            }
            yield* query(`INSERT INTO ${t.associations} VALUES ($1,$2,$3,$4::jsonb)`, [
              ref.sandboxId,
              ref.generation,
              produced.jobId,
              JSON.stringify({
                syntheticActor: job!.payload.actor,
                syntheticTenant: job!.payload.tenant,
                syntheticOrderId: job!.payload.order
              })
            ])
            return produced.jobId
          }),
          { concurrency: 1 }
        )
        yield* query(
          `INSERT INTO ${t.receipts} VALUES ($1,$2,'PrivateTraffic',$3,$4::jsonb)`,
          [
            ref.sandboxId,
            ref.generation,
            requestId,
            JSON.stringify({ sandbox: ref, requestId, scenarios, jobIds })
          ]
        )
        yield* query(
          `INSERT INTO ${t.audit} VALUES ($1,$2,'PrivateTraffic','synthetic-scenario',$3,$4)`,
          [ref.sandboxId, ref.generation, scenarios.length, now]
        )
      })
    const ensure = (ref: SandboxRef, now: number) =>
      Effect.gen(function* () {
        const prior = yield* query(
          `SELECT request_id FROM ${t.receipts} WHERE sandbox_id=$1 AND generation=$2 AND operation='PrivateTraffic' AND request_id='starter-v1'`,
          [ref.sandboxId, ref.generation]
        )
        if (!prior.length) {
          yield* append(ref, "starter-v1", starterScenarios, now)
        }
      })
    return { ensure, append }
  })
