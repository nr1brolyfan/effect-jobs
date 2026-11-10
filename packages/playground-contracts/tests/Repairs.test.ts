import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { JsonValue, JobRepairCommand, Reason } from "../src/Repairs.js"
import * as Fixtures from "../src/Fixtures.js"

const input = {
  sandbox: Fixtures.sandbox.ref,
  requestId: "repair-contract",
  jobId: Fixtures.detail.job.jobId,
  expectedState: "Dead",
  expectedLifecycleVersion: 1,
  expectedResolutionVersion: 0,
  reason: "Correct synthetic behavior",
  confirmDuplicateEffects: true,
  investigation: { _tag: "KnownFailure" },
  action: "corrected-redrive",
  payload: { value: 1.5 }
}
describe("strict bounded repair wire contract", () => {
  it("rejects non-JSON containers without invoking accessors or coercion", () => {
    let reads = 0
    const getter = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => {
        reads++
        return 1
      }
    })
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    for (const value of [
      getter,
      cycle,
      new Date(),
      new Uint8Array(2),
      [undefined],
      NaN,
      Infinity,
      { value: () => 1 },
      "\ud800"
    ]) {
      expect(Schema.is(JsonValue)(value)).toBe(false)
    }
    expect(reads).toBe(0)
    expect(
      Schema.is(JsonValue)({ text: "Synthetic", amount: 1.5, nested: [null, true] })
    ).toBe(true)
  })
  it("enforces canonical UTF-8 bytes and depth before traversing an unsafe wire value", () => {
    expect(Schema.is(JsonValue)("a".repeat(65534))).toBe(true)
    expect(Schema.is(JsonValue)("a".repeat(65535))).toBe(false)
    let nested: unknown = null
    for (let depth = 0; depth < 32; depth++) {
      nested = [nested]
    }
    expect(Schema.is(JsonValue)(nested)).toBe(true)
    expect(Schema.is(JsonValue)([nested])).toBe(false)
  })
  it("strictly rejects caller authority and absent guards", () => {
    const decode = Schema.decodeUnknownSync(JobRepairCommand, {
      onExcessProperty: "error"
    })
    expect(decode(input).action).toBe("corrected-redrive")
    for (const extra of [
      { trusted: true },
      { producer: {} },
      { policy: {} },
      { confirmDuplicateEffects: false },
      { investigation: { _tag: "KnownFailure", proof: true } }
    ]) {
      expect(() => decode({ ...input, ...extra })).toThrow()
    }
    expect(Schema.is(Reason)(" \n")).toBe(false)
    expect(Schema.is(Reason)("a\0b")).toBe(false)
    expect(Schema.is(Reason)("😀".repeat(257))).toBe(false)
  })
})
