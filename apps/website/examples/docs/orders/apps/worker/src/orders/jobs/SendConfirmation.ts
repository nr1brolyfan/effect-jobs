import { Context, Effect, Schema } from "effect"
import * as JobPayloadCodec from "effect-jobs/JobPayloadCodec"
import * as FailureCode from "effect-jobs/FailureCode"
import { JobFailures } from "effect-jobs/JobFailure"
import { SendOrderConfirmation } from "#orders/contracts/jobs"

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
export const ConfirmationHandlerLayer = SendOrderConfirmation.handlerLayer(
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
          EmailBusy: () => Effect.fail(JobFailures.Retry({ code: EmailCodes.busy })),
          EmailUncertain: () =>
            Effect.fail(JobFailures.OutcomeUnknown({ code: EmailCodes.uncertain }))
        })
      )
  }),
  JobPayloadCodec.decodeJobPayload
)
// Definition only: the worker composition installs this Layer and starts work.
// #endregion handler
