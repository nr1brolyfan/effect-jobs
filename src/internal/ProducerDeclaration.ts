import { Data, Result, Schema } from "effect"

/** ASCII declaration-name grammar shared by queue, name, operation and slot Schemas.
 * @category constants
 */
export const nameFormat = "^[a-z][a-z0-9.-]*$"
const namePattern = /^[a-z][a-z0-9.-]*$/u
export const name = (maximum: number) =>
  Schema.String.pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(maximum),
      Schema.isPattern(namePattern)
    )
  )

/**
 * Declaration validation failure with an actionable field/name constraint.
 *
 * @category errors
 */
export class JobDeclarationError extends Data.TaggedError("JobDeclarationError")<{
  readonly field: "operation" | "slots" | `slots[${number}]`
  readonly value?: string
  readonly expected: string
}> {}

const declarationName = name(128)

/** Pure classification shared by the existing synchronous utility and lazy producer setup. */
export const declaration = (input: {
  readonly operation: string
  readonly slots: ReadonlyArray<string>
}): Result.Result<void, JobDeclarationError> => {
  const expected = `1–128 ASCII characters matching ${nameFormat}`
  if (!Schema.is(declarationName)(input.operation)) {
    return Result.fail(
      new JobDeclarationError({ field: "operation", value: input.operation, expected })
    )
  }
  const seen = new Set<string>()
  for (const [index, slot] of input.slots.entries()) {
    if (!Schema.is(declarationName)(slot)) {
      return Result.fail(
        new JobDeclarationError({ field: `slots[${index}]`, value: slot, expected })
      )
    }
    if (seen.has(slot)) {
      return Result.fail(
        new JobDeclarationError({
          field: `slots[${index}]`,
          value: slot,
          expected: "unique declared slot"
        })
      )
    }
    seen.add(slot)
  }
  return Result.succeed(undefined)
}
