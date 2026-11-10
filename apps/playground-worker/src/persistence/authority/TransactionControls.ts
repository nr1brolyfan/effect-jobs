// @effect-diagnostics unstableApiUsage:off
// Relocated from adapters already using this pinned Effect SQL API.
import { Cause, Effect } from "effect"
import { isSqlError, type SqlError } from "effect/sql/SqlError"
import { CommandTransactionFailure } from "../commands/Transactions.js"

// Native transaction-control uncertainty is never inferred as rollback.
export const controls = <A, E, R>(effect: Effect.Effect<A, E | SqlError, R>) =>
  effect.pipe(
    Effect.catchCause((cause) =>
      Effect.failCause(
        Cause.fromReasons<E | CommandTransactionFailure>(
          cause.reasons.map((reason) => {
            if (
              (Cause.isFailReason(reason) && isSqlError(reason.error)) ||
              (Cause.isDieReason(reason) && isSqlError(reason.defect))
            ) {
              return Cause.makeFailReason(
                new CommandTransactionFailure({ commitKnowledge: "Unknown" })
              )
            }
            // All SqlError failures were replaced above; other reasons retain E.
            return reason as Cause.Reason<E>
          })
        )
      )
    )
  )
