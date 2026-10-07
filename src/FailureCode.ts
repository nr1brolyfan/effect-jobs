/** Validated application-owned diagnostic identifiers. */
import { Data, Result, Schema } from "effect"

/** 1–128 ASCII identifier characters. Catalog membership is not a storage requirement.
 * Codes must never contain provider messages, secrets or private identifiers.
 * Validation checks syntax, not whether a valid identifier contains sensitive data.
 * @category schemas
 */
export const FailureCode = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(128),
    Schema.isPattern(/^[a-z0-9][a-z0-9_-]*$(?![\s\S])/u)
  ),
  Schema.brand("effect-jobs/FailureCode")
)
/** @category models */
export type FailureCode = typeof FailureCode.Type

/** Safe entry-specific configuration diagnostic, without retaining the value.
 * @category errors
 */
export class InvalidFailureCode extends Data.TaggedError("InvalidFailureCode")<{
  readonly entry: string
  readonly expected: string
}> {
  override get message(): string {
    return `Invalid failure code entry ${this.entry}: expected ${this.expected}`
  }
}

/** Parse a dynamic or historical identifier without throwing or requiring a catalog.
 * @category decoding
 */
export const parse = (value: string): Result.Result<FailureCode, InvalidFailureCode> =>
  Schema.decodeResult(FailureCode)(value).pipe(
    Result.mapError(
      () =>
        new InvalidFailureCode({
          entry: "dynamic",
          expected: "1–128 characters matching ^[a-z0-9][a-z0-9_-]*$"
        })
    )
  )

/** Validate a catalog once, preserving each literal and adding the brand.
 * Throws InvalidFailureCode at definition time. Define catalogs before startup.
 * @category constructors
 */
export const define = <const Codes extends Readonly<Record<string, string>>>(
  codes: Codes
): { readonly [K in keyof Codes]: Codes[K] & FailureCode } => {
  const validated = Object.fromEntries(
    Object.entries(codes).map(([entry, value]) => {
      const result = parse(value)
      if (Result.isFailure(result)) {
        throw new InvalidFailureCode({ entry, expected: result.failure.expected })
      }
      return [entry, result.success]
    })
  )
  // Every value was decoded above; the cast preserves the input's literal keys/values.
  return Object.freeze(validated) as {
    readonly [K in keyof Codes]: Codes[K] & FailureCode
  }
}
