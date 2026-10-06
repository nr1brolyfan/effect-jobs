/**
 * Validates catalog and producer identities without normalizing operation IDs.
 */
import { Data, Schema } from "effect"

/**
 * ASCII declaration-name grammar shared by queue, kind, operation and slot Schemas.
 *
 * @category constants
 */
export const nameFormat = "^[a-z][a-z0-9.-]*$"
const namePattern = /^[a-z][a-z0-9.-]*$/u
const name = (maximum: number) =>
  Schema.String.pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(maximum),
      Schema.isPattern(namePattern)
    )
  )

/**
 * Queue-name Schema: 1–64 ASCII characters matching nameFormat.
 *
 * @category schemas
 */
export const QueueName = name(64)
/**
 * Job-kind Schema: 1–128 ASCII characters matching nameFormat.
 *
 * @category schemas
 */
export const JobKind = name(128)
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
 * Queue/kind/version Schema and literal-preserving structural identity.
 *
 * @category schemas
 */
export const CatalogIdentity = Schema.Struct({
  queue: QueueName,
  kind: JobKind,
  version: JobVersion
})
/**
 * Queue/kind/version Schema and literal-preserving structural identity.
 *
 * @category models
 */
export interface CatalogIdentity<
  Queue extends string = string,
  Kind extends string = string,
  Version extends number = number
> {
  readonly queue: Queue
  readonly kind: Kind
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
 * Synchronous identifier failure; reports the violated rule without echoing the ID.
 *
 * @category errors
 */
export class InvalidOperationId extends Data.TaggedError("InvalidOperationId")<{
  readonly rule: "unicode-scalars" | "no-nul" | "utf8-length"
  readonly byteLength?: number
}> {}

/**
 * Validates Unicode scalars, absence of NUL and 1–256 UTF-8 bytes. Throws
 * InvalidOperationId; compares IDs exactly, without trimming or normalization.
 *
 * @category operations
 */
export const validateOperationId = (value: string): void => {
  if (!validScalars(value)) {
    throw new InvalidOperationId({ rule: "unicode-scalars" })
  }
  if (value.includes("\u0000")) {
    throw new InvalidOperationId({ rule: "no-nul" })
  }
  const byteLength = utf8.encode(value).byteLength
  if (byteLength < 1 || byteLength > 256) {
    throw new InvalidOperationId({ rule: "utf8-length", byteLength })
  }
}

/**
 * Opaque operation-ID Schema: valid Unicode scalars, no NUL, 1–256 UTF-8 bytes.
 * Application-branded strings are accepted without an extra library brand.
 *
 * @category schemas
 */
export const OperationId = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => {
      const length = utf8.encode(value).byteLength
      return (
        validScalars(value) && !value.includes("\u0000") && length >= 1 && length <= 256
      )
    })
  )
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
 * Synchronous declaration failure with an actionable field/name constraint.
 *
 * @category errors
 */
export class JobDeclarationError extends Data.TaggedError("JobDeclarationError")<{
  readonly field: "operation" | "slots" | `slots[${number}]`
  readonly value?: string
  readonly expected: string
}> {}

/**
 * Validates operation and nonempty unique slots synchronously; throws
 * JobDeclarationError. Called by JobProducer.make before returning configuration.
 *
 * @category operations
 */
export const validateProducerDeclaration = (input: {
  readonly operation: string
  readonly slots: ReadonlyArray<string>
}): void => {
  const expected = `1–128 ASCII characters matching ${nameFormat}`
  if (!Schema.is(OperationName)(input.operation)) {
    throw new JobDeclarationError({
      field: "operation",
      value: input.operation,
      expected
    })
  }
  if (input.slots.length === 0) {
    throw new JobDeclarationError({
      field: "slots",
      expected: "at least one unique slot"
    })
  }
  const seen = new Set<string>()
  input.slots.forEach((slot, index) => {
    if (!Schema.is(SlotName)(slot)) {
      throw new JobDeclarationError({ field: `slots[${index}]`, value: slot, expected })
    }
    if (seen.has(slot)) {
      throw new JobDeclarationError({
        field: `slots[${index}]`,
        value: slot,
        expected: "unique declared slot"
      })
    }
    seen.add(slot)
  })
}
