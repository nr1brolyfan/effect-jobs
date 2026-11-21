import { Context, Effect, Exit, Schema } from "effect"
import { expect, it } from "vitest"
import * as Job from "../../src/Job.js"
import * as Payload from "../../src/JobPayload.js"
import { encodeJobPayload, decodeJobPayload } from "../../src/JobPayloadCodec.js"
import { EncryptedDocument } from "./codec/EncryptedFixture.js"

it("reads each contract option only at execution and takes fresh frozen snapshots", () => {
  const reads = { name: 0, version: 0, payload: 0 }
  let name = "before"
  let version = 1
  const options = {
    get name() {
      reads.name++
      return name
    },
    get version() {
      reads.version++
      return version
    },
    get payload() {
      reads.payload++
      return Schema.String
    }
  }
  const setup = Job.make(options)
  expect(Effect.isEffect(setup)).toBe(true)
  expect(Object.values(reads)).toEqual([0, 0, 0])
  name = "after"
  version = 2
  const first = Effect.runSync(setup)
  expect(first).toEqual({ name: "after", version: 2, payload: Schema.String })
  expect(Object.values(reads)).toEqual([1, 1, 1])
  name = "next"
  version = 3
  const second = Effect.runSync(setup)
  expect(second).toEqual({ name: "next", version: 3, payload: Schema.String })
  expect(first.name).toBe("after")
  expect(second).not.toBe(first)
  expect(Object.values(reads)).toEqual([2, 2, 2])
  expect(Object.isFrozen(first)).toBe(true)
  expect(Object.isFrozen(options)).toBe(false)
})

it("preserves getter defects rather than misclassifying them as invalid configuration", () => {
  const defect = new Error("synthetic caller getter")
  const pending = Job.make({
    get name(): string {
      throw defect
    },
    payload: Schema.String
  })
  const exit = Effect.runSyncExit(pending)
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(exit.cause.reasons).toEqual([expect.objectContaining({ _tag: "Die", defect })])
  }
})

it.each([
  { name: "PRIVATE invalid name" },
  { version: 0 },
  { version: 32768 },
  { version: Number.NaN },
  { payload: { privateValue: "PRIVATE payload" } as never },
  { defaultPolicy: { privateValue: "PRIVATE policy" } as never }
])(
  "fails invalid configuration in the typed channel without exposing input",
  (invalid) => {
    const setup = Job.make({
      name: "invoice.send",
      payload: Schema.String,
      ...invalid
    })
    expect(Effect.isEffect(setup)).toBe(true)
    const result = Effect.runSyncExit(setup)
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      expect(result.cause.reasons).toHaveLength(1)
      const reason = result.cause.reasons[0]!
      expect(reason._tag).toBe("Fail")
      if (reason._tag === "Fail") {
        expect(reason.error).toBeInstanceOf(Job.InvalidJobDefinition)
        expect(Object.keys(reason.error).sort()).toEqual(["_tag", "expected"])
        expect(JSON.stringify(reason.error)).not.toContain("PRIVATE")
        expect(reason.error.expected).toBe("name, version and payload Schema only")
      }
    }
  }
)

it("revalidates on every execution and recovers after caller configuration is corrected", () => {
  const options = { name: "invoice.send", payload: Schema.String, version: 1 }
  const setup = Job.make(options)
  options.version = 0
  const rejected = Effect.runSyncExit(setup)
  expect(Exit.isFailure(rejected)).toBe(true)
  if (Exit.isFailure(rejected)) {
    expect(rejected.cause.reasons.map((reason) => reason._tag)).toEqual(["Fail"])
  }
  options.version = 2
  expect(Effect.runSync(setup).version).toBe(2)
})

it("identifies nested unsupported schemas using bounded declaration-only diagnostics", () => {
  const tuple = Schema.Tuple([Schema.Literal("PRIVATE literal"), Schema.String])
  const issue = (payload: Schema.Top) =>
    Effect.runSync(Effect.flip(Job.make({ name: "order.check", payload }))).schemaIssue
  expect(issue(Schema.Struct({ order: Schema.Struct({ range: tuple }) }))).toEqual({
    path: "/order/range",
    reason: "unsupported-tuple"
  })
  const escaped = issue(Schema.Struct({ "a~/\n": tuple }))
  expect(escaped).toEqual({ path: "/a~0~1\\u{a}", reason: "unsupported-tuple" })
  expect(JSON.stringify(escaped)).not.toContain("PRIVATE")
  const bounded = issue(Schema.Struct({ ["é".repeat(1000)]: tuple }))
  expect(new TextEncoder().encode(bounded!.path).byteLength).toBeLessThanOrEqual(1024)
  expect(bounded?.path.endsWith("…")).toBe(true)
})

it("rejects differing encryption coverage at a root or nested union during setup", () => {
  const first = Schema.Struct({ note: EncryptedDocument, tag: Schema.Literal("receipt") })
  const second = Schema.Struct({ tag: Schema.Literal("reminder") })
  const choice = Schema.Union([first, second])
  for (const [payload, path] of [
    [choice, ""],
    [Schema.Struct({ nested: Schema.Struct({ choice }) }), "/nested/choice"],
    [Schema.Array(choice), "/0"],
    [
      Schema.Union([
        Schema.Array(EncryptedDocument),
        Schema.Struct({ "0": EncryptedDocument })
      ]),
      ""
    ]
  ] as const) {
    const failure = Effect.runSync(
      Effect.flip(Job.make({ name: "receipt.send", payload }))
    )
    expect(failure).toBeInstanceOf(Job.InvalidJobDefinition)
    expect(failure.schemaIssue).toEqual({
      path,
      reason: "inconsistent-encryption-coverage"
    })
  }
})

it("accepts ordinary unions beside encryption and unions inside an encrypted field without services", () => {
  class Key extends Context.Service<Key, { readonly label: string }>()("test/Key") {}
  const channel = Schema.Literals(["email", "sms"])
  const envelope = Schema.Struct({
    fingerprint: Schema.String,
    ciphertext: Schema.String
  })
  let providerCalls = 0
  const seal = (value: "email" | "sms") => {
    providerCalls++
    return Effect.map(Key, ({ label }) => ({ fingerprint: label, ciphertext: value }))
  }
  const open = () => {
    providerCalls++
    return Effect.as(Key, "email" as const)
  }
  const encrypted = Effect.runSync(
    Payload.encrypted({
      schema: channel,
      codec: {
        envelope,
        seal,
        open
      }
    })
  )
  const payload = Schema.Struct({ channel, note: encrypted })
  expect(Effect.runSync(Job.make({ name: "order.send", payload })).payload).toBe(payload)
  expect(
    Effect.runSync(Job.make({ name: "order.send", payload: encrypted })).payload
  ).toBe(encrypted)
  expect(providerCalls).toBe(0)
})

it("accepts and round-trips 1,024-byte plain paths and rejects 1,025 bytes at setup", async () => {
  for (const key of ["x".repeat(256), "x".repeat(1023), "é".repeat(511) + "x"]) {
    const payload = Schema.Struct({ [key]: Schema.String })
    const job = Effect.runSync(Job.make({ name: "order.check", payload }))
    const value = { [key]: "value" }
    const encoded = await Effect.runPromise(encodeJobPayload(job.payload, value))
    expect(await Effect.runPromise(decodeJobPayload(job.payload, encoded))).toEqual(value)
  }
  for (const valueSchema of [Schema.String, EncryptedDocument]) {
    for (const key of ["x".repeat(1024), "é".repeat(512), "~".repeat(512)]) {
      const payload = Schema.Struct({ [key]: valueSchema })
      const failure = Effect.runSync(
        Effect.flip(Job.make({ name: "order.check", payload }))
      )
      expect(failure.schemaIssue?.reason).toBe("schema-path-too-long")
    }
  }
  const key = "x".repeat(1021)
  const payload = Schema.Array(Schema.Struct({ [key]: Schema.String }))
  expect(Effect.runSync(Job.make({ name: "order.check", payload })).payload).toBe(payload)
})
