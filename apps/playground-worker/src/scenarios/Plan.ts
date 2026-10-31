import { Data, Duration, Effect, Schema } from "effect"
import {
  ScenarioCommand,
  type ScenarioId
} from "@effect-jobs/playground-contracts/Scenarios"
import type { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import * as JobPolicy from "effect-jobs/JobPolicy"
import * as Retry from "effect-jobs/JobRetryPolicy"
import * as Definitions from "./Definitions.js"

export class InvalidScenario extends Data.TaggedError("InvalidScenario")<{}> {}
export interface PlannedJob {
  readonly workload: Definitions.Workload
  readonly payload: Definitions.Payload
  readonly producer: ReturnType<typeof Definitions.Producer.identity>
  readonly policy: JobPolicy.JobPolicy
  readonly availableAt?: number
}

const workloads = Definitions.Workload.literals
const behavior = (scenario: ScenarioId): Definitions.Behavior => {
  switch (scenario) {
    case "delayed-success":
    case "success":
    case "deduplication":
      return "success"
    case "retry-then-success":
      return "retry-then-success"
    case "isolated":
      return "isolated"
    case "terminal-failure":
      return "dead"
    case "unknown-outcome":
      return "accepted-response-lost"
  }
}

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
  const policy = yield* JobPolicy.make(
    command.scenario === "retry-then-success"
      ? { retry: Retry.fixed(Duration.seconds(120)) }
      : {}
  )
  const jobs: PlannedJob[] = []
  for (let index = 0; index < command.count; index++) {
    const workload = workloads[(seed + index) % workloads.length]!
    jobs.push({
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
      producer: Definitions.Producer.identity({ operationId, slot: workload }),
      policy,
      ...(availableAt === undefined ? {} : { availableAt })
    })
  }
  // A slot can appear more than once in a 10-job batch. Distinguish consequences
  // by sequence while retaining the operation/request namespace on replay.
  return jobs.map((job) => ({
    ...job,
    producer: Definitions.Producer.identity({
      operationId: `${operationId}-${job.payload.sequence}`,
      slot: job.workload
    })
  }))
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
export const enqueue = (job: PlannedJob) => {
  const input = {
    producer: job.producer,
    policy: job.policy,
    payload: job.payload,
    ...(job.availableAt === undefined ? {} : { availableAt: job.availableAt })
  }
  switch (job.workload) {
    case "welcome-email":
      return Definitions.WelcomeEmail.enqueue(input)
    case "image-processing":
      return Definitions.ImageProcessing.enqueue(input)
    case "webhook-delivery":
      return Definitions.WebhookDelivery.enqueue(input)
    case "private-data-export":
      // All planner inputs are fixed synthetic data, including private sandboxes.
      // Keep the generic private-key catalog for existing artifacts and consumers.
      return Definitions.SyntheticDocumentExport.enqueue({
        ...input,
        payload: exportPayload(job.payload)
      })
    case "catalog-sync":
      return Definitions.CatalogSync.enqueue(input)
    case "simulated-payment":
      return Definitions.SimulatedPayment.enqueue(input)
  }
}
