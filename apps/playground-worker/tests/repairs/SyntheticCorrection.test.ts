import { definitions, runPromise } from "../scenarios/Setup.js"
import { describe, expect, it } from "vitest"
import { Effect, Exit, Schema } from "effect"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Crypto from "@effect-jobs/playground-contracts/SyntheticCryptoFixture"
import * as Source from "../../src/persistence/commands/RepairSource.js"
import * as Projection from "../../src/server/read/JobDetailsProjection.js"
import * as Diff from "../../../playground/src/features/jobs/repair/PayloadDiff.js"
import * as Fixture from "./Fixtures.js"

describe("authenticated synthetic document correction", () => {
  it("authenticates encrypted input and computes real changes while preserving source", async () => {
    await runPromise(
      Effect.gen(function* () {
        const document: Crypto.Document = {
          subject: "demo-customer",
          tenant: "demo-tenant-a",
          note: "before"
        }
        const original = { ...Fixture.payload, document }
        const artifact = yield* Codec.encodeJobPayload(
          definitions.SyntheticExportPayload,
          original
        )
        const bytes = new Uint8Array(artifact.payloadBytes)
        const row = {
          ...Fixture.sourceRow,
          queue: definitions.catalogFor(definitions.SyntheticDocumentExport).queue,
          kind: definitions.catalogFor(definitions.SyntheticDocumentExport).name,
          version: definitions.catalogFor(definitions.SyntheticDocumentExport).version,
          format_version: 1,
          payload: bytes,
          projection: artifact.semanticProjectionBytes,
          relations: { ...Fixture.sourceRow.relations, syntheticTenant: original.tenant }
        }
        const changed = {
          ...original,
          behavior: "success" as const,
          document: { ...document, note: "after" }
        }
        const wire = yield* Schema.encodeEffect(definitions.SyntheticExportPayload)(
          changed
        )
        const prepared = yield* Source.replacement(row, Fixture.ref, wire)
        expect(prepared._tag).toBe("Synthetic")
        expect(prepared.payload).toEqual(changed)
        expect(prepared.changes).toEqual([
          { kind: "Changed", path: "/behavior" },
          { kind: "Changed", path: "/document/note" }
        ])
        const stored = JSON.parse(new TextDecoder().decode(bytes))
        expect(wire.document.fingerprint).not.toBe(stored.document.fingerprint)
        expect(wire.document.nonce).not.toEqual(stored.document.nonce)
        expect(bytes).toEqual(artifact.payloadBytes)
        for (const invalid of [
          changed, // Plaintext command input is never accepted.
          {
            ...wire,
            document: {
              ...wire.document,
              ciphertext: wire.document.ciphertext.map((byte, i) =>
                i === 0 ? byte ^ 1 : byte
              )
            }
          },
          { ...wire, document: { ...wire.document, fingerprint: "0".repeat(64) } },
          { ...wire, sandbox: { ...Fixture.ref, generation: 2 } },
          { ...wire, tenant: "demo-tenant-b" },
          { ...wire, policy: {} }
        ]) {
          expect(
            Exit.isFailure(
              yield* Effect.exit(Source.replacement(row, Fixture.ref, invalid))
            )
          ).toBe(true)
        }
        const mismatched = yield* Schema.encodeEffect(definitions.SyntheticExportPayload)(
          { ...changed, document: { ...document, tenant: "demo-tenant-b" } }
        )
        expect(
          Exit.isFailure(
            yield* Effect.exit(Source.replacement(row, Fixture.ref, mismatched))
          )
        ).toBe(true)
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              Source.replacement(
                {
                  ...row,
                  kind: definitions.catalogFor(definitions.PrivateDataExport).name
                },
                Fixture.ref,
                wire
              )
            )
          )
        ).toBe(true)
        const detail = {
          ...Fixture.detail,
          job: {
            ...Fixture.detail.job,
            catalog: definitions.catalogFor(definitions.SyntheticDocumentExport)
          }
        }
        const view = yield* Projection.payload(detail, row, definitions)
        expect(view._tag).toBe("Available")
        expect(JSON.stringify(view)).not.toContain('"note"')
        expect(
          Projection.eligibility(detail, detail.problem, view, definitions)
            .correctedRedrive.enabled
        ).toBe(true)
        expect(
          Projection.eligibility(
            detail,
            detail.problem,
            {
              _tag: "Unavailable",
              reason: "invalid-artifact"
            },
            definitions
          ).correctedRedrive.enabled
        ).toBe(false)
        const full = { ...detail, payload: view }
        const editor = JSON.stringify(changed)
        expect(Diff.parseReplacement(full, editor).valid).toBe(false)
        expect(Diff.parseReplacement(full, editor, document)).toMatchObject({
          valid: true,
          changes: [
            { kind: "Changed", path: "/behavior" },
            { kind: "Changed", path: "/document/note" }
          ]
        })
        for (const bad of [
          { ...changed, document: { ...document, note: "x".repeat(257) } },
          { ...changed, document: { ...document, tenant: "demo-tenant-b" } },
          { ...changed, document: wire.document },
          {
            ...changed,
            tenant: "demo-tenant-b",
            document: { ...document, tenant: "demo-tenant-b" }
          }
        ]) {
          expect(Diff.parseReplacement(full, JSON.stringify(bad), document).valid).toBe(
            false
          )
        }
        expect(
          Projection.eligibility(
            { job: { ...detail.job, state: "Active" } },
            null,
            view,
            definitions
          ).correctedRedrive.enabled
        ).toBe(false)
      })
    )
  })
})
