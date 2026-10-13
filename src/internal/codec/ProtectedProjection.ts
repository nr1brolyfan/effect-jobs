import { Effect, Schema, SchemaAST } from "effect"
import {
  JobPayloadCodecError,
  maximumJobPayloadSchemaPathBytes,
  maximumProtectedJobPayloadSubtrees
} from "../../JobContract.js"

const marked = (ast: SchemaAST.AST) =>
  ast.annotations?.effectJobsProtectedPayload === true
const encoder = new TextEncoder()

/** No traversal may silently lose a marker across a transformation/custom shape.
 * Scalar/domain transforms without protected mappings use their encoded AST. */
export const prepareProjection = (schema: Schema.Top) =>
  Effect.try({
    try: () => {
      const visit = (
        ast: SchemaAST.AST,
        transformed: boolean,
        protectedParent: boolean,
        ancestors: Set<SchemaAST.AST>
      ): void => {
        if (ancestors.has(ast) || SchemaAST.isSuspend(ast)) {
          throw new JobPayloadCodecError({ reason: "invalid-schema" })
        }
        const boundary = transformed || ast.encoding !== undefined
        const protectedHere = marked(ast)
        if (protectedHere && (boundary || protectedParent)) {
          throw new JobPayloadCodecError({ reason: "invalid-schema" })
        }
        ancestors.add(ast)
        const child = (node: SchemaAST.AST) =>
          visit(node, boundary, protectedParent || protectedHere, ancestors)
        if (SchemaAST.isObjects(ast)) {
          if (
            ast.indexSignatures.length > 0 ||
            ast.propertySignatures.some((property) => typeof property.name !== "string")
          ) {
            throw new JobPayloadCodecError({ reason: "invalid-schema" })
          }
          ast.propertySignatures.forEach((property) => child(property.type))
        } else if (SchemaAST.isArrays(ast)) {
          if (ast.elements.length !== 0 || ast.rest.length !== 1) {
            throw new JobPayloadCodecError({ reason: "invalid-schema" })
          }
          ast.rest.forEach(child)
        } else if (SchemaAST.isUnion(ast)) {
          ast.types.forEach(child)
        } else if (SchemaAST.isDeclaration(ast)) {
          if (ast.encoding === undefined) {
            throw new JobPayloadCodecError({ reason: "invalid-schema" })
          }
          ast.typeParameters.forEach(child)
        }
        ast.encoding?.forEach((link) => child(link.to))
        ancestors.delete(ast)
      }
      visit(schema.ast, false, false, new Set())
      const encoded = SchemaAST.toEncoded(schema.ast)
      visit(encoded, false, false, new Set())
      return encoded
    },
    catch: () => new JobPayloadCodecError({ reason: "invalid-schema" })
  })

export const project = (ast: SchemaAST.AST, value: unknown) =>
  Effect.try({
    try: () => {
      let count = 0
      const protectedFields: Array<readonly [string, unknown]> = []
      const visit = (node: SchemaAST.AST, item: unknown, path: string): unknown => {
        if (encoder.encode(path).byteLength > maximumJobPayloadSchemaPathBytes) {
          throw new JobPayloadCodecError({ reason: "schema-path-too-long" })
        }
        if (marked(node)) {
          if (++count > maximumProtectedJobPayloadSubtrees) {
            throw new JobPayloadCodecError({ reason: "too-many-protected-subtrees" })
          }
          if (
            item === null ||
            typeof item !== "object" ||
            Array.isArray(item) ||
            !Object.hasOwn(item, "fingerprint")
          ) {
            throw new JobPayloadCodecError({ reason: "invalid-protected-value" })
          }
          const fingerprint = Object.getOwnPropertyDescriptor(item, "fingerprint")!
          if (
            (Object.getPrototypeOf(item) !== Object.prototype &&
              Object.getPrototypeOf(item) !== null) ||
            !fingerprint.enumerable ||
            !("value" in fingerprint)
          ) {
            throw new JobPayloadCodecError({ reason: "invalid-json-value" })
          }
          protectedFields.push([path, fingerprint.value])
          return null
        }
        if (SchemaAST.isUnion(node)) {
          const branch = node.types.find(
            (member) =>
              Schema.decodeUnknownExit(Schema.make<Schema.Codec<unknown>>(member), {
                onExcessProperty: "error"
              })(item)._tag === "Success"
          )
          if (branch === undefined) {
            throw new JobPayloadCodecError({ reason: "invalid-schema" })
          }
          return visit(branch, item, path)
        }
        if (SchemaAST.isArrays(node) && Array.isArray(item)) {
          return item.map((entry, index) =>
            visit(node.rest[0]!, entry, `${path}/${index}`)
          )
        }
        if (SchemaAST.isObjects(node) && item !== null && typeof item === "object") {
          if (
            Object.getPrototypeOf(item) !== Object.prototype &&
            Object.getPrototypeOf(item) !== null
          ) {
            throw new JobPayloadCodecError({ reason: "invalid-json-value" })
          }
          // Keep every validated property, including the empty Struct case. Never
          // create an accidental equivalence by dropping unknown JSON properties.
          return Object.fromEntries(
            Object.entries(item).map(([key, entry]) => {
              const property = node.propertySignatures.find((field) => field.name === key)
              return [
                key,
                property === undefined
                  ? entry
                  : visit(
                      property.type,
                      entry,
                      `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`
                    )
              ]
            })
          )
        }
        return item
      }
      // Application JSON is always inside data, never interpreted as metadata.
      // null placeholders preserve positions; the separate path map distinguishes
      // protected nodes from public nulls, including inside Schema.Unknown.
      const data = visit(ast, value, "")
      return { data, protected: Object.fromEntries(protectedFields) }
    },
    catch: (error) =>
      error instanceof JobPayloadCodecError
        ? error
        : new JobPayloadCodecError({ reason: "invalid-schema" })
  })
