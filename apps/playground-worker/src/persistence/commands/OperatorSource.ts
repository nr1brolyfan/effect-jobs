import { Effect, Schema, SchemaGetter, SchemaParser } from "effect"
import { CatalogIdentity } from "effect-jobs/JobIdentity"
import * as Codec from "effect-jobs/JobPayloadCodec"
import type { JobOperatorCommand } from "@effect-jobs/playground-contracts/Operators"
import type { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import * as Definitions from "../../scenarios/Definitions.js"

export class OperatorSourceRejected extends Schema.TaggedError<OperatorSourceRejected>()(
  "OperatorSourceRejected",
  {
    reason: Schema.Literals(["invalid-artifact", "unsupported-catalog"])
  }
) {}
const invalid = () => new OperatorSourceRejected({ reason: "invalid-artifact" })
const byteBuffer = Schema.instanceOf(Uint8Array).pipe(
  Schema.check(
    Schema.makeFilter((bytes) => bytes.byteLength > 0 && bytes.byteLength <= 65536)
  )
)
const artifact = Schema.Struct({
  formatVersion: Schema.Literal(1),
  payloadBytes: byteBuffer,
  semanticProjectionBytes: byteBuffer
})

const CatalogRow = Schema.Struct({
  queue: Schema.Unknown.pipe(Schema.optionalKey),
  kind: Schema.Unknown.pipe(Schema.optionalKey),
  version: Schema.Unknown.pipe(Schema.optionalKey)
}).pipe(
  Schema.decodeTo(Schema.toType(CatalogIdentity), {
    decode: SchemaGetter.transformEffect((row) =>
      SchemaParser.decodeUnknownEffect(CatalogIdentity)({
        queue: row.queue,
        name: row.kind,
        version: Number(row.version)
      })
    ),
    encode: SchemaGetter.forbiddenEncoding
  })
)
const ArtifactRow = Schema.Struct({
  format_version: Schema.Unknown.pipe(Schema.optionalKey),
  payload: Schema.Unknown.pipe(Schema.optionalKey),
  projection: Schema.Unknown.pipe(Schema.optionalKey)
}).pipe(
  Schema.decodeTo(Schema.toType(artifact), {
    decode: SchemaGetter.transformEffect((row) =>
      SchemaParser.decodeUnknownEffect(artifact)({
        formatVersion: Number(row.format_version),
        payloadBytes: row.payload,
        semanticProjectionBytes: row.projection
      })
    ),
    encode: SchemaGetter.forbiddenEncoding
  })
)

// Includes the whole scoped source/request tuple, with a bounded library operationId.
// This creates a new provider ledger identity; no original acceptance is transferred.
export const producerIdentity = (command: JobOperatorCommand) =>
  Effect.gen(function* () {
    const tuple = new TextEncoder().encode(
      JSON.stringify([
        command.sandbox.sandboxId,
        command.sandbox.generation,
        command.requestId,
        command.jobId
      ])
    )
    const operationId = yield* Effect.tryPromise({
      try: async () =>
        Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", tuple)), (byte) =>
          byte.toString(16).padStart(2, "0")
        ).join(""),
      catch: invalid
    })
    return Object.freeze({
      operation: "playground.operator-redrive",
      operationId,
      slot: "replacement"
    })
  })

// Command-only private decoding. Ordinary detail/list reads never call this.
// Generic snapshot, canonical bytes and first-policy validation also belong to
// library redrive. This adds the application's scoped payload/invariant checks.
export const validate = (row: Readonly<Record<string, unknown>>, current: SandboxRef) =>
  Effect.gen(function* () {
    const definitions = yield* Definitions.Definitions

    const catalog = yield* Schema.decodeUnknownEffect(CatalogRow)(row).pipe(
      Effect.mapError(() => new OperatorSourceRejected({ reason: "unsupported-catalog" }))
    )
    const definition = definitions.definitions.find(
      (candidate) =>
        definitions.catalogFor(candidate).queue === catalog.queue &&
        candidate.name === catalog.name &&
        candidate.version === catalog.version
    )
    if (!definition) {
      return yield* new OperatorSourceRejected({ reason: "unsupported-catalog" })
    }
    const checked = yield* Schema.decodeUnknownEffect(ArtifactRow)(row).pipe(
      Effect.mapError(invalid)
    )
    const encoded = {
      ...checked,
      payloadBytes: new Uint8Array(checked.payloadBytes),
      semanticProjectionBytes: new Uint8Array(checked.semanticProjectionBytes)
    }
    const scoped = (payload: Definitions.Payload) =>
      payload.sandbox.sandboxId === current.sandboxId &&
      payload.sandbox.generation === current.generation
    if (
      definition === definitions.PrivateDataExport ||
      definition === definitions.SyntheticDocumentExport
    ) {
      const payload = yield* Codec.decodeJobPayload(
        definition === definitions.SyntheticDocumentExport
          ? definitions.SyntheticExportPayload
          : definitions.ExportPayload,
        encoded
      ).pipe(Effect.mapError(invalid))
      if (
        !scoped(payload) ||
        payload.document.subject !== payload.actor ||
        payload.document.tenant !== payload.tenant
      ) {
        return yield* invalid()
      }
    } else {
      const payload = yield* Codec.decodeJobPayload(Definitions.Payload, encoded).pipe(
        Effect.mapError(invalid)
      )
      if (!scoped(payload)) {
        return yield* invalid()
      }
    }
    return definition
  })
