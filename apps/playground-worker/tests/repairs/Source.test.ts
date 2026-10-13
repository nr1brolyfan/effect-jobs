import { describe, expect, it } from "vitest"
import { Effect, Exit } from "effect"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Definitions from "../../src/scenarios/Definitions.js"
import * as Source from "../../src/persistence/commands/RepairSource.js"
import * as Fixture from "./Fixtures.js"

describe("complete immutable repair admission", () => {
  it("canonicalizes key order and finite fractional JSON", () => {
    expect(Source.canonicalJson({ z: 1.5, a: [true, null, -0] })).toBe(
      '{"a":[true,null,0],"z":1.5}'
    )
    expect(Source.canonicalJson({ b: 2, a: 1 })).toBe(
      Source.canonicalJson({ a: 1, b: 2 })
    )
  })
  it("rejects cycles, depth, size, invalid Unicode, exotic properties and containers without invoking getters", () => {
    const cycle: { self?: unknown } = {}
    cycle.self = cycle
    let deep: unknown = null
    for (let i = 0; i < 34; i++) {
      deep = [deep]
    }
    let invoked = false
    const accessor = Object.defineProperty({}, "secret", {
      enumerable: true,
      get: () => {
        invoked = true
        return "private"
      }
    })
    const hidden = Object.defineProperty({}, "hidden", { value: "private" })
    const sparse: unknown[] = []
    sparse.length = 2
    for (const bad of [
      cycle,
      deep,
      "x".repeat(65537),
      "\ud800",
      Number.NaN,
      Infinity,
      new Date(),
      sparse,
      accessor,
      hidden,
      { [Symbol("symbol")]: 1 }
    ]) {
      expect(() => Source.canonicalJson(bad)).toThrow()
    }
    expect(invoked).toBe(false)
  })
  it("binds every admission field and canonical replacement content", async () => {
    const baseline = await Effect.runPromise(Source.commandDigest(Fixture.command))
    expect(baseline).toMatch(/^[a-f0-9]{64}$/u)
    for (const delta of [
      { reason: "Other reason" },
      { expectedResolutionVersion: 1 },
      { expectedLifecycleVersion: 3 },
      { jobId: Fixture.successorId },
      { investigation: { _tag: "AcceptDuplicateRisk" as const, reason: "Investigated" } },
      { action: "redrive" as const },
      { payload: { ...Fixture.payload, behavior: "retry-then-success" } }
    ]) {
      expect(
        await Effect.runPromise(Source.digestJson({ ...Fixture.command, ...delta }))
      ).not.toBe(baseline)
    }
    const identity = await Effect.runPromise(Source.producerIdentity(Fixture.command))
    expect(identity.operation).toBe("playground.repair")
    expect(identity.slot).toBe("replacement")
    expect(identity.operationId).toHaveLength(64)
  })
})
describe("server source authority and validation", () => {
  it("requires exact durable ledger evidence; KnownFailure assertions alone fail", async () => {
    expect(Source.knownFailure(Fixture.sourceRow)).toBe(true)
    for (const delta of [
      { accepted: true },
      { accepted: null },
      { invocations: null },
      { state: "Isolated" },
      { last_failure_code: "recovery_exhausted" }
    ]) {
      const row = { ...Fixture.sourceRow, ...delta }
      expect(Source.knownFailure(row)).toBe(false)
      expect(
        Exit.isFailure(
          await Effect.runPromise(Effect.exit(Source.investigate(row, Fixture.command)))
        )
      ).toBe(true)
    }
    expect(
      await Effect.runPromise(
        Source.investigate(
          { ...Fixture.sourceRow, state: "Isolated" },
          {
            ...Fixture.command,
            expectedState: "Isolated",
            investigation: { _tag: "AcceptDuplicateRisk", reason: "Investigated" }
          }
        )
      )
    ).toBe("Unknown")
  })
  it("validates replacement, fixed scope and invariants and recomputes paths", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const encoded = yield* Codec.encodeJobPayload(
          Definitions.Payload,
          Fixture.payload
        )
        const row = {
          ...Fixture.sourceRow,
          format_version: 1,
          payload: encoded.payloadBytes,
          projection: encoded.semanticProjectionBytes
        }
        const before = new Uint8Array(encoded.payloadBytes)
        const prepared = yield* Source.replacement(row, Fixture.ref, {
          ...Fixture.payload,
          behavior: "success"
        })
        expect(prepared.changes).toEqual([{ kind: "Changed", path: "/behavior" }])
        expect(encoded.payloadBytes).toEqual(before)
        for (const delta of [
          { actor: "other" },
          { order: "demo-order-b" },
          { tenant: "demo-tenant-b" },
          { sandbox: { ...Fixture.ref, generation: 2 } },
          { policy: {} },
          { behavior: "arbitrary" }
        ]) {
          expect(
            Exit.isFailure(
              yield* Effect.exit(
                Source.replacement(row, Fixture.ref, { ...Fixture.payload, ...delta })
              )
            )
          ).toBe(true)
        }
        const corrupt = { ...row, projection: new TextEncoder().encode("{}") }
        expect(
          (yield* Source.replacement(corrupt, Fixture.ref, Fixture.payload)).changes
        ).toBeNull()
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              Source.replacement(
                {
                  ...corrupt,
                  relations: {
                    syntheticActor: Fixture.payload.actor,
                    syntheticOrderId: Fixture.payload.order
                  }
                },
                Fixture.ref,
                Fixture.payload
              )
            )
          )
        ).toBe(true)
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              Source.replacement(
                {
                  ...row,
                  queue: Definitions.PrivateDataExport.catalog.queue,
                  kind: Definitions.PrivateDataExport.catalog.kind,
                  version: Definitions.PrivateDataExport.catalog.version
                },
                Fixture.ref,
                Fixture.payload
              )
            )
          )
        ).toBe(true)
      })
    )
  })
})
