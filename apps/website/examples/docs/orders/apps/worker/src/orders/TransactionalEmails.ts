import { Context, Effect, Schema } from "effect"

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
