/**
 * @title Persistence mutation boundaries
 *
 * The adapter owns commit knowledge and preserves transaction lifecycle failures.
 * Session issue and boundary rotation persist authority plus immutable evidence
 * references; revoke and revoke-all persist their terminal authority changes.
 * Every mutation also persists its focused receipt, required security audit,
 * and required durable jobs in the same terminal transaction. Unknown COMMIT outcomes are
 * resolved only through a read-only lookup of that operation's exact receipt;
 * receipt absence does not grant write authority. Replay is reserved for
 * failures proven NotCommitted and replay-safe.
 */
import { Effect, Exit, Match, Schema } from "effect"
import { CommitKnowledge, RegistrationOutcomeUnknown } from "../fixtures/Auth.js"

export class TransactionUnavailable extends Schema.TaggedError<TransactionUnavailable>()(
  "TransactionUnavailable",
  { commitKnowledge: CommitKnowledge }
) {}

interface Transaction {
  readonly execute: Effect.Effect<unknown, TransactionUnavailable>
  readonly commit: Effect.Effect<void, TransactionUnavailable>
  readonly rollback: Effect.Effect<void, TransactionUnavailable>
  readonly release: Effect.Effect<void, TransactionUnavailable>
}

declare const acquire: Effect.Effect<Transaction, TransactionUnavailable>

export const mutate = Effect.acquireUseRelease(
  acquire,
  (transaction) =>
    Effect.gen(function* () {
      const value = yield* transaction.execute
      yield* transaction.commit
      return value
    }).pipe(
      Effect.onExit((exit) =>
        Exit.match(exit, {
          onSuccess: () => Effect.void,
          onFailure: () => transaction.rollback
        })
      )
    ),
  (transaction) => transaction.release
)

export const projectMutationFailure = Match.type<TransactionUnavailable>().pipe(
  Match.when(
    { commitKnowledge: "Unknown" },
    () => new RegistrationOutcomeUnknown({ commitKnowledge: "Unknown" })
  ),
  Match.orElse(
    (failure) => new TransactionUnavailable({ commitKnowledge: failure.commitKnowledge })
  )
)

/*
// Avoid: timeout, interruption, or a lost response does not prove rollback.
store.create(command).pipe(
  Effect.mapError(() => new TransactionUnavailable({ commitKnowledge: "NotCommitted" }))
)
*/
