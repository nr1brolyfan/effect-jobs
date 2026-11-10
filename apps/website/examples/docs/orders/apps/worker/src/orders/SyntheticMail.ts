import { Effect, Layer } from "effect"
import { Database } from "#database/Database"
import { syntheticMail } from "#database/schema"
import { TransactionalEmails, EmailUncertain } from "#worker/orders/jobs/SendConfirmation"

// Durable synthetic records only. No network, recipient, credentials or email.
// A production adapter needs its own idempotency and reconciliation contract.
export const layer = Layer.effect(
  TransactionalEmails,
  Effect.gen(function* () {
    const db = yield* Database

    return TransactionalEmails.of({
      send: (message) =>
        db
          .insert(syntheticMail)
          .values(message)
          .onConflictDoNothing({ target: syntheticMail.deliveryKey })
          .pipe(
            Effect.asVoid,
            Effect.mapError(() => new EmailUncertain())
          )
    })
  })
)
