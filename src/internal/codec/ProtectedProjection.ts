import { Effect, Result, Schema, SchemaAST } from "effect"
import {
  JobPayloadCodecError,
  maximumJobPayloadSchemaPathBytes,
  maximumProtectedJobPayloadSubtrees
} from "../../JobContract.js"
import { hasEncryption } from "./EncryptedBoundary.js"

const marked = (ast: SchemaAST.AST) =>
  ast.annotations?.effectJobsProtectedPayload === true
const encoder = new TextEncoder()

// Capture only native AST/Schema and object-reflection calls. Validation below
// returns Results; it never throws a domain error through this adapter.
const inspectSchema = <A>(read: () => A): Result.Result<A, JobPayloadCodecError> =>
  Result.try({
    try: read,
    catch: () => new JobPayloadCodecError({ reason: "invalid-schema" })
  })

/** No traversal may silently lose a marker across a transformation/custom shape.
 * Scalar/domain transforms without protected mappings use their encoded AST. */
export const prepareProjection = (schema: Schema.Top) =>
  Effect.suspend(() => {
    const visit = (
      ast: SchemaAST.AST,
      transformed: boolean,
      protectedParent: boolean,
      ancestors: Set<SchemaAST.AST>
    ): Result.Result<void, JobPayloadCodecError> =>
      Result.gen(function* () {
        if (
          ancestors.has(ast) ||
          (yield* inspectSchema(() => SchemaAST.isSuspend(ast)))
        ) {
          return yield* Result.fail(
            new JobPayloadCodecError({ reason: "invalid-schema" })
          )
        }
        if (yield* inspectSchema(() => hasEncryption(ast))) {
          if (transformed || protectedParent) {
            return yield* Result.fail(
              new JobPayloadCodecError({ reason: "invalid-schema" })
            )
          }
          // The helper validates its domain and owns precisely this transform.
          const encoded = yield* inspectSchema(() => SchemaAST.toEncoded(ast))
          return yield* visit(encoded, false, false, ancestors)
        }
        const boundary =
          transformed || (yield* inspectSchema(() => ast.encoding !== undefined))
        const protectedHere = yield* inspectSchema(() => marked(ast))
        if (protectedHere && (boundary || protectedParent)) {
          return yield* Result.fail(
            new JobPayloadCodecError({ reason: "invalid-schema" })
          )
        }
        ancestors.add(ast)
        const child = (node: SchemaAST.AST) =>
          visit(node, boundary, protectedParent || protectedHere, ancestors)
        const children = yield* inspectSchema(() => {
          if (SchemaAST.isObjects(ast)) {
            return ast.propertySignatures.map((property) => property.type)
          }
          if (SchemaAST.isArrays(ast)) {
            return ast.rest
          }
          if (SchemaAST.isUnion(ast)) {
            return ast.types
          }
          if (SchemaAST.isDeclaration(ast)) {
            return ast.typeParameters
          }
          return []
        })
        const supported = yield* inspectSchema(() => {
          if (SchemaAST.isObjects(ast)) {
            return (
              ast.indexSignatures.length === 0 &&
              !ast.propertySignatures.some(
                (property) => typeof property.name !== "string"
              )
            )
          }
          if (SchemaAST.isArrays(ast)) {
            return ast.elements.length === 0 && ast.rest.length === 1
          }
          if (SchemaAST.isDeclaration(ast)) {
            return ast.encoding !== undefined
          }
          return true
        })
        if (!supported) {
          return yield* Result.fail(
            new JobPayloadCodecError({ reason: "invalid-schema" })
          )
        }
        for (const node of children) {
          yield* child(node)
        }
        const encodedChildren = yield* inspectSchema(
          () => ast.encoding?.map((link) => link.to) ?? []
        )
        for (const node of encodedChildren) {
          yield* child(node)
        }
        ancestors.delete(ast)
      })
    const result = Result.gen(function* () {
      const ast = yield* inspectSchema(() => schema.ast)
      yield* visit(ast, false, false, new Set())
      const encoded = yield* inspectSchema(() => SchemaAST.toEncoded(ast))
      yield* visit(encoded, false, false, new Set())
      return encoded
    })
    return Effect.fromResult(result)
  })

export const project = (ast: SchemaAST.AST, value: unknown) =>
  Effect.suspend(() => {
    const inspect = <A>(read: () => A): Result.Result<A, JobPayloadCodecError> =>
      Result.try({
        try: read,
        catch: (error) =>
          error instanceof JobPayloadCodecError
            ? error
            : new JobPayloadCodecError({ reason: "invalid-schema" })
      })
    let count = 0
    const protectedFields: Array<readonly [string, unknown]> = []
    const visit = (
      node: SchemaAST.AST,
      item: unknown,
      path: string
    ): Result.Result<unknown, JobPayloadCodecError> =>
      Result.gen(function* () {
        const pathLength = yield* inspect(() => encoder.encode(path).byteLength)
        if (pathLength > maximumJobPayloadSchemaPathBytes) {
          return yield* Result.fail(
            new JobPayloadCodecError({ reason: "schema-path-too-long" })
          )
        }
        if (yield* inspect(() => marked(node))) {
          if (++count > maximumProtectedJobPayloadSubtrees) {
            return yield* Result.fail(
              new JobPayloadCodecError({ reason: "too-many-protected-subtrees" })
            )
          }
          if (
            item === null ||
            typeof item !== "object" ||
            (yield* inspect(() => Array.isArray(item))) ||
            !(yield* inspect(() => Object.hasOwn(item, "fingerprint")))
          ) {
            return yield* Result.fail(
              new JobPayloadCodecError({ reason: "invalid-protected-value" })
            )
          }
          const fingerprint = yield* inspect(() =>
            Object.getOwnPropertyDescriptor(item, "fingerprint")
          )
          const plain = yield* inspect(
            () =>
              Object.getPrototypeOf(item) === Object.prototype ||
              Object.getPrototypeOf(item) === null
          )
          if (!plain) {
            return yield* Result.fail(
              new JobPayloadCodecError({ reason: "invalid-json-value" })
            )
          }
          // A stateful foreign proxy can invalidate its earlier own-field claim.
          // The former native property-access exception mapped to invalid-schema.
          if (fingerprint === undefined) {
            return yield* Result.fail(
              new JobPayloadCodecError({ reason: "invalid-schema" })
            )
          }
          if (!fingerprint.enumerable || !("value" in fingerprint)) {
            return yield* Result.fail(
              new JobPayloadCodecError({ reason: "invalid-json-value" })
            )
          }
          protectedFields.push([path, fingerprint.value])
          return null
        }
        if (yield* inspect(() => SchemaAST.isUnion(node))) {
          const branch = yield* inspect(() =>
            SchemaAST.isUnion(node)
              ? node.types.find(
                  (member) =>
                    Schema.decodeUnknownExit(Schema.make<Schema.Codec<unknown>>(member), {
                      onExcessProperty: "error"
                    })(item)._tag === "Success"
                )
              : undefined
          )
          if (branch === undefined) {
            return yield* Result.fail(
              new JobPayloadCodecError({ reason: "invalid-schema" })
            )
          }
          return yield* visit(branch, item, path)
        }
        const arrays = yield* inspect(() => (SchemaAST.isArrays(node) ? node : undefined))
        const array =
          arrays === undefined
            ? undefined
            : yield* inspect(() => (Array.isArray(item) ? item : undefined))
        if (arrays !== undefined && array !== undefined) {
          const size = yield* inspect(() => array.length)
          const projected: Array<unknown> = []
          yield* inspect(() => (projected.length = size))
          for (let index = 0; index < size; index++) {
            // Keep native map's sparse-array semantics and stop at the first
            // validation failure before inspecting a later application value.
            if (!(yield* inspect(() => index in array))) {
              continue
            }
            const entry: unknown = yield* inspect(() => array[index])
            const member = yield* inspect(() => arrays.rest[0]!)
            projected[index] = yield* visit(member, entry, `${path}/${index}`)
          }
          return projected
        }
        const objects = yield* inspect(() =>
          SchemaAST.isObjects(node) ? node : undefined
        )
        if (objects !== undefined && item !== null && typeof item === "object") {
          const plain = yield* inspect(
            () =>
              Object.getPrototypeOf(item) === Object.prototype ||
              Object.getPrototypeOf(item) === null
          )
          if (!plain) {
            return yield* Result.fail(
              new JobPayloadCodecError({ reason: "invalid-json-value" })
            )
          }
          const entries = yield* inspect(() => Object.entries(item))
          const projected: Array<readonly [string, unknown]> = []
          for (const entry of entries) {
            const key = entry[0]
            const property = yield* inspect(() =>
              objects.propertySignatures.find((field) => field.name === key)
            )
            const value =
              property === undefined
                ? entry[1]
                : yield* visit(
                    property.type,
                    entry[1],
                    `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`
                  )
            projected.push([key, value])
          }
          return Object.fromEntries(projected)
        }
        return item
      })
    // Allocate counters and scratch for each execution, before entering Effects.
    return Effect.fromResult(
      Result.map(visit(ast, value, ""), (data) => ({
        data,
        protected: Object.fromEntries(protectedFields)
      }))
    )
  })
