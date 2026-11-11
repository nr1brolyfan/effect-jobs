import assert from "node:assert/strict"
import { Cause, Effect, Exit, Result, Schema } from "effect"
import { it } from "vitest"
import { JobPayloadCodecError } from "../../../src/JobContract.js"
import * as Codec from "../../../src/JobPayloadCodec.js"
import * as Payload from "../../../src/JobPayload.js"
import { project } from "../../../src/internal/codec/ProtectedProjection.js"
import {
  canonicalText,
  canonicalBytes
} from "../../../src/internal/codec/CanonicalJson.js"

it("returns recoverable canonical validation as a typed Result without throwing", () => {
  const invalid = canonicalText({ value: Infinity }, 65536, "payload-too-large")
  assert(Result.isFailure(invalid))
  assert(invalid.failure instanceof JobPayloadCodecError)
  assert.equal(invalid.failure.reason, "invalid-json-value")
})

it("preserves canonical reason precedence and isolates repeated executions", async () => {
  const input = { value: "before" }
  const effect = canonicalBytes(input, 65536, "payload-too-large")
  const first = await Effect.runPromise(effect)
  input.value = "after"
  const results = await Effect.runPromise(
    Effect.all([effect, effect], { concurrency: 2 })
  )
  assert.equal(new TextDecoder().decode(first), '{"value":"before"}')
  assert.equal(new TextDecoder().decode(results[0]), '{"value":"after"}')
  assert.deepEqual(results[0], results[1])
  assert.notEqual(results[0], results[1])
  const error = await Effect.runPromise(
    Effect.flip(canonicalBytes([Infinity], 1, "payload-too-large"))
  )
  assert.equal(error.reason, "payload-too-large")
})

it("retains bounded typed failures for foreign proxy and artifact access exceptions", async () => {
  const proxy = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error("PRIVATE")
      }
    }
  )
  const canonical = await Effect.runPromise(
    Effect.flip(canonicalBytes(proxy, 65536, "payload-too-large"))
  )
  assert.equal(canonical.reason, "invalid-json-value")
  const artifact = Object.defineProperty({}, "formatVersion", {
    get() {
      throw new Error("PRIVATE")
    }
  })
  const decoded = await Effect.runPromise(
    Effect.flip(Codec.decodeJobPayload(Schema.Null, artifact as never))
  )
  assert.equal(decoded.reason, "invalid-encoding")
  assert.equal(String(decoded).includes("PRIVATE"), false)
})

it("reinitializes protected projection scratch and stops before later foreign reads", async () => {
  const schema = Schema.Array(Payload.protected(Schema.Unknown))
  const input = Array.from({ length: 16 }, () => ({ fingerprint: "stable" }))
  const effect = project(schema.ast, input)
  const results = await Effect.runPromise(
    Effect.all([effect, effect], { concurrency: 2 })
  )
  assert.deepEqual(results[0], results[1])
  assert.notEqual(results[0], results[1])
  let reads = 0
  const invalid: Array<unknown> = [{}, null]
  Object.defineProperty(invalid, "1", {
    get() {
      reads++
      throw new Error("PRIVATE")
    }
  })
  const exit = await Effect.runPromiseExit(project(schema.ast, invalid))
  assert(Exit.isFailure(exit))
  const reason = exit.cause.reasons[0]!
  assert(Cause.isFailReason(reason))
  assert.equal(reason.error.reason, "invalid-protected-value")
  assert.equal(reads, 0)
})

it("preserves artifact validation precedence and laziness before application decoding", async () => {
  const projection = Object.defineProperty(new Uint8Array(), "byteLength", {
    get() {
      throw new Error("PRIVATE")
    }
  })
  const artifact = {
    formatVersion: 1 as const,
    payloadBytes: new Uint8Array(65537),
    semanticProjectionBytes: projection
  }
  const effect = Codec.decodeJobPayload(Schema.Null, artifact)
  const error = await Effect.runPromise(Effect.flip(effect))
  assert.equal(error.reason, "payload-too-large")
  const malformed = { ...artifact, formatVersion: 2 }
  const malformedError = await Effect.runPromise(
    Effect.flip(Codec.decodeJobPayload(Schema.Null, malformed as never))
  )
  assert.equal(malformedError.reason, "invalid-encoding")
  let reads = 0
  const readable = Object.defineProperty({}, "formatVersion", {
    get() {
      reads++
      return 2
    }
  })
  const deferred = Codec.decodeJobPayload(Schema.Null, readable as never)
  assert.equal(reads, 0)
  await Effect.runPromise(Effect.flip(deferred))
  await Effect.runPromise(Effect.flip(deferred))
  assert.equal(reads, 2)
})
