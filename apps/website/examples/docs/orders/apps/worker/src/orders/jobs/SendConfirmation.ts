import { Context, Effect, Layer, Schema } from "effect"
import * as JobApi from "effect-jobs/JobApi"
import * as JobApiBuilder from "effect-jobs/JobApiBuilder"
import * as FailureCode from "effect-jobs/FailureCode"
import { JobFailures } from "effect-jobs/JobFailure"
import { OrderJobs } from "#orders/contracts/jobs"

export class EmailBusy extends Schema.TaggedError<EmailBusy>()("EmailBusy", {}) {}
export class EmailUncertain extends Schema.TaggedError<EmailUncertain>()(
  "EmailUncertain",
  {}
) {}

export class TransactionalEmails extends Context.Service<
  TransactionalEmails,
  {
    readonly send: (message: {
      readonly deliveryKey: string
      readonly subject: string
      readonly body: string
    }) => Effect.Effect<void, EmailBusy | EmailUncertain>
  }
>()("worker/orders/TransactionalEmails") {}

export const EmailCodes = FailureCode.define({
  busy: "mail_busy",
  uncertain: "mail_uncertain"
})

// #region handler
export const ConfirmationHandlerLayer = Layer.unwrap(
  Effect.map(OrderJobs, (jobs) =>
    JobApiBuilder.group(
      JobApi.make(jobs.ConfirmationJobs.name).pipe(
        JobApi.addGroup(jobs.ConfirmationJobs)
      ),
      jobs.ConfirmationJobs.name,
      (handlers) =>
        handlers.handle(
          "confirmation",
          Effect.fn("Orders.sendConfirmation")(function* (input) {
            const emails = yield* TransactionalEmails

            yield* emails
              .send({
                deliveryKey: input.context.jobId,
                subject: "Order confirmation",
                body: `Order ${input.payload.orderId} received.`
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
// Definition only: the worker composition installs this Layer and starts work.
// #endregion handler
