import { definitions, runPromise } from "../scenarios/Setup.js"
import { describe, expect, it } from "vitest"
import { Effect, Exit, Schema } from "effect"
import type { EncodedJobPayload } from "effect-jobs/JobContract"
import { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import * as Codec from "effect-jobs/JobPayloadCodec"
import { JobOperatorCommand } from "@effect-jobs/playground-contracts/Operators"
import * as Definitions from "../../src/scenarios/Definitions.js"
import { keysLayer } from "../../src/scenarios/PrivateDocument.js"
import * as Source from "../../src/persistence/commands/OperatorSource.js"

const ref = Schema.decodeSync(SandboxRef)({ sandboxId: "private-a", generation: 1 })
const payload = {
  sandbox: ref,
  version: 1 as const,
  seed: 0,
  sequence: 1,
  behavior: "dead" as const,
  actor: "demo-customer" as const,
  tenant: "demo-tenant-a" as const,
  order: "demo-order-a" as const
}
const row = (encoded: EncodedJobPayload, definition = definitions.WelcomeEmail) => ({
  queue: definitions.catalogFor(definition).queue,
  kind: definition.name,
  version: definition.version,
  format_version: encoded.formatVersion,
  payload: encoded.payloadBytes,
  projection: encoded.semanticProjectionBytes
})

describe("private redrive source authority", () => {
  it("accepts exact supported scoped artifacts and rejects another sandbox/generation", async () => {
    await runPromise(
      Effect.gen(function* () {
        const encoded = yield* Codec.encodeJobPayload(Definitions.Payload, payload)
        const valid = row(encoded)
        expect(definitions.catalogFor(yield* Source.validate(valid, ref))).toEqual(
          definitions.catalogFor(definitions.WelcomeEmail)
        )
        for (const foreign of [
          { sandboxId: "private-b", generation: 1 },
          { ...ref, generation: 2 }
        ]) {
          expect(
            Exit.isFailure(
              yield* Effect.exit(
                Source.validate(valid, Schema.decodeSync(SandboxRef)(foreign))
              )
            )
          ).toBe(true)
        }
        expect(
          Exit.isFailure(
            yield* Effect.exit(Source.validate({ ...valid, kind: "unknown" }, ref))
          )
        ).toBe(true)
        const corrupt = { ...valid, projection: new TextEncoder().encode("{}") }
        expect(Exit.isFailure(yield* Effect.exit(Source.validate(corrupt, ref)))).toBe(
          true
        )
      }).pipe(Effect.provide(keysLayer))
    )
  })
  it("refuses decodable encrypted exports with mismatched domain authority", async () => {
    await runPromise(
      Effect.gen(function* () {
        for (const definition of [
          definitions.PrivateDataExport,
          definitions.SyntheticDocumentExport
        ]) {
          for (const tenant of ["demo-tenant-a", "demo-tenant-b"] as const) {
            const encoded = yield* Codec.encodeJobPayload(definition.payload, {
              ...payload,
              document: { subject: "demo-customer", tenant, note: "synthetic" }
            })
            const input = {
              ...row(encoded),
              queue: definitions.catalogFor(definition).queue,
              kind: definition.name,
              version: definition.version
            }
            const result = yield* Effect.exit(Source.validate(input, ref))
            expect(Exit.isSuccess(result)).toBe(tenant === payload.tenant)
          }
        }
      }).pipe(Effect.provide(keysLayer))
    )
  })
  it("derives a bounded deterministic producer from the exact scoped command", async () => {
    const command = Schema.decodeUnknownSync(JobOperatorCommand)({
      sandbox: ref,
      requestId: "x".repeat(128),
      jobId: "j".repeat(128),
      expectedState: "Dead",
      expectedLifecycleVersion: 1,
      action: "redrive",
      confirmDuplicateEffects: true
    })
    const identity = await runPromise(Source.producerIdentity(command))
    expect(identity.operationId).toHaveLength(64)
    expect(identity).toEqual(await runPromise(Source.producerIdentity(command)))
    expect(identity).not.toEqual(
      await runPromise(
        Source.producerIdentity({ ...command, sandbox: { ...ref, generation: 2 } })
      )
    )
    expect(identity.operation).toBe("playground.operator-redrive")
    expect(identity.slot).toBe("replacement")
  })
})
