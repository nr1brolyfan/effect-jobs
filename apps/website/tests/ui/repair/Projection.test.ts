import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Definitions from "../../../../playground-worker/src/scenarios/Definitions.js"
import { keysLayer } from "../../../../playground-worker/src/scenarios/PrivateDocument.js"
import * as Projection from "../../../src/server/read/JobDetailsProjection.js"
import * as Diff from "../../../src/features/jobs/repair/PayloadDiff.js"
import * as Fixture from "../../../../playground-worker/tests/repairs/Fixtures.js"

describe("truthful allowlisted detail projection", () => {
  it("validates canonical unencrypted wire and rejects foreign/corrupt bytes", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const encoded = yield* Codec.encodeJobPayload(
          Definitions.Payload,
          Fixture.payload
        )
        const row = {
          format_version: 1,
          payload: encoded.payloadBytes,
          projection: encoded.semanticProjectionBytes
        }
        expect(yield* Projection.payload(Fixture.detail, row)).toMatchObject({
          _tag: "Available",
          encryption: "None",
          validation: "Valid"
        })
        expect(
          yield* Projection.payload(Fixture.detail, {
            ...row,
            projection: new TextEncoder().encode("{}")
          })
        ).toEqual({ _tag: "Unavailable", reason: "invalid-artifact" })
        expect(
          yield* Projection.payload(
            { ...Fixture.detail, sandbox: { ...Fixture.ref, generation: 2 } },
            row
          )
        ).toEqual({ _tag: "Unavailable", reason: "invalid-artifact" })
        expect(yield* Projection.payload(Fixture.detail, { payload: null })).toEqual({
          _tag: "Unavailable",
          reason: "not-stored"
        })
      })
    )
  })
  it("returns only schema-valid ciphertext envelope without requiring/using keys or plaintext", async () => {
    const encoded = await Effect.runPromise(
      Codec.encodeJobPayload(Definitions.ExportPayload, {
        ...Fixture.payload,
        document: {
          subject: Fixture.payload.actor,
          tenant: Fixture.payload.tenant,
          note: "private-synthetic-note"
        }
      }).pipe(Effect.provide(keysLayer))
    )
    const detail = {
      ...Fixture.detail,
      job: { ...Fixture.detail.job, catalog: Definitions.PrivateDataExport.catalog }
    }
    // If wire validation accidentally invokes decryption, the missing key service
    // fails this test. The wire is the ACTUAL encrypted codec output above.
    const result = await Effect.runPromise(
      Projection.payload(detail, {
        format_version: 1,
        payload: encoded.payloadBytes,
        projection: encoded.semanticProjectionBytes
      })
    )
    expect(result).toMatchObject({ _tag: "Available", encryption: "PrivateDocumentV1" })
    expect(JSON.stringify(result)).not.toContain("private-synthetic-note")
    expect(
      Projection.eligibility(detail, Fixture.detail.problem, result).correctedRedrive
        .reason
    ).toBe("encrypted-correction-unavailable")
  })
  it("reports absent attempts and result without overriding persisted creation time", () => {
    expect(Projection.retainedFields).toEqual({
      result: { _tag: "Unavailable", reason: "not-stored" }
    })
    expect(Fixture.detail.history.attempts).toBeNull()
  })
  it("keeps encrypted correction unavailable when the original envelope is absent", () => {
    const detail = {
      job: { ...Fixture.detail.job, catalog: Definitions.PrivateDataExport.catalog }
    }
    expect(
      Projection.eligibility(detail, Fixture.detail.problem, {
        _tag: "Unavailable",
        reason: "not-stored"
      }).correctedRedrive.reason
    ).toBe("encrypted-correction-unavailable")
  })
})
describe("repair editor boundary", () => {
  it("shows Added/Removed/Changed JSON pointers without values", () => {
    expect(
      Diff.diff({ "a/b": 1, remove: true }, { "a/b": 2, add: "private-value" })
    ).toEqual([
      { kind: "Changed", path: "/a~1b" },
      { kind: "Added", path: "/add" },
      { kind: "Removed", path: "/remove" }
    ])
    expect(JSON.stringify(Diff.diff({}, { secret: "private-value" }))).not.toContain(
      "private-value"
    )
  })
  it("requires bounded nonblank reason and validates full synthetic replacement", () => {
    for (const bad of ["", "  ", "x".repeat(513), "a\0b", "\ud800", "😀".repeat(300)]) {
      expect(Diff.validReason(bad)).toBe(false)
    }
    expect(Diff.validReason("Investigated synthetic failure")).toBe(true)
    expect(
      Diff.parseReplacement(
        Fixture.detail,
        JSON.stringify({ ...Fixture.payload, behavior: "success" })
      )
    ).toMatchObject({ valid: true, changes: [{ kind: "Changed", path: "/behavior" }] })
    for (const bad of [
      "{",
      JSON.stringify({ ...Fixture.payload, tenant: "demo-tenant-b" }),
      JSON.stringify({ ...Fixture.payload, policy: {} }),
      " ".repeat(65537)
    ]) {
      expect(Diff.parseReplacement(Fixture.detail, bad).valid).toBe(false)
    }
  })
})
