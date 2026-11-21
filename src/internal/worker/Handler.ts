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

export const addressKey = (address: JobAddress) =>
  `${address.queue}\u0000${address.name}\u0000${address.version}`

/** Immutable group lookup in production; protocol fixtures may install handlers. */
export interface HandlerLookup {
  readonly immutable?: true
  readonly find: (catalog: JobAddress) => JobHandler | undefined
}
