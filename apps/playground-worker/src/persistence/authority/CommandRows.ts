import { Effect, Schema } from "effect"
import { EpochMillis } from "effect-jobs/JobPolicy"
import { Generation } from "@effect-jobs/playground-contracts/Sandbox"
import { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import { RequestId } from "@effect-jobs/playground-contracts/Scenarios"
import { StoredReceipt } from "../commands/Transactions.js"

const maximumIntegerText = String(Number.MAX_SAFE_INTEGER)

// Native int8 values must be checked before conversion can discard precision.
// SQL NULL is malformed here; receipt absence belongs to the row lookup owner.
export const decodeCount = Effect.fnUntraced(function* (
  input: unknown
): Effect.fn.Return<number, PlaygroundError> {
  if (typeof input === "number" && Number.isSafeInteger(input) && input >= 0) {
    return input
  }
  if (typeof input === "bigint" && input >= 0n && input <= 9_007_199_254_740_991n) {
    return Number(input)
  }
  if (
    typeof input === "string" &&
    input.length <= maximumIntegerText.length &&
    /^(?:0|[1-9][0-9]*)(?![\s\S])/.test(input) &&
    (input.length < maximumIntegerText.length || input <= maximumIntegerText)
  ) {
    return Number(input)
  }
  return yield* new PlaygroundError({ code: "unavailable" })
})

export const decodeMillis = (input: unknown): Effect.Effect<number, PlaygroundError> =>
  decodeCount(input).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(EpochMillis)),
    Effect.mapError(() => new PlaygroundError({ code: "unavailable" }))
  )

export const decodeGeneration = (
  input: unknown
): Effect.Effect<number, PlaygroundError> =>
  decodeCount(input).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Generation)),
    Effect.mapError(() => new PlaygroundError({ code: "unavailable" }))
  )

// Compile selections with these physical keys: .toSQL() does not apply
// Drizzle's runtime field mapper. Zero rows is absence; a malformed present
// projection or impossible multiplicity is a bounded persistence failure.
const ReceiptRows = Schema.Array(Schema.Struct({ receipt: StoredReceipt })).pipe(
  Schema.check(Schema.isMaxLength(1))
)
const AdmissionRows = Schema.Array(Schema.Struct({ request_id: RequestId })).pipe(
  Schema.check(Schema.isMaxLength(1))
)

export const decodeReceiptRows = (input: unknown) =>
  Schema.decodeUnknownEffect(ReceiptRows, { onExcessProperty: "error" })(input).pipe(
    Effect.map((rows) => rows[0]?.receipt ?? null),
    Effect.mapError(() => new PlaygroundError({ code: "unavailable" }))
  )

export const decodeAdmissionRows = (input: unknown) =>
  Schema.decodeUnknownEffect(AdmissionRows, { onExcessProperty: "error" })(input).pipe(
    Effect.mapError(() => new PlaygroundError({ code: "unavailable" }))
  )
