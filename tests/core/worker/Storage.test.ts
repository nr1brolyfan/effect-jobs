import { Cause, Context, Effect, Exit, Layer, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Storage from "../../../src/JobStorage.js"
import * as Store from "../../../src/JobStore.js"
import { JobPolicyIncompatible } from "../../../src/JobContract.js"
import { JobId } from "../../../src/JobId.js"
import { JobFinalizations } from "../../../src/JobLifecycle.js"
import { defaultPolicy } from "../../../src/JobPolicy.js"
import { harness } from "./Harness.js"

const catalog = { queue: "storage-test", name: "fixture", version: 1 }
const request: Store.ClaimRequest = {
  queue: catalog.queue,
  supportedCatalog: [catalog],
  leaseToken: "original-token"
}
const before = harness([
  {
    catalog,
    producer: { operation: "fixture", operationId: "one", slot: "run" },
    policy: defaultPolicy,
    encoded: {
      formatVersion: 1,
      payloadBytes: new Uint8Array([1]),
      semanticProjectionBytes: new Uint8Array([1])
    }
  }
]).rows[0]!.snapshot
// Forward-only mock inputs, not evidence of valid durable ownership or transitions.
const owner = {
  jobId: Schema.decodeSync(JobId)("storage-test"),
  leaseToken: request.leaseToken,
  lifecycleVersion: 1,
  leaseExpiresAt: 10000
}
const finalization: Store.FinalizationRequest = {
  ownership: owner,
  before,
  finalization: JobFinalizations.Complete()
}
const failing = <E>(error: E): Store.JobStoreService<E> => ({
  claim: () => Effect.fail(error),
  reconcileClaim: () => Effect.fail(error),
  release: () => Effect.fail(error),
  finalize: () => Effect.fail(error),
  reconcileFinalization: () => Effect.fail(error),
  recoverExpired: () => Effect.fail(error)
})

describe("configured JobStorage", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 8_640_000_000_000_001])(
    "rejects invalid response budget %s before source activity",
    async (budget) => {
      const source = harness()
      const result = await Effect.runPromise(
        Storage.make({
          store: source.store,
          operationResponseBudgetMillis: budget
        }).pipe(Effect.result)
      )
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "JobStorageConfigurationError",
          field: "operationResponseBudgetMillis"
        }
      })
      expect(source.calls.claims).toHaveLength(0)
      expect(source.calls.recoveries).toHaveLength(0)
    }
  )

  it("captures provider requirements and budget once without invoking the source", async () => {
    class Provider extends Context.Service<Provider, { readonly marker: string }>()(
      "tests/storage/Provider"
    ) {}
    const seen: unknown[] = []
    const empty = Store.ClaimResult.Empty()
    const unknownClaim = Store.ClaimReconciliation.Unknown()
    const unknownWrite = Store.FinalizationResult.Unknown()
    const unknownFinalization = Store.FinalizationReconciliation.Unknown()
    const record = <A>(input: unknown, value: A) =>
      Effect.map(Provider, (provider) => {
        seen.push([provider.marker, input])
        return value
      })
    const source: Store.JobStoreService<never, Provider> = {
      claim: (input) => record(input, empty),
      reconcileClaim: (token) => record(token, unknownClaim),
      release: (ownership, phase) => record([ownership, phase], unknownWrite),
      finalize: (input) => record(input, unknownWrite),
      reconcileFinalization: (input) => record(input, unknownFinalization),
      recoverExpired: (queue, limit) => record([queue, limit], 3)
    }
    const options = { store: source, operationResponseBudgetMillis: 100 }
    const configured = await Effect.runPromise(
      Storage.make(options).pipe(Effect.provideService(Provider, { marker: "captured" }))
    )
    options.operationResponseBudgetMillis = 200
    expect(seen).toHaveLength(0)
    expect(configured.operationResponseBudgetMillis).toBe(100)
    expect(Object.isFrozen(configured)).toBe(true)
    expect(Object.isFrozen(configured.store)).toBe(true)
    await Effect.runPromise(
      Effect.gen(function* () {
        expect(yield* configured.store.claim(request)).toBe(empty)
        expect(yield* configured.store.reconcileClaim(request.leaseToken)).toBe(
          unknownClaim
        )
        expect(yield* configured.store.release(owner, "BeforeExecution")).toBe(
          unknownWrite
        )
        expect(yield* configured.store.finalize(finalization)).toBe(unknownWrite)
        expect(yield* configured.store.reconcileFinalization(finalization)).toBe(
          unknownFinalization
        )
        expect(yield* configured.store.recoverExpired(catalog.queue, 4)).toBe(3)
      }).pipe(Effect.provideService(Provider, { marker: "later" }))
    )
    expect(seen).toEqual([
      ["captured", request],
      ["captured", request.leaseToken],
      ["captured", [owner, "BeforeExecution"]],
      ["captured", finalization],
      ["captured", finalization],
      ["captured", [catalog.queue, 4]]
    ])
  })

  it("sanitizes only provider failures without changing the original port or replaying writes", async () => {
    const privateError = { detail: "PRIVATE_STORAGE_PROVIDER" }
    const source = failing(privateError)
    const configured = await Effect.runPromise(
      Storage.make({ store: source, operationResponseBudgetMillis: 100 })
    )
    expect(await Effect.runPromise(Effect.flip(source.claim(request)))).toBe(privateError)
    const operations: ReadonlyArray<
      Effect.Effect<
        unknown,
        | Storage.JobStorageUnavailable
        | Store.JobStoreProtocolError
        | Store.JobOwnershipLost
        | JobPolicyIncompatible
      >
    > = [
      configured.store.claim(request),
      configured.store.reconcileClaim(request.leaseToken),
      configured.store.release(owner, "BeforeExecution"),
      configured.store.finalize(finalization),
      configured.store.reconcileFinalization(finalization),
      configured.store.recoverExpired(catalog.queue, 1)
    ]
    for (const operation of operations) {
      const exit = await Effect.runPromiseExit(operation)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const reason = exit.cause.reasons[0]!
        expect(Cause.isFailReason(reason)).toBe(true)
        if (Cause.isFailReason(reason)) {
          expect(reason.error).toBeInstanceOf(Storage.JobStorageUnavailable)
          expect(JSON.stringify(reason.error)).not.toContain("PRIVATE_STORAGE_PROVIDER")
        }
      }
    }
    let writes = 0
    const store = {
      ...source,
      finalize: () =>
        Effect.sync(() => {
          writes++
        }).pipe(Effect.andThen(Effect.fail(privateError)))
    }
    const bounded = await Effect.runPromise(
      Storage.make({ store, operationResponseBudgetMillis: 100 })
    )
    await Effect.runPromiseExit(bounded.store.finalize(finalization))
    expect(writes).toBe(1)
  })

  it("preserves protocol, ownership and policy admission error identities", async () => {
    const protocol = new Store.JobStoreProtocolError({ reason: "invalid-input" })
    const ownership = new Store.JobOwnershipLost()
    const admission = new JobPolicyIncompatible()
    const configured = await Effect.runPromise(
      Storage.make({ store: failing(protocol), operationResponseBudgetMillis: 100 })
    )
    expect(
      await Effect.runPromise(Effect.flip(configured.store.reconcileClaim("token")))
    ).toBe(protocol)
    const fenced = await Effect.runPromise(
      Storage.make({ store: failing(ownership), operationResponseBudgetMillis: 100 })
    )
    expect(
      await Effect.runPromise(Effect.flip(fenced.store.release(owner, "BeforeExecution")))
    ).toBe(ownership)
    expect(
      await Effect.runPromise(Effect.flip(fenced.store.finalize(finalization)))
    ).toBe(ownership)
    const rejected = await Effect.runPromise(
      Storage.make({ store: failing(admission), operationResponseBudgetMillis: 100 })
    )
    expect(await Effect.runPromise(Effect.flip(rejected.store.claim(request)))).toBe(
      admission
    )
  })

  it("preserves defects, interruptions and mixed causes across the safe typed-error boundary", async () => {
    const defect = { private: "defect-marker" }
    const provider = { private: "provider-marker" }
    for (const effect of [
      Effect.die(defect),
      Effect.interrupt,
      Effect.failCause(Cause.combine(Cause.fail(provider), Cause.die(defect)))
    ]) {
      const store = { ...failing(provider), finalize: () => effect }
      const configured = await Effect.runPromise(
        Storage.make({ store, operationResponseBudgetMillis: 100 })
      )
      const original = await Effect.runPromiseExit(effect)
      const actual = await Effect.runPromiseExit(configured.store.finalize(finalization))
      expect(Exit.isFailure(original) && Exit.isFailure(actual)).toBe(true)
      if (Exit.isFailure(original) && Exit.isFailure(actual)) {
        expect(actual.cause.reasons.map((reason) => reason._tag)).toEqual(
          original.cause.reasons.map((reason) => reason._tag)
        )
        for (const reason of actual.cause.reasons) {
          if (Cause.isDieReason(reason)) {
            expect(reason.defect).toBe(defect)
          }
          if (Cause.isFailReason(reason)) {
            expect(reason.error).toBeInstanceOf(Storage.JobStorageUnavailable)
          }
        }
      }
    }
  })

  it("leaves resource acquisition and release with the application Layer Scope", async () => {
    class Source extends Context.Service<Source, {}>()("tests/storage/Source") {}
    let acquired = 0
    let released = 0
    const source: Store.JobStoreService<Store.JobOwnershipLost, Source> = {
      ...harness().store,
      claim: () => Effect.as(Source, Store.ClaimResult.Empty())
    }
    const provider = Layer.effect(
      Source,
      Effect.acquireRelease(
        Effect.sync(() => {
          acquired++
          return {}
        }),
        () =>
          Effect.sync(() => {
            released++
          })
      )
    )
    const configured = Storage.layer({
      store: source,
      operationResponseBudgetMillis: 100
    }).pipe(Layer.provide(provider))
    const result = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(configured)
          const storage = Context.get(context, Storage.JobStorage)
          yield* storage.store.claim(request)
          yield* storage.store.claim(request)
          expect(acquired).toBe(1)
          expect(released).toBe(0)
          return yield* Effect.fail("application-exit")
        })
      )
    )
    expect(Exit.isFailure(result)).toBe(true)
    expect(acquired).toBe(1)
    expect(released).toBe(1)
  })
})
