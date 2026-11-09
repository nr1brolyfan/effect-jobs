import * as JobApi from "../../../src/JobApi.js"
import * as JobApiBuilder from "../../../src/JobApiBuilder.js"
/**
 * Jobs operations already own safe terminal observations. The application owns
 * logger/tracer/exporter Layers, resources, finite transport/shutdown and sampling.
 * See docs/observability.md and load its checklist with each complete source file.
 */
import { Effect, Schema } from "effect"
import * as Job from "../../../src/Job.js"
import * as Group from "../../../src/JobGroup.js"
import { JobFailures } from "../../../src/JobFailure.js"
import { define } from "../../../src/FailureCode.js"

const codes = define({ temporarilyUnavailable: "temporarily_unavailable" })
export const InvoiceJob = Job.make({
  kind: "invoice.generate",
  payload: Schema.Struct({ invoiceId: Schema.String })
})

// Expected failure classifies Retry. Do not attach payload, code, identity or Cause
// to a span. Single expected Fail and mixed Cause have different meanings.
const group = Group.make("observability-invoices", { invoice: InvoiceJob })
export const InvoiceHandlerLayer = JobApiBuilder.group(
  JobApi.make(group.name).pipe(JobApi.addGroup(group)),
  group.name,
  (_handlers) =>
    _handlers.handle("invoice", () =>
      Effect.fail(JobFailures.Retry({ code: codes.temporarilyUnavailable }))
    )
)

// Own jobs spans deliberately finish with Success(void), then restore the original
// Exit outside the span. A red span is not a durable-job/availability counter.
// App-owned named failing spans can still export raw provider errors: sanitize at
// their actual construction boundary. An outer observer cannot redact ended children.
// Do not reuse the old auth sanitization imports; they are not jobs APIs.
