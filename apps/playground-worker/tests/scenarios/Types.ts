import { Effect } from "effect"
import * as Codec from "effect-jobs/JobPayloadCodec"
import type { JobPayloadCodecError } from "effect-jobs/JobContract"
import { DocumentKeys } from "../../src/scenarios/PrivateDocument.js"
import * as Definitions from "../../src/scenarios/Definitions.js"

declare const definitions: Definitions.Setup
declare const payload: Definitions.ExportPayload
export const encoded: Effect.Effect<unknown, JobPayloadCodecError, DocumentKeys> =
  Codec.encodeJobPayload(definitions.ExportPayload, payload)

type AssertNever<T extends never> = T
// @ts-expect-error Encrypted encoding cannot lose the application key requirement.
export type MissingKeys = AssertNever<Effect.Services<typeof encoded>>

export const invalidSlot = definitions.Producer.enqueue({
  operationId: "synthetic",
  // @ts-expect-error Producer slots are closed application declarations.
  slot: "real-payment",
  // @ts-expect-error A closed slot payload must satisfy one declared job.
  payload: {}
})

// @ts-expect-error Private export always requires a decoded typed document.
export const missingDocument: Definitions.ExportPayload = {} as Definitions.Payload
