import { DateTime, Schema } from "effect"
import { EpochMillis } from "../JobPolicy.js"

/** An absolute UTC instant representable by the durable epoch-millisecond format. */
export const JobInstant = Schema.DateTimeUtc.pipe(
  Schema.check(
    Schema.makeFilter((value) => Schema.is(EpochMillis)(DateTime.toEpochMillis(value)))
  )
)
