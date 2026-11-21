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

const pointerChild = (path: string, key: string) =>
  `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`

// Internal array segment. A literal '~' in a field name is always escaped to '~0'.
const arrayChild = (path: string) => `${path}/~2`
const declarationPath = (path: string) => path.replaceAll("/~2", "/0")

export interface PayloadSchemaIssue {
  readonly path: string
  readonly reason:
    | "invalid-ast"
    | "recursive-schema"
    | "unsupported-tuple"
    | "unsupported-index-signature"
    | "unsupported-property-key"
    | "unsupported-declaration"
    | "unsupported-protection-boundary"
    | "inconsistent-encryption-coverage"
    | "schema-path-too-long"
}

const schemaIssue = (
  path: string,
  reason: PayloadSchemaIssue["reason"]
): PayloadSchemaIssue => {
  const display = declarationPath(path)
  let safePath = ""
  let bytes = 0
  for (const char of display) {
    // Escape control/format characters and isolated surrogates for use in logs.
    const safe = /^[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\\]$/u.test(char)
      ? `\\u{${char.codePointAt(0)!.toString(16)}}`
      : char
    bytes += encoder.encode(safe).byteLength
    if (bytes > maximumJobPayloadSchemaPathBytes - 3) {
      return { path: `${safePath}…`, reason }
    }
    safePath += safe
  }
  return { path: safePath, reason }
}

// Native AST reflection can throw on a foreign Schema. Keep the diagnostic
// declaration-only, including in that failure path.
const inspectSchema = <A>(
  path: string,
  read: () => A
): Result.Result<A, PayloadSchemaIssue> =>
  Result.try({ try: read, catch: () => schemaIssue(path, "invalid-ast") })

/** Validate shapes and compare encryption coverage before any Schema effects run. */
const inspectDeclaration = (
  ast: SchemaAST.AST,
  path: string,
  transformed: boolean,
  protectedParent: boolean,
  ancestors: Set<SchemaAST.AST>,
  encryptedPaths: Set<string>
): Result.Result<void, PayloadSchemaIssue> =>
  Result.gen(function* () {
    if (
      ancestors.has(ast) ||
      (yield* inspectSchema(path, () => SchemaAST.isSuspend(ast)))
    ) {
      return yield* Result.fail(schemaIssue(path, "recursive-schema"))
    }
    if (yield* inspectSchema(path, () => hasEncryption(ast))) {
      if (transformed || protectedParent) {
        return yield* Result.fail(schemaIssue(path, "unsupported-protection-boundary"))
      }
      // The helper validates its domain and owns this transformation.
      encryptedPaths.add(path)
      const encoded = yield* inspectSchema(path, () => SchemaAST.toEncoded(ast))
      return yield* inspectDeclaration(
        encoded,
        path,
        false,
        false,
        ancestors,
        encryptedPaths
      )
    }
    const boundary =
      transformed || (yield* inspectSchema(path, () => ast.encoding !== undefined))
    const protectedHere = yield* inspectSchema(path, () => marked(ast))
    if (protectedHere && (boundary || protectedParent)) {
      return yield* Result.fail(schemaIssue(path, "unsupported-protection-boundary"))
    }
    ancestors.add(ast)
    const child = (node: SchemaAST.AST, at: string, coverage = encryptedPaths) =>
      inspectDeclaration(
        node,
        at,
        boundary,
        protectedParent || protectedHere,
        ancestors,
        coverage
      )

    const node = yield* inspectSchema(path, () => {
      if (SchemaAST.isObjects(ast)) {
        return {
          kind: "object" as const,
          fields: ast.propertySignatures.map(({ name, type }) => ({ name, type })),
          indexed: ast.indexSignatures.length > 0
        }
      }
      if (SchemaAST.isArrays(ast)) {
        return {
          kind: "array" as const,
          item:
            ast.elements.length === 0 && ast.rest.length === 1 ? ast.rest[0] : undefined
        }
      }
      if (SchemaAST.isUnion(ast)) {
        return { kind: "union" as const, members: ast.types }
      }
      if (SchemaAST.isDeclaration(ast)) {
        return {
          kind: "declaration" as const,
          parameters: ast.typeParameters,
          encoded: ast.encoding !== undefined
        }
      }
      return { kind: "leaf" as const }
    })
    switch (node.kind) {
      case "object":
        if (node.indexed) {
          return yield* Result.fail(schemaIssue(path, "unsupported-index-signature"))
        }
        for (const field of node.fields) {
          if (typeof field.name !== "string") {
            return yield* Result.fail(schemaIssue(path, "unsupported-property-key"))
          }
          yield* child(field.type, pointerChild(path, field.name))
        }
        break
      case "array":
        if (node.item === undefined) {
          return yield* Result.fail(schemaIssue(path, "unsupported-tuple"))
        }
        yield* child(node.item, arrayChild(path))
        break
      case "union": {
        let first: Set<string> | undefined
        for (const member of node.members) {
          const coverage = new Set<string>()
          yield* child(member, path, coverage)
          if (first === undefined) {
            first = coverage
          } else if (
            first.size !== coverage.size ||
            [...first].some((key) => !coverage.has(key))
          ) {
            return yield* Result.fail(
              schemaIssue(path, "inconsistent-encryption-coverage")
            )
          }
        }
        for (const key of first ?? []) {
          encryptedPaths.add(key)
        }
        break
      }
      case "declaration":
        if (!node.encoded) {
          return yield* Result.fail(schemaIssue(path, "unsupported-declaration"))
        }
        for (const parameter of node.parameters) {
          yield* child(parameter, path)
        }
        break
    }
    const encodedChildren = yield* inspectSchema(
      path,
      () => ast.encoding?.map((link) => link.to) ?? []
    )
    for (const node of encodedChildren) {
      yield* child(node, path)
    }
    ancestors.delete(ast)
  })

// Follow the same paths as runtime projection. A one-digit array index is the
// shortest possible segment. Runtime still checks each actual index it visits.
const checkStaticPaths = (
  ast: SchemaAST.AST,
  path: string
): Result.Result<void, PayloadSchemaIssue> =>
  Result.gen(function* () {
    if (
      encoder.encode(declarationPath(path)).byteLength > maximumJobPayloadSchemaPathBytes
    ) {
      return yield* Result.fail(schemaIssue(path, "schema-path-too-long"))
    }
    const children = yield* inspectSchema(
      path,
      (): ReadonlyArray<readonly [SchemaAST.AST, string]> => {
        if (marked(ast)) {
          return []
        }
        if (SchemaAST.isObjects(ast)) {
          return ast.propertySignatures.flatMap(({ name, type }) =>
            typeof name === "string" ? [[type, pointerChild(path, name)] as const] : []
          )
        }
        if (SchemaAST.isArrays(ast) && ast.rest[0] !== undefined) {
          return [[ast.rest[0], arrayChild(path)]]
        }
        if (SchemaAST.isUnion(ast)) {
          return ast.types.map((member) => [member, path])
        }
        return []
      }
    )
    for (const [node, at] of children) {
      yield* checkStaticPaths(node, at)
    }
  })

export const prepareProjection = (schema: Schema.Top) =>
  Effect.suspend(() =>
    Effect.fromResult(
      Result.gen(function* () {
        const ast = yield* inspectSchema("", () => schema.ast)
        yield* inspectDeclaration(ast, "", false, false, new Set(), new Set())
        const encoded = yield* inspectSchema("", () => SchemaAST.toEncoded(ast))
        yield* inspectDeclaration(encoded, "", false, false, new Set(), new Set())
        const decoded = yield* inspectSchema("", () => SchemaAST.toType(ast))
        yield* checkStaticPaths(decoded, "")
        if (encoded !== decoded) {
          yield* checkStaticPaths(encoded, "")
        }
        return encoded
      })
    )
  )

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
                : yield* visit(property.type, entry[1], pointerChild(path, key))
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
