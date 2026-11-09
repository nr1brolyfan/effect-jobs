import * as JobApi from "effect-jobs/JobApi"
import * as JobApiBuilder from "effect-jobs/JobApiBuilder"
import { Context, Data, Effect, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as Group from "effect-jobs/JobGroup"
import * as Queue from "effect-jobs/JobQueue"
import * as Producer from "effect-jobs/JobProducer"
import * as Policy from "effect-jobs/JobPolicy"
import * as Codes from "effect-jobs/FailureCode"
import { JobFailures } from "effect-jobs/JobFailure"

export class AdmissionRejected extends Data.TaggedError("AdmissionRejected")<{}> {}
export class OperationUnconfirmed extends Data.TaggedError("OperationUnconfirmed")<{}> {}

const identifier = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-zA-Z0-9-]{1,64}$/))
)
export type IssueRequest = typeof IssueRequest.Type
export const IssueRequest = Schema.Struct({
  invoiceId: identifier,
  requestId: identifier
})
export const decodeRequest = Schema.decodeUnknownEffect(IssueRequest, {
  onExcessProperty: "error"
})

// DEVELOPMENT ONLY. The credential attests a principal; request data cannot select a tenant.
export const admitDevelopment = (authorization: string) =>
  authorization === "Bearer development-alice"
    ? Effect.succeed("tenant-a")
    : authorization === "Bearer development-bob"
      ? Effect.succeed("tenant-b")
      : Effect.fail(new AdmissionRejected())

export const BillingQueue = Queue.make("billing")
export const DeliverInvoice = Job.make({
  kind: "invoice.deliver",
  payload: Schema.Struct({ tenantId: identifier, invoiceId: identifier })
})
export const BillingJobs = Group.make("alchemy-billing", { deliver: DeliverInvoice })
export const IssueInvoice = Producer.make("billing.issue-invoice").pipe(
  Producer.withSlot("deliver", DeliverInvoice, {
    queue: BillingQueue,
    policy: Policy.defaultPolicy
  })
)

export class InvoiceDelivery extends Context.Service<
  InvoiceDelivery,
  {
    readonly deliver: (
      tenantId: string,
      invoiceId: string,
      idempotencyKey: string
    ) => Effect.Effect<void, AdmissionRejected | OperationUnconfirmed>
  }
>()("example/InvoiceDelivery") {}

const codes = Codes.define({
  unconfirmed: "delivery_unconfirmed",
  forbidden: "invoice_forbidden"
})
export const Handlers = JobApiBuilder.group(
  JobApi.make(BillingJobs.name).pipe(JobApi.addGroup(BillingJobs)),
  BillingJobs.name,
  (_handlers) =>
    _handlers.handle("deliver", (input) =>
      Effect.gen(function* () {
        const delivery = yield* InvoiceDelivery
        yield* delivery
          .deliver(input.payload.tenantId, input.payload.invoiceId, input.context.jobId)
          .pipe(
            Effect.catchTags({
              AdmissionRejected: () =>
                Effect.fail(JobFailures.Dead({ code: codes.forbidden })),
              OperationUnconfirmed: () =>
                Effect.fail(JobFailures.OutcomeUnknown({ code: codes.unconfirmed }))
            })
          )
      })
    )
)
