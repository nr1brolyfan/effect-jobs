import { Schema } from "effect"

/** Opaque library-assigned identifier. Applications must not supply enqueue IDs. */
export const JobId = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand("effect-jobs/JobId")
)
export type JobId = typeof JobId.Type
