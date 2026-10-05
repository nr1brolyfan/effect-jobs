import { Effect, Schema, SchemaAST } from "effect"
import {
  JobPayloadCodecError,
  jobPayloadFormatVersion,
  maximumJobPayloadBytes,
  maximumJobSemanticProjectionBytes
} from "./JobContract.js"
import type {
  JobPayloadEncoder,
  JobPayloadDecoder,
  EncodedJobPayload
} from "./JobContract.js"
import {
  bytesEqual,
  canonicalBytes,
  checkDecodedContainers
} from "./internal/codec/CanonicalJson.js"
import { prepareProjection, project } from "./internal/codec/ProtectedProjection.js"

const strict = { onExcessProperty: "error" } as const

/**
 * Encodes the validated wire representation, not the decoded domain object.
 * Structs, arrays, absent optional keys and unions are supported. Domain
 * transforms must have a JSON encoded side; transforms across protected markers,
 * recursive/custom shapes, records and tuples fail with invalid-schema.
 * Each returned buffer is owned independently by this execution. Receivers must
 * copy buffers before retaining them; readonly properties do not freeze bytes.
 */
export const encodeJobPayload: JobPayloadEncoder = Effect.fnUntraced(function* <
  S extends Schema.Top
>(schema: S, payload: S["Type"]) {
  const ast = yield* prepareProjection(schema)
  yield* checkDecodedContainers(payload)
  // Check own marker fields before Schema can rebuild inherited properties.
  yield* project(SchemaAST.toType(schema.ast), payload)
  const value = yield* Schema.encodeEffect(
    schema,
    strict
  )(payload).pipe(
    Effect.mapError(() => new JobPayloadCodecError({ reason: "invalid-schema" }))
  )
  const payloadBytes = yield* canonicalBytes(
    value,
    maximumJobPayloadBytes,
    "payload-too-large"
  )
  yield* Schema.decodeUnknownEffect(
    Schema.make<Schema.Codec<unknown>>(ast),
    strict
  )(value).pipe(
    Effect.mapError(() => new JobPayloadCodecError({ reason: "invalid-schema" }))
  )
  const projection = yield* project(ast, value)
  const semanticProjectionBytes = yield* canonicalBytes(
    projection,
    maximumJobSemanticProjectionBytes,
    "projection-too-large",
    // The representation envelope is not an application-data depth level.
    -1
  )
  return { formatVersion: jobPayloadFormatVersion, payloadBytes, semanticProjectionBytes }
})

const readArtifact = (encoded: EncodedJobPayload) =>
  Effect.try({
    try: () => {
      if (
        encoded.formatVersion !== jobPayloadFormatVersion ||
        !(encoded.payloadBytes instanceof Uint8Array) ||
        !(encoded.semanticProjectionBytes instanceof Uint8Array)
      ) {
        throw new JobPayloadCodecError({ reason: "invalid-encoding" })
      }
      if (encoded.payloadBytes.byteLength > maximumJobPayloadBytes) {
        throw new JobPayloadCodecError({ reason: "payload-too-large" })
      }
      if (
        encoded.semanticProjectionBytes.byteLength > maximumJobSemanticProjectionBytes
      ) {
        throw new JobPayloadCodecError({ reason: "projection-too-large" })
      }
      // Snapshot before any application service can yield or mutate retained input.
      return {
        payloadBytes: new Uint8Array(encoded.payloadBytes),
        semanticProjectionBytes: new Uint8Array(encoded.semanticProjectionBytes)
      }
    },
    catch: (error) =>
      error instanceof JobPayloadCodecError
        ? error
        : new JobPayloadCodecError({ reason: "invalid-encoding" })
  })

const parse = (bytes: Uint8Array) =>
  Effect.try({
    try: (): unknown =>
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
      ),
    catch: () => new JobPayloadCodecError({ reason: "invalid-encoding" })
  })

/** Validates canonical format, bounds, schema and semantic projection before
 * invoking domain decoding. Consistent projection bytes are not authenticity. */
export const decodeJobPayload: JobPayloadDecoder = Effect.fnUntraced(function* <
  S extends Schema.Top
>(schema: S, encoded: EncodedJobPayload) {
  const snapshot = yield* readArtifact(encoded)
  const ast = yield* prepareProjection(schema)
  const value = yield* parse(snapshot.payloadBytes)
  const payloadBytes = yield* canonicalBytes(
    value,
    maximumJobPayloadBytes,
    "payload-too-large"
  )
  const suppliedProjection = yield* parse(snapshot.semanticProjectionBytes)
  const suppliedBytes = yield* canonicalBytes(
    suppliedProjection,
    maximumJobSemanticProjectionBytes,
    "projection-too-large",
    -1
  )
  if (
    !bytesEqual(payloadBytes, snapshot.payloadBytes) ||
    !bytesEqual(suppliedBytes, snapshot.semanticProjectionBytes)
  ) {
    return yield* new JobPayloadCodecError({ reason: "invalid-encoding" })
  }
  yield* Schema.decodeUnknownEffect(
    Schema.make<Schema.Codec<unknown>>(ast),
    strict
  )(value).pipe(
    Effect.mapError(() => new JobPayloadCodecError({ reason: "invalid-schema" }))
  )
  const projection = yield* project(ast, value)
  const projectionBytes = yield* canonicalBytes(
    projection,
    maximumJobSemanticProjectionBytes,
    "projection-too-large",
    -1
  )
  if (!bytesEqual(projectionBytes, snapshot.semanticProjectionBytes)) {
    return yield* new JobPayloadCodecError({ reason: "projection-mismatch" })
  }
  const decoded = yield* Schema.decodeUnknownEffect(
    schema,
    strict
  )(value).pipe(
    Effect.mapError(() => new JobPayloadCodecError({ reason: "invalid-schema" }))
  )
  yield* checkDecodedContainers(decoded)
  return decoded
})
