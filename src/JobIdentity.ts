import { Data, Schema } from "effect"

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

export const QueueName = name(64)
export const JobKind = name(128)
export const OperationName = name(128)
export const SlotName = name(128)
export const JobVersion = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 32_767 }))
)

export const CatalogIdentity = Schema.Struct({
  queue: QueueName,
  kind: JobKind,
  version: JobVersion
})
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

export class InvalidOperationId extends Data.TaggedError("InvalidOperationId")<{
  readonly rule: "unicode-scalars" | "no-nul" | "utf8-length"
  readonly byteLength?: number
}> {}

/** Never echoes the possibly sensitive operation ID. Equality is exact. */
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
export const ProducerIdentity = Schema.Struct({
  operation: OperationName,
  operationId: OperationId,
  slot: SlotName
})
export interface ProducerIdentity<
  Operation extends string = string,
  Slot extends string = string
> {
  readonly operation: Operation
  readonly operationId: string
  readonly slot: Slot
}

export class JobDeclarationError extends Data.TaggedError("JobDeclarationError")<{
  readonly field: "operation" | "slots" | `slots[${number}]`
  readonly value?: string
  readonly expected: string
}> {}

/** Called synchronously by the later producer factory, before returning a declaration. */
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
