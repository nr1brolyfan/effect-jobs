import * as JobApi from "../../../src/JobApi.js"
import * as JobApiBuilder from "../../../src/JobApiBuilder.js"
import { Context, Effect, Layer, Schema, Scope } from "effect"
import { describe, expect, it, vi } from "vitest"
import * as Group from "../../../src/JobGroup.js"
import * as Codec from "../../../src/JobPayloadCodec.js"
import type { HandlerContext } from "../../../src/JobContract.js"
import { JobId } from "../../../src/JobId.js"

const receipt = {
  name: "billing.receipt",
  version: 1,
  payload: Schema.Struct({ invoiceId: Schema.String })
}
const metadata: HandlerContext = {
  jobId: Schema.decodeSync(JobId)("group-test"),
  catalog: { queue: "billing", name: receipt.name, version: 1 },
  producer: { operation: "billing.issue", operationId: "one", slot: "receipt" },
  nextFinalizationNumber: 1
}

describe("contract-first groups", () => {
  it("allocates distinct keys across module copies without global-scope crypto", async () => {
    vi.stubGlobal("crypto", undefined)
    try {
      const first = Group.make("portable", { receipt })
      vi.resetModules()
      const copy = await import("../../../src/JobGroup.js")
      const second = copy.make("portable", { receipt })
      expect(first.handlers.key).not.toBe(second.handlers.key)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("rejects empty groups and repeated name/version independently of aliases", () => {
    expect(() => Group.make("empty", {})).toThrow(Group.InvalidJobGroup)
    expect(() => Group.make("duplicate", { first: receipt, second: receipt })).toThrow(
      Group.InvalidJobGroup
    )
    expect(() =>
      Group.make("versions", { v1: receipt, v2: { ...receipt, version: 2 } })
    ).not.toThrow()
  })

  it("snapshots declarations without freezing caller-owned configuration", () => {
    const mutable = { ...receipt }
    const definitions = { receipt: mutable }
    const group = Group.make("snapshot", definitions)
    mutable.name = "changed"
    expect(group.definitions.receipt.name).toBe("billing.receipt")
    expect(Object.isFrozen(group.definitions)).toBe(true)
    expect(Object.isFrozen(group.definitions.receipt)).toBe(true)
    expect(Object.isFrozen(mutable)).toBe(false)
    expect(group.definitions.receipt.payload).toBe(receipt.payload)
  })

  it("captures handler dependencies and decodes before invocation", async () => {
    class Mailer extends Context.Service<Mailer, { readonly prefix: string }>()(
      "tests/JobGroup/Mailer"
    ) {}
    const group = Group.make("billing", { receipt })
    const received: string[] = []
    const handlers = JobApiBuilder.group(
      JobApi.make(group.name).pipe(JobApi.addGroup(group)),
      group.name,
      (_handlers) =>
        _handlers.handle(
          "receipt",
          Effect.fnUntraced(function* (input) {
            const mailer = yield* Mailer
            received.push(mailer.prefix + input.payload.invoiceId)
          })
        )
    ).pipe(Layer.provide(Layer.succeed(Mailer, { prefix: "invoice:" })))
    await Effect.runPromise(
      Effect.gen(function* () {
        const installed = yield* group.handlers
        const encoded = yield* Codec.encodeJobPayload(receipt.payload, {
          invoiceId: "one"
        })
        yield* installed.receipt(encoded, metadata)
        yield* installed
          .receipt({ ...encoded, payloadBytes: new Uint8Array([0]) }, metadata)
          .pipe(Effect.flip)
      }).pipe(Effect.provide(handlers))
    )
    expect(received).toEqual(["invoice:one"])
  })

  it("does not share Context keys between separately constructed identical groups", async () => {
    const first = Group.make("billing", { receipt })
    const second = Group.make("billing", { receipt })
    expect(first.handlers.key).not.toBe(second.handlers.key)
    const calls: string[] = []
    const layers = Layer.mergeAll(
      JobApiBuilder.group(
        JobApi.make(first.name).pipe(JobApi.addGroup(first)),
        first.name,
        (_handlers) =>
          _handlers.handle("receipt", () =>
            Effect.sync(() => {
              calls.push("first")
            })
          )
      ),
      JobApiBuilder.group(
        JobApi.make(second.name).pipe(JobApi.addGroup(second)),
        second.name,
        (_handlers) =>
          _handlers.handle("receipt", () =>
            Effect.sync(() => {
              calls.push("second")
            })
          )
      )
    )
    await Effect.runPromise(
      Effect.gen(function* () {
        const a = yield* first.handlers
        const b = yield* second.handlers
        const encoded = yield* Codec.encodeJobPayload(receipt.payload, {
          invoiceId: "one"
        })
        yield* a.receipt(encoded, metadata)
        yield* b.receipt(encoded, metadata)
      }).pipe(Effect.provide(layers))
    )
    expect(calls).toEqual(["first", "second"])
  })

  it("rejects unsupported schemas before any handler runs", async () => {
    const group = Group.make("unsupported", {
      record: { ...receipt, payload: Schema.Record(Schema.String, Schema.String) }
    })
    const result = await Effect.runPromise(
      Effect.void.pipe(
        Effect.provide(
          JobApiBuilder.group(
            JobApi.make(group.name).pipe(JobApi.addGroup(group)),
            group.name,
            (_handlers) => _handlers.handle("record", () => Effect.die("must not run"))
          )
        ),
        Effect.result
      )
    )
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { reason: "unsupported-schema", alias: "record" }
    })
  })

  it("retains builder errors and closes resources on failed acquisition", async () => {
    const group = Group.make("builder", { receipt })
    let released = false
    const handlers = JobApiBuilder.group(
      JobApi.make(group.name).pipe(JobApi.addGroup(group)),
      group.name,
      (_handlers) =>
        Effect.gen(function* () {
          yield* Effect.acquireRelease(Effect.void, () =>
            Effect.sync(() => {
              released = true
            })
          )
          return yield* Effect.fail("builder-failed" as const)
        })
    )
    const result = await Effect.runPromise(
      Effect.void.pipe(Effect.provide(handlers), Effect.result)
    )
    expect(result).toMatchObject({ _tag: "Failure", failure: "builder-failed" })
    expect(released).toBe(true)
  })

  it("gives each invocation its own Scope instead of retaining the installation Scope", async () => {
    const group = Group.make("scope", { receipt })
    let finalized = 0
    const scopes: Scope.Scope[] = []
    const handlers = JobApiBuilder.group(
      JobApi.make(group.name).pipe(JobApi.addGroup(group)),
      group.name,
      (_handlers) =>
        _handlers.handle(
          "receipt",
          Effect.fnUntraced(function* () {
            scopes.push(yield* Scope.Scope)
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                finalized++
              })
            )
          })
        )
    )
    await Effect.runPromise(
      Effect.gen(function* () {
        const installed = yield* group.handlers
        const encoded = yield* Codec.encodeJobPayload(receipt.payload, {
          invoiceId: "one"
        })
        yield* installed.receipt(encoded, metadata)
        expect(finalized).toBe(1)
        yield* installed.receipt(encoded, metadata)
        expect(finalized).toBe(2)
      }).pipe(Effect.provide(handlers))
    )
    expect(scopes[0]).not.toBe(scopes[1])
  })
})
