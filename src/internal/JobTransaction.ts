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
export const withJoinedTransaction = <A, E, R, StorageError, StorageRequirements>(
  insertOrCompare: (
    prepared: PreparedJob
  ) => Effect.Effect<
    EnqueueResult,
    StorageError | JobIntegrityConflict | JobPolicyIncompatible,
    StorageRequirements
  >,
  body: (
    transaction: JobsTransaction<StorageError, StorageRequirements>
  ) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const lifetime = { active: true }
      const transaction: JobsTransaction<StorageError, StorageRequirements> =
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
                | StorageError
                | JobIntegrityConflict
                | JobPolicyIncompatible
                | JobsTransactionClosed,
                StorageRequirements
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
