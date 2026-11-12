/**
 * Validates catalog and producer identities without normalizing operation IDs.
 */
import { Data, Effect, Result, Schema } from "effect"

import { declaration, name } from "./internal/ProducerDeclaration.js"
export { JobDeclarationError, nameFormat } from "./internal/ProducerDeclaration.js"

/**
 * Queue-name Schema: 1–64 ASCII characters matching nameFormat.
 *
 * @category schemas
 */
export const QueueName = name(64)
/**
 * Job-name Schema: 1–128 ASCII characters matching nameFormat.
 *
 * @category schemas
 */
export type JobName = typeof JobName.Type
/** Stable job-name Schema: 1–128 ASCII characters matching nameFormat.
 * @category schemas
 */
export const JobName = name(128)
/**
 * Producer operation-name Schema: 1–128 ASCII characters matching nameFormat.
 *
 * @category schemas
 */
export const OperationName = name(128)
/**
 * Consequence-slot Schema: 1–128 ASCII characters matching nameFormat.
 *
 * @category schemas
 */
export const SlotName = name(128)
/**
 * Explicit catalog version Schema: an integer in 1–32,767.
 *
 * @category schemas
 */
export const JobVersion = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 32_767 }))
)

/**
 * Queue/name/version Schema and literal-preserving structural identity.
 *
 * @category schemas
 */
export const CatalogIdentity = Schema.Struct({
  queue: QueueName,
  name: JobName,
  version: JobVersion
})
/**
 * Queue/name/version Schema and literal-preserving structural identity.
 *
 * @category models
 */
export interface CatalogIdentity<
  Queue extends string = string,
  Name extends string = string,
  Version extends number = number
> {
  readonly queue: Queue
  readonly name: Name
  readonly version: Version
}

const utf8 = new TextEncoder()
const validScalars = (value: string): boolean => {
  for (const scalar of value) {
    const code = scalar.codePointAt(0)!
    if (code >= 0xd800 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

/**
 * Typed identifier failure; reports the violated rule without echoing the ID.
 *
 * @category errors
 */
export class InvalidOperationId extends Data.TaggedError("InvalidOperationId")<{
  readonly rule: "unicode-scalars" | "no-nul" | "utf8-length"
  readonly byteLength?: number
}> {}

const operationIdError = (value: string): InvalidOperationId | undefined => {
  if (typeof value !== "string" || !validScalars(value)) {
    return new InvalidOperationId({ rule: "unicode-scalars" })
  }
  if (value.includes("\u0000")) {
    return new InvalidOperationId({ rule: "no-nul" })
  }
  const byteLength = utf8.encode(value).byteLength
  if (byteLength < 1 || byteLength > 256) {
    return new InvalidOperationId({ rule: "utf8-length", byteLength })
  }
  return undefined
}

/**
 * Lazily validates Unicode scalars, absence of NUL and 1–256 UTF-8 bytes.
 * Fails with InvalidOperationId without echoing the ID; never normalizes it.
 *
 * @category operations
 */
export const validateOperationId = (
  value: string
): Effect.Effect<void, InvalidOperationId> =>
  Effect.suspend(() => {
    const error = operationIdError(value)
    return error === undefined ? Effect.void : Effect.fail(error)
  })

/**
 * Opaque operation-ID Schema: valid Unicode scalars, no NUL, 1–256 UTF-8 bytes.
 * Application-branded strings are accepted without an extra library brand.
 *
 * @category schemas
 */
export const OperationId = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value) => operationIdError(value) === undefined))
)
/**
 * Operation/operationId/slot Schema and literal-preserving deduplication identity.
 *
 * @category schemas
 */
export const ProducerIdentity = Schema.Struct({
  operation: OperationName,
  operationId: OperationId,
  slot: SlotName
})
/**
 * Operation/operationId/slot Schema and literal-preserving deduplication identity.
 *
 * @category models
 */
export interface ProducerIdentity<
  Operation extends string = string,
  Slot extends string = string
> {
  readonly operation: Operation
  readonly operationId: string
  readonly slot: Slot
}

/**
 * Validates operation and unique slots synchronously; throws
 * JobDeclarationError. Empty slots are valid during immutable assembly.
 *
 * @category operations
 */
export const validateProducerDeclaration = (input: {
  readonly operation: string
  readonly slots: ReadonlyArray<string>
}): void => {
  const result = declaration(input)
  if (Result.isFailure(result)) {
    throw result.failure
  }
}
