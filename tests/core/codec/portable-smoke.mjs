// Direct built-module qualification, NOT an installed/public-subpath test.
// Run after build: node tests/core/codec/portable-smoke.mjs
//                  bun tests/core/codec/portable-smoke.mjs
import assert from "node:assert/strict"
import { Effect, Schema } from "effect"
import * as JobPayload from "../../../dist/JobPayload.js"
import { encodeJobPayload, decodeJobPayload } from "../../../dist/JobPayloadCodec.js"
import { JobPayloadCodecError } from "../../../dist/JobContract.js"

const Protected = JobPayload.protected(
  Schema.Struct({ ciphertext: Schema.String, fingerprint: Schema.String })
)
const Payload = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("public"), value: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("secret"),
    value: Protected,
    amount: Schema.NumberFromString
  })
])
const input = {
  kind: "secret",
  value: { ciphertext: "one", fingerprint: "stable" },
  amount: 1.5
}
const first = await Effect.runPromise(encodeJobPayload(Payload, input))
const second = await Effect.runPromise(
  encodeJobPayload(Payload, { ...input, value: { ...input.value, ciphertext: "two" } })
)
assert.notDeepEqual(first.payloadBytes, second.payloadBytes)
assert.deepEqual(first.semanticProjectionBytes, second.semanticProjectionBytes)
assert.equal(
  new TextDecoder().decode(first.semanticProjectionBytes),
  '{"amount":"1.5","kind":"secret","value":{"$protected":{"fingerprint":"stable","path":"/value"}}}'
)
assert.deepEqual(await Effect.runPromise(decodeJobPayload(Payload, first)), input)
const error = await Effect.runPromise(
  Effect.flip(
    decodeJobPayload(Payload, { ...first, semanticProjectionBytes: first.payloadBytes })
  )
)
assert.ok(error instanceof JobPayloadCodecError)
assert.equal(error.reason, "projection-mismatch")
console.log(
  `PASS built codec smoke: Node ${process.version}, Bun ${process.versions.bun ?? "absent"}`
)
