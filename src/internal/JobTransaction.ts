import { Effect } from "effect"
import type {
  EnqueueResult,
  JobIntegrityConflict,
  JobPolicyIncompatible,
  PreparedJob
} from "../JobContract.js"
import { JobsTransactionClosed, type JobsTransaction } from "../JobTransaction.js"

/** Internal-only: never a package subpath or root export. */
export const JobsTransactionTypeId: unique symbol = Symbol("effect-jobs/JobsTransaction")

/** Qualified bridges call this only within the application's active transaction. */
export const withJoinedTransaction = <A, E, R, BackendError, BackendRequirements>(
  insertOrCompare: (
    prepared: PreparedJob
  ) => Effect.Effect<
    EnqueueResult,
    BackendError | JobIntegrityConflict | JobPolicyIncompatible,
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
            assertActive: Effect.suspend(() =>
              lifetime.active
                ? Effect.void
                : Effect.fail(new JobsTransactionClosed({ reason: "callback-exited" }))
            ),
            insertOrCompare: (prepared: PreparedJob) =>
              Effect.suspend<
                EnqueueResult,
                | BackendError
                | JobIntegrityConflict
                | JobPolicyIncompatible
                | JobsTransactionClosed,
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
    (resource) => Effect.suspend(() => body(resource.transaction)).pipe(Effect.scoped),
    (resource) =>
      Effect.sync(() => {
        resource.lifetime.active = false
      })
  )

/** Only the definition/producer implementation calls this; no ambient store. */
export const insertPrepared = <E, R>(
  transaction: JobsTransaction<E, R>,
  prepared: PreparedJob
) => transaction[JobsTransactionTypeId].insertOrCompare(prepared)

/** Check invocation lifetime before asynchronous Schema services, then again at insertion. */
export const insertPreparing = <E, R, PreparationError, PreparationServices>(
  transaction: JobsTransaction<E, R>,
  prepare: Effect.Effect<PreparedJob, PreparationError, PreparationServices>
) =>
  transaction[JobsTransactionTypeId].assertActive.pipe(
    Effect.andThen(prepare),
    Effect.flatMap((prepared) => insertPrepared(transaction, prepared))
  )
