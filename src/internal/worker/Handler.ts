/** Captured handler port shared by group binding and the durable engine. */
import type { Effect } from "effect"
import type {
  EncodedJobPayload,
  HandlerContext,
  JobPayloadCodecError
} from "../../JobContract.js"
import type { JobFailure } from "../../JobFailure.js"
import type { JobAddress } from "../../JobIdentity.js"

export interface JobHandler {
  readonly catalog: JobAddress
  readonly execute: (
    encoded: EncodedJobPayload,
    context: HandlerContext
  ) => Effect.Effect<void, JobFailure | JobPayloadCodecError>
}

/** Immutable group lookup in production; protocol fixtures may install handlers. */
export interface HandlerLookup {
  readonly find: (catalog: JobAddress) => JobHandler | undefined
}
