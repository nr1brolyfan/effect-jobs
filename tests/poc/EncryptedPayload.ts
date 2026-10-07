/** First-stage experiment only; this is not a public library API. */
import { Data, Effect, Schema, SchemaAST, SchemaGetter, SchemaIssue } from "effect"
import * as Payload from "../../src/JobPayload.js"

export class ProtectionFailure extends Data.TaggedError("ProtectionFailure")<{
  readonly reason: "invalid-envelope" | "key-unavailable"
}> {}

/** Codec receives the domain schema's ENCODED representation, never its Type.
 * Envelope schema is identity/JSON in this initial experiment. */
export interface EncryptionCodec<
  Encoded,
  Envelope extends Schema.Codec<unknown>,
  RE,
  RD
> {
  readonly envelope: Envelope
  readonly seal: (
    value: Encoded
  ) => Effect.Effect<Envelope["Type"], ProtectionFailure, RE>
  readonly open: (
    value: Envelope["Type"]
  ) => Effect.Effect<Encoded, ProtectionFailure, RD>
}

const encryptedNodes = new WeakSet<SchemaAST.AST>()
const unavailableIssues = new WeakSet<SchemaIssue.Issue>()

const issueFor = (failure: ProtectionFailure): SchemaIssue.Issue => {
  // No provider error, domain input, ciphertext or key is retained in this leaf.
  const issue = new SchemaIssue.Forbidden({ message: "payload protection failed" })
  if (failure.reason === "key-unavailable") {
    unavailableIssues.add(issue)
  }
  return issue
}

/** Verify that native Schema wraps but retains the private safe leaf identity.
 * Production would traverse Issue variants explicitly, including mixed errors. */
export const containsUnavailable = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) {
    return false
  }
  if (SchemaIssue.isIssue(value) && unavailableIssues.has(value)) {
    return true
  }
  return Object.values(value).some((child) =>
    Array.isArray(child) ? child.some(containsUnavailable) : containsUnavailable(child)
  )
}

const rejectNested = (ast: SchemaAST.AST, ancestors = new Set<SchemaAST.AST>()): void => {
  if (encryptedNodes.has(ast)) {
    throw new Error("encrypted-within-encrypted is unsupported in v1")
  }
  if (ancestors.has(ast) || SchemaAST.isSuspend(ast)) {
    throw new Error("recursive encrypted domain schemas are unsupported in this PoC")
  }
  ancestors.add(ast)
  const visit = (child: SchemaAST.AST) => rejectNested(child, ancestors)
  if (SchemaAST.isObjects(ast)) {
    ast.propertySignatures.forEach((field) => visit(field.type))
  }
  if (SchemaAST.isArrays(ast)) {
    ast.elements.forEach(visit)
    ast.rest.forEach(visit)
  }
  if (SchemaAST.isUnion(ast)) {
    ast.types.forEach(visit)
  }
  if (SchemaAST.isDeclaration(ast)) {
    ast.typeParameters.forEach(visit)
  }
  ast.encoding?.forEach((link) => visit(link.to))
  ancestors.delete(ast)
}

export const native = <
  S extends Schema.Top,
  Envelope extends Schema.Codec<unknown>,
  RE,
  RD
>(
  options: {
    readonly schema: S
    readonly codec: EncryptionCodec<S["Encoded"], Envelope, RE, RD>
  },
  protectEnvelope: boolean
): Schema.Codec<
  S["Type"],
  Envelope["Encoded"],
  S["DecodingServices"] | RD,
  S["EncodingServices"] | RE
> => {
  rejectNested(options.schema.ast)
  const { schema, codec } = options
  const result = (
    protectEnvelope ? Payload.protected(codec.envelope) : codec.envelope
  ).pipe(
    Schema.decodeTo(schema, {
      decode: SchemaGetter.transformEffect((value) =>
        codec.open(value).pipe(Effect.mapError(issueFor))
      ),
      encode: SchemaGetter.transformEffect((value) =>
        codec.seal(value).pipe(Effect.mapError(issueFor))
      )
    })
  )
  encryptedNodes.add(result.ast)
  return result
}

export const encrypted = <
  S extends Schema.Top,
  Envelope extends Schema.Codec<unknown>,
  RE,
  RD
>(options: {
  readonly schema: S
  readonly codec: EncryptionCodec<S["Encoded"], Envelope, RE, RD>
}) => native(options, true)
