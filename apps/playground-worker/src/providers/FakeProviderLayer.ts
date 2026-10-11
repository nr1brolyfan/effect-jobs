import { Effect, Layer } from "effect"
import {
  FakeProvider,
  InvariantViolation,
  LedgerFull,
  PayloadConflict,
  ResponseLost,
  RetryRejected,
  TerminalRejected,
  type ProviderIdentity,
  type ProviderFailure
} from "./FakeProvider.js"

const key = ({ sandbox, producer }: ProviderIdentity) =>
  JSON.stringify([
    sandbox.sandboxId,
    sandbox.generation,
    producer.operation,
    producer.operationId,
    producer.slot
  ])

// One fresh, bounded, in-memory ledger per Layer acquisition. No hosted durability claim.
// The executor must scope this Layer to a sandbox and fence invocation on generation/expiry.
export const layer = Layer.sync(FakeProvider, () => {
  const ledger = new Map<
    string,
    { signature: string; accepted: boolean; invocations: number }
  >()
  return FakeProvider.of({
    execute: (command) =>
      Effect.gen(function* () {
        // Snapshot mutable bytes before yielding. Signature stays private in the ledger.
        const projection = new Uint8Array(command.semanticProjection)
        const digest = yield* Effect.tryPromise({
          try: () => crypto.subtle.digest("SHA-256", projection),
          catch: () => new InvariantViolation()
        })
        const signature = JSON.stringify([
          command.workload,
          command.behavior,
          Array.from(new Uint8Array(digest))
        ])
        // Bounded cooperative synthetic work, no actual image CPU or network traffic.
        if (command.workload === "image-processing") {
          yield* Effect.sleep("20 millis")
        }
        const failure = yield* Effect.sync((): ProviderFailure | undefined => {
          const id = key(command)
          const previous = ledger.get(id)
          if (previous && previous.signature !== signature) {
            return new PayloadConflict()
          }
          if (!previous && ledger.size >= 100) {
            return new LedgerFull()
          }
          const entry = previous ?? { signature, accepted: false, invocations: 0 }
          entry.invocations = Math.min(entry.invocations + 1, 1_000_000)
          ledger.set(id, entry)
          if (entry.accepted) {
            return undefined
          }
          switch (command.behavior) {
            case "retry-then-success":
              if (entry.invocations === 1) {
                return new RetryRejected()
              }
              break
            case "dead":
              return new TerminalRejected()
            case "isolated":
              return new InvariantViolation()
            case "success":
              break
            case "accepted-response-lost":
              entry.accepted = true
              return new ResponseLost()
          }
          entry.accepted = true
          return undefined
        })
        if (failure) {
          return yield* Effect.fail(failure)
        }
      }),
    inspect: (identity) =>
      Effect.sync(() => {
        const entry = ledger.get(key(identity))
        return entry === undefined
          ? undefined
          : {
              source: "mock" as const,
              accepted: entry.accepted,
              invocations: entry.invocations,
              effects: entry.accepted ? (1 as const) : (0 as const)
            }
      })
  })
})
