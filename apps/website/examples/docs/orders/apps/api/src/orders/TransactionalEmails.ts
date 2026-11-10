import { Context, Schema } from "effect"
import type { Effect } from "effect"

export class EmailUnavailable extends Schema.TaggedError<EmailUnavailable>()(
  "EmailUnavailable",
  {}
) {}

// Application-owned transactional email service; the provider is supplied at composition.
export class TransactionalEmails extends Context.Service<
  TransactionalEmails,
  {
    readonly sendOrderConfirmation: (
      orderId: string
    ) => Effect.Effect<void, EmailUnavailable>
  }
>()("orders/TransactionalEmails") {}
