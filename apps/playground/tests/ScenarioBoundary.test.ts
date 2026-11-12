import { describe, expect, it } from "vitest"
import { Effect, Exit, Schema } from "effect"
import * as Catalogs from "@effect-jobs/playground-contracts/ScenarioCatalogs"
import * as Payloads from "@effect-jobs/playground-contracts/ScenarioPayloads"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import * as WorkerDefinitions from "../../playground-worker/src/scenarios/Definitions.js"

const definitions = Effect.runSync(WorkerDefinitions.make)

describe("portable scenario boundary", () => {
  it("uses the same catalog identities as worker execution", () => {
    expect(Catalogs.definitions.map((definition) => definition.catalog)).toEqual(
      definitions.definitions.map((definition) => definition.catalog)
    )
  })

  it("preserves encoded payload acceptance without importing private codecs", () => {
    const valid = {
      sandbox: Fixtures.sandbox.ref,
      version: 1,
      seed: 42,
      sequence: 1,
      behavior: "success",
      actor: "demo-customer",
      tenant: "demo-tenant-a",
      order: "demo-order-a",
      document: {
        nonce: Array.from({ length: 12 }, () => 1),
        ciphertext: Array.from({ length: 16 }, () => 2),
        fingerprint: "a".repeat(64)
      }
    }
    const worker = Schema.toEncoded(definitions.SyntheticExportPayload)
    for (const candidate of [
      { value: valid, accepted: true },
      { value: { ...valid, sequence: 0 }, accepted: false },
      {
        value: { ...valid, document: { ...valid.document, nonce: [1] } },
        accepted: false
      },
      {
        value: { ...valid, document: { ...valid.document, fingerprint: "bad" } },
        accepted: false
      },
      {
        value: { ...valid, document: { ...valid.document, ciphertext: [] } },
        accepted: false
      },
      { value: { ...valid, extra: true }, accepted: false }
    ]) {
      const browserResult = Effect.runSyncExit(
        Schema.decodeUnknownEffect(Payloads.SyntheticExportPayload)(candidate.value, {
          onExcessProperty: "error"
        })
      )
      const workerResult = Effect.runSyncExit(
        Schema.decodeUnknownEffect(worker)(candidate.value, { onExcessProperty: "error" })
      )
      expect(Exit.isSuccess(browserResult)).toBe(candidate.accepted)
      expect(Exit.isSuccess(workerResult)).toBe(candidate.accepted)
      if (Exit.isSuccess(browserResult) && Exit.isSuccess(workerResult)) {
        expect(browserResult.value).toEqual(workerResult.value)
      }
    }
  })
})
