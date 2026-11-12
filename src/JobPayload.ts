/**
 * Marks already-protected payload subtrees for semantic comparison; performs no encryption.
 */
import {
  Cause,
  Data,
  Effect,
  Result,
  Schema,
  SchemaAST,
  SchemaGetter,
  SchemaIssue
} from "effect"
import { hasEncryption, registerEncryption } from "./internal/codec/EncryptedBoundary.js"

/**
 * Marks an application-owned, already-protected JSON representation. Requires an
 * own fingerprint in the encoded value. This neither proves protection nor seals
 * or opens data. Encryption and stable fingerprint keys remain application-owned.
 * The schema may describe any JSON fingerprint; no envelope shape or crypto key
 * manager is imposed. Unsupported protected mappings fail when the codec runs.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import * as Payload from "effect-jobs/JobPayload"
 *
 * // Supply actual app-sealed envelopes and keyed fingerprints when producing jobs.
 * const protectedValue = Payload.protected(Schema.Struct({
 *   envelope: Schema.String,
 *   fingerprint: Schema.String
 * }))
 * ```
 *
 * @category schemas
 */
const protectedPayload = <S extends Schema.Top>(schema: S): S["Rebuild"] =>
  schema.annotate({ effectJobsProtectedPayload: true })

export { protectedPayload as protected }

declare module "effect/Schema" {
  namespace Annotations {
    interface Annotations {
      readonly effectJobsProtectedPayload?: true | undefined
    }
  }
}

/** Bounded codec failure. Provider details, plaintext and keys must stay private.
 * @category errors
 */
export class JobEncryptionError extends Data.TaggedError("JobEncryptionError")<{}> {}

/** Application codec over the domain's encoded representation. The envelope must
 * be an identity JSON schema with an own fingerprint field. Seal/open resolve
 * application services lazily; keys are validated by application Layers at startup.
 * Fingerprints must use stable keyed semantics independent of encryption randomness.
 * No cryptographic implementation or authenticated context binding is supplied.
 * @category models
 */
export interface EncryptionCodec<
  Encoded,
  Envelope extends Schema.Codec<unknown>,
  RE = never,
  RD = never
> {
  readonly envelope: Envelope
  readonly seal: (
    value: Encoded
  ) => Effect.Effect<Envelope["Type"], JobEncryptionError, RE>
  readonly open: (
    value: Envelope["Type"]
  ) => Effect.Effect<Encoded, JobEncryptionError, RD>
}

/** Actionable unsupported schema configuration, without domain values.
 * @category errors
 */
export class InvalidEncryptedSchema extends Data.TaggedError("InvalidEncryptedSchema")<{
  readonly reason: "nested-encryption" | "recursive-schema" | "invalid-envelope"
}> {}

// These contiguous AST walks have no services or asynchronous work. Their Result
// failures are lifted once by the lazy setup boundary below.
const inspectDomain = (
  ast: SchemaAST.AST,
  ancestors = new Set<SchemaAST.AST>()
): Result.Result<void, InvalidEncryptedSchema> =>
  Result.gen(function* () {
    if (hasEncryption(ast) || ast.annotations?.effectJobsProtectedPayload) {
      return yield* Result.fail(
        new InvalidEncryptedSchema({ reason: "nested-encryption" })
      )
    }
    if (ancestors.has(ast) || SchemaAST.isSuspend(ast)) {
      return yield* Result.fail(
        new InvalidEncryptedSchema({ reason: "recursive-schema" })
      )
    }
    ancestors.add(ast)
    if (SchemaAST.isObjects(ast)) {
      for (const property of ast.propertySignatures) {
        yield* inspectDomain(property.type, ancestors)
      }
      for (const index of ast.indexSignatures) {
        yield* inspectDomain(index.parameter, ancestors)
        yield* inspectDomain(index.type, ancestors)
      }
    }
    if (SchemaAST.isArrays(ast)) {
      for (const element of ast.elements) {
        yield* inspectDomain(element, ancestors)
      }
      for (const rest of ast.rest) {
        yield* inspectDomain(rest, ancestors)
      }
    }
    if (SchemaAST.isUnion(ast)) {
      for (const type of ast.types) {
        yield* inspectDomain(type, ancestors)
      }
    }
    if (SchemaAST.isDeclaration(ast)) {
      for (const parameter of ast.typeParameters) {
        yield* inspectDomain(parameter, ancestors)
      }
    }
    for (const link of ast.encoding ?? []) {
      yield* inspectDomain(link.to, ancestors)
    }
    ancestors.delete(ast)
  })

const inspectEnvelope = (
  ast: SchemaAST.AST
): Result.Result<void, InvalidEncryptedSchema> =>
  Result.gen(function* () {
    if (ast.encoding !== undefined || SchemaAST.isDeclaration(ast)) {
      return yield* Result.fail(
        new InvalidEncryptedSchema({ reason: "invalid-envelope" })
      )
    }
    if (SchemaAST.isObjects(ast)) {
      if (ast.indexSignatures.length > 0) {
        return yield* Result.fail(
          new InvalidEncryptedSchema({ reason: "invalid-envelope" })
        )
      }
      for (const property of ast.propertySignatures) {
        yield* inspectEnvelope(property.type)
      }
    }
    if (SchemaAST.isArrays(ast)) {
      if (ast.elements.length !== 0 || ast.rest.length !== 1) {
        return yield* Result.fail(
          new InvalidEncryptedSchema({ reason: "invalid-envelope" })
        )
      }
      for (const rest of ast.rest) {
        yield* inspectEnvelope(rest)
      }
    }
    if (SchemaAST.isUnion(ast)) {
      for (const type of ast.types) {
        yield* inspectEnvelope(type)
      }
    }
  })

/** Bind a decoded domain Schema to an app-owned encrypted JSON envelope.
 * Domain encoding/validation precedes seal; open precedes domain decoding/validation.
 * Multiple independent fields, structs, arrays, optionals and unions are supported.
 * Setup is lazy and fails with InvalidEncryptedSchema in the Effect error channel.
 * Each execution snapshots schema, envelope and codec methods into a fresh Schema.
 * Encrypted-within-encrypted and recursive domain schemas fail during setup.
 * All encrypted fields are opened before the handler; this is not selective access.
 * Malformed envelopes/domain data follow the existing bounded artifact decode path.
 * Defects and interruption are not converted to codec failures. No remote key retry
 * contract is added; configured keys must be validated before worker startup.
 * @category schemas
 */
export const encrypted = <
  S extends Schema.Top,
  Envelope extends Schema.Codec<unknown>,
  RE,
  RD
>(options: {
  readonly schema: S
  readonly codec: EncryptionCodec<S["Encoded"], Envelope, RE, RD>
}): Effect.Effect<
  Schema.Codec<
    S["Type"],
    Envelope["Encoded"],
    S["DecodingServices"] | RD,
    S["EncodingServices"] | RE
  >,
  InvalidEncryptedSchema
> =>
  Effect.suspend(() => {
    const { schema, codec } = options
    const { envelope, seal, open } = codec
    return Effect.fromResult(
      Result.gen(function* () {
        yield* inspectDomain(schema.ast)
        yield* inspectDomain(envelope.ast)
        yield* inspectEnvelope(envelope.ast)
        const envelopeAst = envelope.ast
        if (
          !SchemaAST.isObjects(envelopeAst) ||
          envelopeAst.encoding !== undefined ||
          !envelopeAst.propertySignatures.some(
            (p) => p.name === "fingerprint" && p.type.context?.isOptional !== true
          )
        ) {
          return yield* Result.fail(
            new InvalidEncryptedSchema({ reason: "invalid-envelope" })
          )
        }
        // No typed provider details are retained in Schema issues. Defects/interruption
        // remain in the complete Cause; pinned Effect.mapError drops mixed reasons.
        const issue = () =>
          new SchemaIssue.Forbidden({ message: "payload encryption failed" })
        const result = protectedPayload(envelope).pipe(
          Schema.decodeTo(schema, {
            decode: SchemaGetter.transformEffect((value) =>
              open
                .call(codec, value)
                .pipe(
                  Effect.catchCause((cause) => Effect.failCause(Cause.map(cause, issue)))
                )
            ),
            encode: SchemaGetter.transformEffect((value) =>
              seal
                .call(codec, value)
                .pipe(
                  Effect.catchCause((cause) => Effect.failCause(Cause.map(cause, issue)))
                )
            )
          })
        )
        const link = result.ast.encoding?.at(-1)
        if (link === undefined) {
          return yield* Result.fail(
            new InvalidEncryptedSchema({ reason: "invalid-envelope" })
          )
        }
        registerEncryption(link)
        return result
      })
    )
  })
