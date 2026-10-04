/**
 * @title Resources, secrets, and interruption
 */
import { Effect, Fiber, Redacted, Schema } from "effect"

declare const acquireSecret: Effect.Effect<Uint8Array>
declare const verifySecret: (
  secret: Redacted.Redacted<Uint8Array>
) => Effect.Effect<boolean, VerifyUnavailable>

class VerifyUnavailable extends Schema.TaggedError<VerifyUnavailable>()(
  "VerifyUnavailable",
  {}
) {}

export const verify = Effect.fnUntraced(function* () {
  return yield* Effect.acquireUseRelease(
    acquireSecret.pipe(Effect.map(Redacted.make)),
    verifySecret,
    (redacted) => Effect.sync(() => Redacted.value(redacted).fill(0))
  )
})

declare const acquireLease: Effect.Effect<{ readonly id: string }>
declare const useLease: (lease: { readonly id: string }) => Effect.Effect<string>
declare const commitLease: (lease: { readonly id: string }) => Effect.Effect<void>

export const leased = Effect.uninterruptibleMask((restore) =>
  Effect.gen(function* () {
    const lease = yield* acquireLease
    // Long-running work remains interruptible; only the state transition is masked.
    const result = yield* restore(useLease(lease))
    yield* commitLease(lease)
    return result
  })
)

declare const worker: Effect.Effect<number>

export const supervisedWorker = Effect.scoped(
  Effect.gen(function* () {
    // The child is interrupted automatically when this scope closes.
    const fiber = yield* Effect.forkScoped(worker)
    return yield* Fiber.join(fiber)
  })
)

// Prefer scoped fibers and scoped resources. Detached fibers need an explicit
// application-lifetime owner. Do not promise zeroization of JavaScript strings
// or provider/native copies that this scope does not own.
