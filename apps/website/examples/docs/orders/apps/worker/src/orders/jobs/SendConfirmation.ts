import { Effect, Layer } from "effect"
import * as Group from "effect-jobs/JobGroup"
import { JobFailures } from "effect-jobs/JobFailure"
import { OrderJobs } from "#orders/contracts/jobs"
import { TransactionalEmails } from "#worker/orders/TransactionalEmails"
import { EmailCodes } from "#worker/orders/jobs/EmailCodes"

// #region handler
export const ConfirmationHandlerLayer = Layer.unwrap(
  Effect.map(OrderJobs, (jobs) =>
    Group.handlers(jobs.ConfirmationJobs, (handlers) =>
      handlers.handle(
        "confirmation",
        Effect.fn("Orders.sendConfirmation")(function* (input) {
          const emails = yield* TransactionalEmails

          yield* emails
            .send({
              // Reuse the job ID across attempts; an attempt number is not a delivery key.
              deliveryKey: input.context.jobId,
              subject: "Order confirmation",
              body: `Order ${input.payload.orderId} received.`
            })
            .pipe(
              Effect.catchTags({
                // Retry only when we know the provider didn't accept the message.
                EmailBusy: () =>
                  Effect.fail(JobFailures.Retry({ code: EmailCodes.busy })),
                EmailUncertain: () => Effect.fail(JobFailures.OutcomeUnknown())
              })
            )
        })
      )
    )
  )
)
// Definition only: the worker composition installs this Layer and starts work.
// #endregion handler
