import { Effect } from "effect"
import * as Codec from "effect-jobs/JobPayloadCodec"
import type { JobPayloadCodecError } from "effect-jobs/JobContract"
import { DocumentKeys } from "../../src/scenarios/PrivateDocument.js"
import * as Definitions from "../../src/scenarios/Definitions.js"

declare const payload: Definitions.ExportPayload
export const encoded: Effect.Effect<unknown, JobPayloadCodecError, DocumentKeys> =
  Codec.encodeJobPayload(Definitions.ExportPayload, payload)

type AssertNever<T extends never> = T
// @ts-expect-error Encrypted encoding cannot lose the application key requirement.
export type MissingKeys = AssertNever<Effect.Services<typeof encoded>>

// @ts-expect-error Producer slots are closed application declarations.
Definitions.Producer.identity({ operationId: "synthetic", slot: "real-payment" })

// @ts-expect-error Private export always requires a decoded typed document.
export const missingDocument: Definitions.ExportPayload = {} as Definitions.Payload
