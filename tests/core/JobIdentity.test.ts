import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
  CatalogIdentity,
  InvalidOperationId,
  JobDeclarationError,
  OperationId,
  ProducerIdentity,
  validateOperationId,
  validateProducerDeclaration
} from "../../src/JobIdentity.js"

describe("identity boundaries", () => {
  it.each(["x", "x".repeat(256), "é".repeat(128), "😀".repeat(64), " é ", "é", "é"])(
    "accepts exact scalar strings without normalization",
    (operationId) => {
      expect(() => validateOperationId(operationId)).not.toThrow()
      expect(Schema.decodeSync(OperationId)(operationId)).toBe(operationId)
    }
  )
  it.each([
    ["", "utf8-length", 0],
    ["x".repeat(257), "utf8-length", 257],
    ["é".repeat(128) + "x", "utf8-length", 257],
    ["\ud800", "unicode-scalars", undefined],
    ["\udfff", "unicode-scalars", undefined],
    ["secret\u0000", "no-nul", undefined]
  ] as const)("rejects malformed IDs without echoing them", (value, rule, byteLength) => {
    let failure: unknown
    try {
      validateOperationId(value)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(InvalidOperationId)
    expect(failure).toMatchObject({ rule })
    expect((failure as InvalidOperationId).byteLength).toBe(byteLength)
    expect(Object.keys(failure as object)).not.toContain("value")
    expect(Schema.is(OperationId)(value)).toBe(false)
  })
  it("preserves producer values exactly and does not narrow application IDs", () => {
    const producer = { operation: "billing.issue", slot: "email", operationId: " é " }
    expect(Schema.decodeSync(ProducerIdentity)(producer)).toEqual(producer)
    expect("é").not.toBe("é")
  })
  it("validates retained catalog name and version bounds", () => {
    const valid = { queue: "a".repeat(64), kind: "a".repeat(128), version: 32_767 }
    expect(Schema.is(CatalogIdentity)(valid)).toBe(true)
    for (const invalid of [
      { ...valid, queue: "a".repeat(65) },
      { ...valid, kind: "a".repeat(129) },
      { ...valid, queue: "A" },
      { ...valid, kind: "a_b" },
      { ...valid, version: 0 },
      { ...valid, version: 32_768 },
      { ...valid, version: 1.5 }
    ]) {
      expect(Schema.is(CatalogIdentity)(invalid)).toBe(false)
    }
  })
  it("accepts length edges for producer declaration names", () => {
    expect(() =>
      validateProducerDeclaration({ operation: "a", slots: ["a", "a".repeat(128)] })
    ).not.toThrow()
    expect(() =>
      validateProducerDeclaration({ operation: "a".repeat(128), slots: ["a.b-0"] })
    ).not.toThrow()
  })
  it.each(["", "a".repeat(129), "A", "a_b", "é", "a\n", "0a", " a"])(
    "reports actionable operation and indexed slot diagnostics",
    (value) => {
      for (const [input, field] of [
        [{ operation: value, slots: ["ok"] }, "operation"],
        [{ operation: "ok", slots: ["ok", value] }, "slots[1]"]
      ] as const) {
        try {
          validateProducerDeclaration(input)
          expect.fail("must reject")
        } catch (error) {
          expect(error).toBeInstanceOf(JobDeclarationError)
          expect(error).toMatchObject({
            field,
            value,
            expected: "1–128 ASCII characters matching ^[a-z][a-z0-9.-]*$"
          })
        }
      }
    }
  )
  it("rejects empty and duplicate slots at the declaration boundary", () => {
    expect(() => validateProducerDeclaration({ operation: "ok", slots: [] })).toThrow(
      JobDeclarationError
    )
    expect(() =>
      validateProducerDeclaration({ operation: "ok", slots: ["ok", "ok"] })
    ).toThrow(JobDeclarationError)
  })
})
