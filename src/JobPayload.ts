/**
 * Marks already-protected payload subtrees for semantic comparison; performs no encryption.
 */
import { Cause, Data, Effect, Schema, SchemaAST, SchemaGetter, SchemaIssue } from "effect"
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

const inspectDomain = (
  ast: SchemaAST.AST,
  ancestors = new Set<SchemaAST.AST>()
): void => {
  if (hasEncryption(ast) || ast.annotations?.effectJobsProtectedPayload) {
    throw new InvalidEncryptedSchema({ reason: "nested-encryption" })
  }
  if (ancestors.has(ast) || SchemaAST.isSuspend(ast)) {
    throw new InvalidEncryptedSchema({ reason: "recursive-schema" })
  }
  ancestors.add(ast)
  if (SchemaAST.isObjects(ast)) {
    ast.propertySignatures.forEach((p) => inspectDomain(p.type, ancestors))
    ast.indexSignatures.forEach((p) => {
      inspectDomain(p.parameter, ancestors)
      inspectDomain(p.type, ancestors)
    })
  }
  if (SchemaAST.isArrays(ast)) {
    ast.elements.forEach((p) => inspectDomain(p, ancestors))
    ast.rest.forEach((p) => inspectDomain(p, ancestors))
  }
  if (SchemaAST.isUnion(ast)) {
    ast.types.forEach((p) => inspectDomain(p, ancestors))
  }
  if (SchemaAST.isDeclaration(ast)) {
    ast.typeParameters.forEach((p) => inspectDomain(p, ancestors))
  }
  ast.encoding?.forEach((link) => inspectDomain(link.to, ancestors))
  ancestors.delete(ast)
}

/** Bind a decoded domain Schema to an app-owned encrypted JSON envelope.
 * Domain encoding/validation precedes seal; open precedes domain decoding/validation.
 * Multiple independent fields, structs, arrays, optionals and unions are supported.
 * Encrypted-within-encrypted and recursive domain schemas fail at construction.
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
}): Schema.Codec<
  S["Type"],
  Envelope["Encoded"],
  S["DecodingServices"] | RD,
  S["EncodingServices"] | RE
> => {
  const { schema, codec } = options
  inspectDomain(schema.ast)
  inspectDomain(codec.envelope.ast)
  const inspectEnvelope = (ast: SchemaAST.AST): void => {
    if (ast.encoding !== undefined || SchemaAST.isDeclaration(ast)) {
      throw new InvalidEncryptedSchema({ reason: "invalid-envelope" })
    }
    if (SchemaAST.isObjects(ast)) {
      if (ast.indexSignatures.length > 0) {
        throw new InvalidEncryptedSchema({ reason: "invalid-envelope" })
      }
      ast.propertySignatures.forEach((p) => inspectEnvelope(p.type))
    }
    if (SchemaAST.isArrays(ast)) {
      if (ast.elements.length !== 0 || ast.rest.length !== 1) {
        throw new InvalidEncryptedSchema({ reason: "invalid-envelope" })
      }
      ast.rest.forEach(inspectEnvelope)
    }
    if (SchemaAST.isUnion(ast)) {
      ast.types.forEach(inspectEnvelope)
    }
  }
  inspectEnvelope(codec.envelope.ast)
  const envelopeAst = codec.envelope.ast
  if (
    !SchemaAST.isObjects(envelopeAst) ||
    envelopeAst.encoding !== undefined ||
    !envelopeAst.propertySignatures.some(
      (p) => p.name === "fingerprint" && p.type.context?.isOptional !== true
    )
  ) {
    throw new InvalidEncryptedSchema({ reason: "invalid-envelope" })
  }
  // No typed provider details are retained in Schema issues. Defects/interruption
  // remain in the complete Cause; pinned Effect.mapError drops mixed reasons.
  const issue = () => new SchemaIssue.Forbidden({ message: "payload encryption failed" })
  const result = protectedPayload(codec.envelope).pipe(
    Schema.decodeTo(schema, {
      decode: SchemaGetter.transformEffect((value) =>
        codec
          .open(value)
          .pipe(Effect.catchCause((cause) => Effect.failCause(Cause.map(cause, issue))))
      ),
      encode: SchemaGetter.transformEffect((value) =>
        codec
          .seal(value)
          .pipe(Effect.catchCause((cause) => Effect.failCause(Cause.map(cause, issue))))
      )
    })
  )
  const link = result.ast.encoding?.at(-1)
  if (link === undefined) {
    throw new InvalidEncryptedSchema({ reason: "invalid-envelope" })
  }
  registerEncryption(link)
  return result
}
