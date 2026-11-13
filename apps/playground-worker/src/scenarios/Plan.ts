import { Data, Duration, Effect, Match, Schema } from "effect"
import {
  ScenarioCommand,
  type ScenarioId
} from "@effect-jobs/playground-contracts/Scenarios"
import type { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import * as JobPolicy from "effect-jobs/JobPolicy"
import * as Retry from "effect-jobs/JobRetryPolicy"
import * as Definitions from "./Definitions.js"
import type { ProducerIdentity } from "effect-jobs/JobIdentity"

export class InvalidScenario extends Data.TaggedError("InvalidScenario")<{}> {}
export interface PlannedJob {
  readonly workload: Definitions.Workload
  readonly payload: Definitions.Payload
  readonly producer: ProducerIdentity<typeof Definitions.operation, Definitions.Workload>
  readonly policy: JobPolicy.JobPolicy
  readonly availableAt?: number
}

const workloads = Definitions.Workload.literals
const behavior = (scenario: ScenarioId): Definitions.Behavior =>
  Match.value(scenario).pipe(
    Match.whenOr("delayed-success", "success", "deduplication", () => "success" as const),
    Match.when("retry-then-success", () => "retry-then-success" as const),
    Match.when("isolated", () => "isolated" as const),
    Match.when("terminal-failure", () => "dead" as const),
    Match.when("unknown-outcome", () => "accepted-response-lost" as const),
    Match.exhaustive
  )

/** Pure app planning plus a stable hashed producer namespace; no DB writes.
 * The caller supplies authenticated authority and a fixed server-owned seed.
 * Admission/expiry, quotas, receipts and atomic enqueue are the command adapter's job.
 */
export const plan = Effect.fn("Playground.plan")(function* (
  input: unknown,
  authorized: SandboxRef,
  seed: number,
  availableAt?: number,
  namespace?: "private-traffic-v1"
) {
  const command = yield* Schema.decodeUnknownEffect(ScenarioCommand)(input, {
    onExcessProperty: "error"
  }).pipe(Effect.mapError(() => new InvalidScenario()))
  if (
    command.sandbox.sandboxId !== authorized.sandboxId ||
    command.sandbox.generation !== authorized.generation ||
    !Schema.is(Definitions.Payload.fields.seed)(seed) ||
    (availableAt !== undefined && !Schema.is(JobPolicy.EpochMillis)(availableAt))
  ) {
    return yield* new InvalidScenario()
  }
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      authorized.sandboxId,
      authorized.generation,
      command.requestId,
      ...(namespace === undefined ? [] : [namespace])
    ])
  )
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", bytes),
    catch: () => new InvalidScenario()
  })
  const operationId = `sandbox-request-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
  return yield* Effect.forEach(
    Array.from({ length: command.count }, (_, index) => index),
    (index) =>
      Effect.gen(function* () {
        const definitions = yield* Definitions.Definitions

        const workload = workloads[(seed + index) % workloads.length]!
        return {
          workload,
          payload: {
            sandbox: { ...authorized },
            version: 1,
            seed,
            sequence: index + 1,
            behavior: behavior(command.scenario),
            actor: "demo-customer",
            tenant: (seed + index) % 2 === 0 ? "demo-tenant-a" : "demo-tenant-b",
            order: (seed + index) % 2 === 0 ? "demo-order-a" : "demo-order-b"
          },
          // Sequence distinguishes repeated slots while preserving the request namespace.
          producer: {
            operation: definitions.Producer.operation,
            operationId: `${operationId}-${index + 1}`,
            slot: workload
          },
          policy: yield* JobPolicy.make(
            command.scenario === "retry-then-success"
              ? { retry: Retry.fixed(Duration.seconds(120)) }
              : {}
          ),
          ...(availableAt === undefined ? {} : { availableAt })
        } satisfies PlannedJob
      })
  )
})

export const exportPayload = (
  payload: Definitions.Payload
): Definitions.ExportPayload => ({
  ...payload,
  document: {
    subject: payload.actor,
    tenant: payload.tenant,
    note: "synthetic private export v1"
  }
})

/** Enqueue joins the configured application transaction. Results remain provisional.
 * Do not run concurrently inside one transaction or convert a conflict into success.
 */
export const enqueue = (job: PlannedJob) =>
  Effect.gen(function* () {
    const definitions = yield* Definitions.Definitions
    const producer = yield* definitions.makeProducer(job.policy)
    const input = {
      operationId: job.producer.operationId,
      policy: job.policy,
      payload: job.payload,
      ...(job.availableAt === undefined ? {} : { availableAt: job.availableAt })
    }
    return yield* Match.value(job.workload).pipe(
      Match.when("welcome-email", () =>
        producer.enqueue({ ...input, slot: "welcome-email" })
      ),
      Match.when("image-processing", () =>
        producer.enqueue({ ...input, slot: "image-processing" })
      ),
      Match.when("webhook-delivery", () =>
        producer.enqueue({ ...input, slot: "webhook-delivery" })
      ),
      // All planner inputs are fixed synthetic data, including private sandboxes.
      // Keep the generic private-key catalog for existing artifacts and consumers.
      Match.when("private-data-export", () =>
        producer.enqueue({
          slot: "private-data-export",
          ...input,
          payload: exportPayload(job.payload)
        })
      ),
      Match.when("catalog-sync", () =>
        producer.enqueue({ ...input, slot: "catalog-sync" })
      ),
      Match.when("simulated-payment", () =>
        producer.enqueue({ ...input, slot: "simulated-payment" })
      ),
      Match.exhaustive
    )
  })
