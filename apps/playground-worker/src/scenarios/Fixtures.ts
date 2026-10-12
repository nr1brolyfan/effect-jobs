import { Schema } from "effect"
import { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import { sandbox } from "@effect-jobs/playground-contracts/Fixtures"
import * as Policy from "effect-jobs/JobPolicy"
import * as Definitions from "./Definitions.js"
import { codes } from "./Handlers.js"

const now = 1_800_000_000_000
// Synthetic DTO fixtures only, never persisted lifecycle writes or observed history.
// Unknown has Active state; delayed has Pending state and future availability.
const profiles = [
  { label: "pending", state: "Pending", attempts: 0, stalls: 0, code: null },
  { label: "delayed", state: "Pending", attempts: 0, stalls: 0, code: null },
  { label: "active", state: "Active", attempts: 0, stalls: 0, code: null },
  {
    label: "retry",
    state: "RetryScheduled",
    attempts: 1,
    stalls: 0,
    code: codes.rejected
  },
  { label: "cancelled", state: "Cancelled", attempts: 0, stalls: 0, code: null },
  { label: "completed", state: "Completed", attempts: 1, stalls: 0, code: null },
  { label: "dead", state: "Dead", attempts: 1, stalls: 0, code: codes.terminal },
  { label: "isolated", state: "Isolated", attempts: 1, stalls: 0, code: codes.invariant },
  { label: "unknown", state: "Active", attempts: 0, stalls: 0, code: null },
  { label: "recovered", state: "Pending", attempts: 0, stalls: 1, code: null }
] as const

export const dashboard = profiles.map((profile, index) => ({
  label: profile.label,
  detail: Schema.decodeUnknownSync(JobDetail)(
    {
      sandbox: sandbox.ref,
      job: {
        jobId: `synthetic-${profile.label}`,
        catalog: Definitions.definitions[index % Definitions.definitions.length]!.catalog,
        state: profile.state,
        availableAt: profile.label === "delayed" ? now + 60_000 : now,
        updatedAt: now,
        completedAt:
          profile.state === "Completed" ||
          profile.state === "Dead" ||
          profile.state === "Cancelled"
            ? now
            : null,
        attemptsMade: profile.attempts,
        stalledCount: profile.stalls,
        lifecycleVersion:
          profile.label === "pending" || profile.label === "delayed" ? 0 : 2,
        lastFailureCode: profile.code
      },
      producer: Definitions.Producer.identity({
        operationId: `synthetic-fixture-${index}`,
        slot: "welcome-email"
      }),
      policy: Policy.make(),
      relations: { syntheticActor: "demo-customer", syntheticOrderId: "demo-order-a" },
      ...(profile.label === "unknown"
        ? { observation: { source: "mock", observedAt: now, outcome: "unknown" } }
        : {})
    },
    { onExcessProperty: "error" }
  )
}))
