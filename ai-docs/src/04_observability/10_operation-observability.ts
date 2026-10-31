/**
 * Jobs operations already own safe terminal observations. The application owns
 * logger/tracer/exporter Layers, resources, finite transport/shutdown and sampling.
 * See docs/observability.md and load its checklist with each complete source file.
 */
import { Effect, Schema } from "effect"
import * as Job from "../../../src/Job.js"
import * as Queue from "../../../src/JobQueue.js"
import * as Codec from "../../../src/JobPayloadCodec.js"
import { JobFailures } from "../../../src/JobFailure.js"
import { define } from "../../../src/FailureCode.js"

const codes = define({ temporarilyUnavailable: "temporarily_unavailable" })
export const InvoiceJob = Job.make({
  queue: Queue.make("billing"),
  kind: "invoice.generate",
  payload: Schema.Struct({ invoiceId: Schema.String }),
  encodePayload: Codec.encodeJobPayload
})

// Expected failure classifies Retry. Do not attach payload, code, identity or Cause
// to a span. Single expected Fail and mixed Cause have different meanings.
export const InvoiceHandlerLayer = InvoiceJob.handlerLayer(
  () => Effect.fail(JobFailures.Retry({ code: codes.temporarilyUnavailable })),
  Codec.decodeJobPayload
)

// Own jobs spans deliberately finish with Success(void), then restore the original
// Exit outside the span. A red span is not a durable-job/availability counter.
// App-owned named failing spans can still export raw provider errors: sanitize at
// their actual construction boundary. An outer observer cannot redact ended children.
// Do not reuse the old auth sanitization imports; they are not jobs APIs.
