import { describe, expect, it } from "vitest"
import { Cause, Effect, Exit, Schema } from "effect"
import { maximumMillis } from "effect-jobs/JobPolicy"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import { StoredReceipt } from "../../src/persistence/commands/Transactions.js"
import * as Rows from "../../src/persistence/authority/CommandRows.js"

const assertUnavailable = async (effect: Effect.Effect<unknown, PlaygroundError>) => {
  const exit = await Effect.runPromiseExit(effect)
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(exit.cause.reasons.map((reason) => reason._tag)).toEqual(["Fail"])
    const reason = exit.cause.reasons[0]!
    if (Cause.isFailReason(reason)) {
      expect(reason.error).toEqual(new PlaygroundError({ code: "unavailable" }))
      expect(Object.keys(reason.error).sort()).toEqual(["_tag", "code"])
    }
  }
}

const malformedIntegers: ReadonlyArray<unknown> = [
  null,
  undefined,
  true,
  false,
  "",
  " ",
  " 1",
  "1 ",
  "01",
  "+1",
  "-0",
  "-1",
  "1.0",
  "1.5",
  "1e3",
  "0x10",
  "NaN",
  "Infinity",
  "1\n",
  "1\r",
  "1\u2028",
  "1\u2029",
  "9007199254740992",
  "9223372036854775807",
  "9".repeat(1_000),
  -1,
  0.5,
  NaN,
  Infinity,
  -Infinity,
  Number.MAX_SAFE_INTEGER + 1,
  -1n,
  9_007_199_254_740_992n,
  9_223_372_036_854_775_807n,
  {},
  [],
  { valueOf: () => 1 },
  { toString: () => "1" }
]

describe("command persisted integer decoding", () => {
  it.each([0, 1, Number.MAX_SAFE_INTEGER])(
    "accepts exact count %s in native forms",
    async (value) => {
      for (const input of [value, BigInt(value), String(value)]) {
        expect(await Effect.runPromise(Rows.decodeCount(input))).toBe(value)
      }
    }
  )

  it.each(malformedIntegers)(
    "rejects malformed count %# in the bounded typed channel",
    async (input) => {
      await assertUnavailable(Rows.decodeCount(input))
    }
  )

  it("uses EpochMillis bounds for all native timestamp forms", async () => {
    for (const value of [1, maximumMillis]) {
      for (const input of [value, BigInt(value), String(value)]) {
        expect(await Effect.runPromise(Rows.decodeMillis(input))).toBe(value)
      }
    }
    for (const input of [
      ...malformedIntegers,
      0,
      0n,
      "0",
      maximumMillis + 1,
      BigInt(maximumMillis) + 1n,
      String(maximumMillis + 1)
    ]) {
      await assertUnavailable(Rows.decodeMillis(input))
    }
  })

  it("matches SandboxRef positive generation bounds", async () => {
    for (const value of [1, Number.MAX_SAFE_INTEGER]) {
      for (const input of [value, BigInt(value), String(value)]) {
        expect(await Effect.runPromise(Rows.decodeGeneration(input))).toBe(value)
      }
    }
    for (const input of [...malformedIntegers, 0, 0n, "0"]) {
      await assertUnavailable(Rows.decodeGeneration(input))
    }
  })
})

const sandbox = { sandboxId: "synthetic-sandbox", generation: 1 }
const scenario = {
  _tag: "Scenario",
  command: { sandbox, requestId: "scenario-request", scenario: "success", count: 1 },
  result: {
    _tag: "Committed",
    sandbox,
    requestId: "scenario-request",
    jobIds: ["synthetic-job"]
  }
}
const reset = {
  _tag: "Reset",
  command: { sandbox, requestId: "reset-request" },
  result: {
    _tag: "Committed",
    previous: sandbox,
    current: { ...sandbox, generation: 2 },
    requestId: "reset-request"
  }
}

describe("command persisted receipt decoding", () => {
  it.each([
    scenario,
    reset,
    {
      ...reset,
      result: { _tag: "OutcomeUnknown", previous: sandbox, requestId: "reset-request" }
    }
  ])("accepts canonical StoredReceipt %#", async (input) => {
    const canonical = Schema.decodeUnknownSync(StoredReceipt)(input, {
      onExcessProperty: "error"
    })
    expect(await Effect.runPromise(Rows.decodeReceiptRows([{ receipt: input }]))).toEqual(
      canonical
    )
  })

  it.each([
    null,
    undefined,
    {},
    [],
    true,
    "{malformed-json",
    JSON.stringify(scenario),
    { ...scenario, unexpected: "private-payload" },
    { ...scenario, command: { ...scenario.command, unexpected: "private-payload" } },
    { ...scenario, command: { ...scenario.command, count: null } },
    { ...scenario, result: { ...scenario.result, jobIds: [] } },
    { ...scenario, result: { ...scenario.result, _tag: "OutcomeUnknown" } },
    { ...reset, result: { ...reset.result, current: sandbox } },
    {
      ...reset,
      result: { ...reset.result, current: { ...sandbox, sandboxId: "different" } }
    }
  ])(
    "rejects invalid receipt %# without payload diagnostics or NULL fallback",
    async (input) => {
      await assertUnavailable(Rows.decodeReceiptRows([{ receipt: input }]))
    }
  )
})

describe("command compiled projection decoding", () => {
  it("uses empty receipt rows as absence and preserves a present JSON receipt", async () => {
    expect(await Effect.runPromise(Rows.decodeReceiptRows([]))).toBeNull()
    const canonical = Schema.decodeUnknownSync(StoredReceipt)(scenario, {
      onExcessProperty: "error"
    })
    expect(
      await Effect.runPromise(Rows.decodeReceiptRows([{ receipt: scenario }]))
    ).toEqual(canonical)
  })

  it.each([
    null,
    undefined,
    {},
    [null],
    [{}],
    [{ receipt: null }],
    [{ receipt: undefined }],
    [{ receipt: JSON.stringify(scenario) }],
    [{ receipt: { ...scenario, unexpected: "private-payload" } }],
    [{ receipt: scenario, unexpected: "private-payload" }],
    [{ receipt: scenario }, { receipt: scenario }]
  ])("rejects malformed present receipt projection %#", async (input) => {
    await assertUnavailable(Rows.decodeReceiptRows(input))
  })

  it("decodes physical request_id columns without identifier normalization", async () => {
    expect(await Effect.runPromise(Rows.decodeAdmissionRows([]))).toEqual([])
    for (const requestId of ["request", " request ", "e\u0301", "é"]) {
      expect(
        await Effect.runPromise(Rows.decodeAdmissionRows([{ request_id: requestId }]))
      ).toEqual([{ request_id: requestId }])
    }
  })

  it.each([
    null,
    undefined,
    {},
    [null],
    [{}],
    [{ request_id: null }],
    [{ request_id: 1 }],
    [{ request_id: "" }],
    [{ request_id: "x".repeat(129) }],
    [{ requestId: "camel-case-mapper-is-absent" }],
    [{ request_id: "request", extra: "private-payload" }],
    [{ request_id: "request" }, { request_id: "request" }]
  ])("rejects malformed or unmapped admission projection %#", async (input) => {
    await assertUnavailable(Rows.decodeAdmissionRows(input))
  })
})
