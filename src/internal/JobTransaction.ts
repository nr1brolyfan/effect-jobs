import { Effect } from "effect"
import type { EnqueueResult, JobIntegrityConflict, PreparedJob } from "../JobContract.js"
import { JobsTransactionClosed, type JobsTransaction } from "../JobTransaction.js"

/** Internal-only: never a package subpath or root export. */
export const JobsTransactionTypeId: unique symbol = Symbol("effect-jobs/JobsTransaction")

/** Qualified bridges call this only within the application's active transaction. */
export const withJoinedTransaction = <A, E, R, BackendError, BackendRequirements>(
  insertOrCompare: (
    prepared: PreparedJob
  ) => Effect.Effect<
    EnqueueResult,
    BackendError | JobIntegrityConflict,
    BackendRequirements
  >,
  body: (
    transaction: JobsTransaction<BackendError, BackendRequirements>
  ) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const lifetime = { active: true }
      const transaction: JobsTransaction<BackendError, BackendRequirements> =
        Object.freeze({
          [JobsTransactionTypeId]: Object.freeze({
            insertOrCompare: (prepared: PreparedJob) =>
              Effect.suspend<
                EnqueueResult,
                BackendError | JobIntegrityConflict | JobsTransactionClosed,
                BackendRequirements
              >(() =>
                lifetime.active
                  ? insertOrCompare(prepared)
                  : Effect.fail(new JobsTransactionClosed({ reason: "callback-exited" }))
              )
          })
        })
      return { lifetime, transaction }
    }),
    ({ transaction }) => Effect.suspend(() => body(transaction)).pipe(Effect.scoped),
    ({ lifetime }) =>
      Effect.sync(() => {
        lifetime.active = false
      })
  )

/** Only the definition/producer implementation calls this; no ambient store. */
export const insertPrepared = <E, R>(
  transaction: JobsTransaction<E, R>,
  prepared: PreparedJob
) => transaction[JobsTransactionTypeId].insertOrCompare(prepared)
