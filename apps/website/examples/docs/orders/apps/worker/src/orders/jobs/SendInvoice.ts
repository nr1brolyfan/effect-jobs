import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import * as JobApi from "effect-jobs/JobApi"
import * as JobApiBuilder from "effect-jobs/JobApiBuilder"
import * as FailureCode from "effect-jobs/FailureCode"
import { JobFailures } from "effect-jobs/JobFailure"
import { Database } from "#database/Database"
import { invoices } from "#database/schema"
import { OrderJobs } from "#orders/contracts/jobs"
import { TransactionalEmails, EmailCodes } from "#worker/orders/jobs/SendConfirmation"

const Codes = FailureCode.define({
  missing: "invoice_missing",
  read: "invoice_read_failed"
})

// #region handler
export const InvoiceDeliveryHandlerLayer = Layer.unwrap(
  Effect.map(OrderJobs, (jobs) =>
    JobApiBuilder.group(
      JobApi.make(jobs.DeliveryJobs.name).pipe(JobApi.addGroup(jobs.DeliveryJobs)),
      jobs.DeliveryJobs.name,
      (handlers) =>
        handlers.handle(
          "delivery",
          Effect.fn("Orders.sendInvoice")(function* (input) {
            const db = yield* Database
            const emails = yield* TransactionalEmails

            const [invoice] = yield* db
              .select()
              .from(invoices)
              .where(eq(invoices.invoiceId, input.payload.invoiceId))
              .limit(1)
              .pipe(Effect.mapError(() => JobFailures.Retry({ code: Codes.read })))

            if (!invoice) {
              return yield* Effect.fail(JobFailures.Isolate({ code: Codes.missing }))
            }

            yield* emails
              .send({
                deliveryKey: input.context.jobId,
                subject: "Synthetic order invoice",
                body: invoice.document
              })
              .pipe(
                Effect.catchTags({
                  EmailBusy: () =>
                    Effect.fail(JobFailures.Retry({ code: EmailCodes.busy })),
                  EmailUncertain: () =>
                    Effect.fail(
                      JobFailures.OutcomeUnknown({ code: EmailCodes.uncertain })
                    )
                })
              )
          })
        )
    )
  )
)
// #endregion handler
