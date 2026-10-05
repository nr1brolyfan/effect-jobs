import { Effect, Result, Schema } from "effect"
import * as Lifecycle from "../../JobLifecycle.js"
import * as Store from "../../JobStore.js"
import * as Reconciliation from "../lifecycle/Reconciliation.js"
import { PostgreSqlFailure } from "../../PostgreSqlTransaction.js"
import type {
  ApplicationAdapter,
  PostgreSqlError,
  TransactionQuery
} from "../../PostgreSqlTransaction.js"
import { claimArtifact, dbTime, fromResult, snapshot, writeSnapshot } from "./Rows.js"

const inputError = () => new Store.JobStoreProtocolError({ reason: "invalid-input" })
const decode = <S extends Schema.Top>(schema: S, value: unknown) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })(value).pipe(
    Effect.mapError(inputError)
  )
const finalizationSchema = Schema.Struct({
  ownership: Lifecycle.JobOwnership,
  before: Lifecycle.JobSnapshot,
  finalization: Lifecycle.JobFinalization
})
const finalizationInput = (input: Store.FinalizationRequest) =>
  decode(finalizationSchema, input).pipe(
    Effect.map((decoded): Store.FinalizationRequest => ({
      ownership: { ...decoded.ownership },
      finalization: { ...decoded.finalization },
      before: {
        ...decoded.before,
        policy: {
          ...decoded.before.policy,
          retrySchedule: { ...decoded.before.policy.retrySchedule },
          completedRetention: { ...decoded.before.policy.completedRetention },
          deadRetention: { ...decoded.before.policy.deadRetention }
        }
      }
    }))
  )
const unknownResult = <A, B, E, R>(effect: Effect.Effect<A, E, R>, unknown: () => B) =>
  effect.pipe(
    Effect.catchIf(
      (error): error is E & PostgreSqlFailure =>
        error instanceof PostgreSqlFailure && error.commitKnowledge === "Unknown",
      () => Effect.succeed(unknown())
    )
  )

/** Invalid durable metadata is removed from scheduling, not repaired into executable data. */
const isolate = (query: TransactionQuery, jobs: string, id: unknown, now: number) =>
  query.query(
    `UPDATE ${jobs} SET state='Isolated',lease_token=NULL,lease_expires_at=NULL,completed_at=NULL,
  updated_at=$2,last_failure_code='invalid_artifact',
  lifecycle_version=CASE WHEN lifecycle_version BETWEEN 0 AND 9007199254740990 THEN lifecycle_version+1 ELSE lifecycle_version END WHERE id=$1`,
    [id, now]
  )

export const makeStore = (
  adapter: ApplicationAdapter,
  jobs: string,
  payloads: string,
  budget: number
): Store.JobStoreService<PostgreSqlError> => {
  const select = `SELECT j.*,p.format_version,p.payload,p.projection FROM ${jobs} j LEFT JOIN ${payloads} p ON p.job_id=j.id`
  const locked = (query: TransactionQuery, id: string) =>
    query.query(`${select} WHERE j.id=$1 FOR UPDATE OF j`, [id])
  const claim: Store.JobStoreService<PostgreSqlError>["claim"] = (input) =>
    Effect.gen(function* () {
      const validated = Store.validateClaimRequest(input)
      if (Result.isFailure(validated)) {
        return yield* validated.failure
      }
      const request = {
        ...validated.success,
        supportedCatalog: validated.success.supportedCatalog.map((catalog) => ({
          queue: catalog.queue,
          kind: catalog.kind,
          version: catalog.version
        }))
      }
      const result = yield* unknownResult(
        adapter.ownedTransaction((query) =>
          Effect.gen(function* () {
            const now = yield* dbTime(query)
            const params: Array<unknown> = [request.queue, now]
            const supported = request.supportedCatalog
              .map((entry) => {
                params.push(entry.kind, entry.version)
                return `(j.kind=$${params.length - 1} AND j.version=$${params.length})`
              })
              .join(" OR ")
            const row = (yield* query.query(
              `${select} WHERE j.queue=$1 AND (${supported})
        AND j.state IN ('Pending','RetryScheduled') AND j.available_at <= $2
        ORDER BY j.available_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,
              params
            ))[0]
            if (row === undefined) {
              return Store.ClaimResults.Empty()
            }
            const before = snapshot(row)
            if (Result.isFailure(before)) {
              yield* isolate(query, jobs, row.id, now)
              return Store.ClaimResults.Empty()
            }
            const plan = Lifecycle.claim(before.success, request.leaseToken, now, budget)
            if (Result.isFailure(plan)) {
              // Incompatible lease budget cannot be dispatched; no spinning on a poison head row.
              yield* isolate(query, jobs, row.id, now)
              return Store.ClaimResults.Empty()
            }
            yield* writeSnapshot(query, jobs, plan.success)
            const claimed = yield* fromResult(claimArtifact(row, plan.success))
            return Store.ClaimResults.Claimed({ claim: claimed })
          })
        ),
        Store.ClaimResults.Unknown
      )
      if (result._tag !== "Claimed") {
        return result
      }
      // The commit response may have consumed the reserved lease. One bounded DB-time read,
      // not a process-clock inference or a second claim. Unknown lets the worker reconcile.
      return yield* adapter
        .ownedTransaction((query) => dbTime(query))
        .pipe(
          Effect.map((now) =>
            Lifecycle.usableLease(result.claim.snapshot, now, budget)
              ? result
              : Store.ClaimResults.Unknown()
          ),
          Effect.catchTag("PostgreSqlFailure", () =>
            Effect.succeed(Store.ClaimResults.Unknown())
          )
        )
    })
  const reconcileClaim: Store.JobStoreService<PostgreSqlError>["reconcileClaim"] = (
    token
  ) =>
    Effect.gen(function* () {
      yield* decode(Lifecycle.LeaseToken, token)
      return yield* unknownResult(
        adapter.ownedTransaction((query) =>
          Effect.gen(function* () {
            // One statement snapshots row and DB time consistently, no write authority from absence.
            const row = (yield* query.query(
              `${select.replace("SELECT j.*", "SELECT t.db_now,j.*")}, LATERAL (SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS db_now) t
        WHERE j.lease_token=$1`,
              [token]
            ))[0]
            if (row === undefined) {
              return Store.ClaimReconciliations.NotOwned()
            }
            const stored = yield* fromResult(snapshot(row))
            const observed = yield* fromResult(claimArtifact(row, stored))
            return yield* fromResult(
              Reconciliation.inspectClaim(token, observed, Number(row.db_now), budget)
            )
          })
        ),
        Store.ClaimReconciliations.Unknown
      )
    })
  const release: Store.JobStoreService<PostgreSqlError>["release"] = (input, phase) =>
    Effect.gen(function* () {
      const ownership = { ...(yield* decode(Lifecycle.JobOwnership, input)) }
      if (phase !== "BeforeExecution") {
        return yield* inputError()
      }
      return yield* unknownResult(
        adapter.ownedTransaction((query) =>
          Effect.gen(function* () {
            const row = (yield* locked(query, ownership.jobId))[0]
            if (row === undefined) {
              return yield* new Store.JobOwnershipLost()
            }
            const before = yield* fromResult(snapshot(row))
            const now = yield* dbTime(query)
            if (!Lifecycle.isOwned(before, ownership, now)) {
              return yield* new Store.JobOwnershipLost()
            }
            const after = yield* fromResult(
              Lifecycle.release(before, ownership, now, phase)
            )
            yield* writeSnapshot(query, jobs, after)
            return Store.FinalizationResults.Applied()
          })
        ),
        Store.FinalizationResults.Unknown
      )
    })
  const finalize: Store.JobStoreService<PostgreSqlError>["finalize"] = (input) =>
    Effect.gen(function* () {
      const request = yield* finalizationInput(input)
      const beforeOwnership = yield* fromResult(Lifecycle.ownershipOf(request.before))
      if (
        !Schema.toEquivalence(Lifecycle.JobOwnership)(beforeOwnership, request.ownership)
      ) {
        return yield* inputError()
      }
      return yield* unknownResult(
        adapter.ownedTransaction((query) =>
          Effect.gen(function* () {
            const row = (yield* locked(query, request.ownership.jobId))[0]
            if (row === undefined) {
              return yield* new Store.JobOwnershipLost()
            }
            const before = yield* fromResult(snapshot(row))
            const now = yield* dbTime(query)
            if (
              !Lifecycle.isOwned(before, request.ownership, now) ||
              !Schema.toEquivalence(Lifecycle.JobSnapshot)(before, request.before)
            ) {
              return yield* new Store.JobOwnershipLost()
            }
            const after = yield* fromResult(
              Lifecycle.finalize(before, request.ownership, request.finalization, now)
            )
            yield* writeSnapshot(query, jobs, after)
            return Store.FinalizationResults.Applied()
          })
        ),
        Store.FinalizationResults.Unknown
      )
    })
  const reconcileFinalization: Store.JobStoreService<PostgreSqlError>["reconcileFinalization"] =
    (input) =>
      Effect.gen(function* () {
        const request = yield* finalizationInput(input)
        return yield* unknownResult(
          adapter.ownedTransaction((query) =>
            Effect.gen(function* () {
              // LEFT JOIN a singleton guarantees time evidence even when the original row is absent.
              const rows = yield* query.query(
                `SELECT j.*,floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS db_now
        FROM (VALUES (1)) t(n) LEFT JOIN ${jobs} j ON j.id=$1`,
                [request.ownership.jobId]
              )
              const row = rows[0]
              if (row === undefined) {
                return yield* new Store.JobStoreProtocolError({
                  reason: "invalid-artifact"
                })
              }
              const observed = row.id === null ? null : yield* fromResult(snapshot(row))
              return yield* fromResult(
                Reconciliation.inspectFinalization(request, observed, Number(row.db_now))
              )
            })
          ),
          Store.FinalizationReconciliations.Unknown
        )
      })
  const recoverExpired: Store.JobStoreService<PostgreSqlError>["recoverExpired"] = (
    limit
  ) =>
    Effect.gen(function* () {
      yield* decode(Lifecycle.BatchLimit, limit)
      // Number-only core port: uncertain recovery is an explicit Unknown error, NEVER a
      // fabricated zero or success and NEVER replayed by this adapter.
      return yield* adapter.ownedTransaction((query) =>
        Effect.gen(function* () {
          const now = yield* dbTime(query)
          const rows = yield* query.query(
            `SELECT * FROM ${jobs} WHERE state='Active' AND lease_expires_at <= $1
        ORDER BY lease_expires_at,id LIMIT $2 FOR UPDATE SKIP LOCKED`,
            [now, limit]
          )
          for (const row of rows) {
            const plan = Result.flatMap(snapshot(row), (stored) =>
              Lifecycle.recoverExpired(stored, now)
            )
            if (Result.isFailure(plan)) {
              yield* isolate(query, jobs, row.id, now)
            } else {
              yield* writeSnapshot(query, jobs, plan.success)
            }
          }
          return rows.length
        })
      )
    })
  return {
    claim,
    reconcileClaim,
    release,
    finalize,
    reconcileFinalization,
    recoverExpired
  }
}

export const makeCleanup = (
  adapter: ApplicationAdapter,
  jobs: string
): Store.JobCleanupService<PostgreSqlError> => ({
  cleanup: (limit) =>
    Effect.gen(function* () {
      yield* decode(Lifecycle.BatchLimit, limit)
      return yield* adapter.ownedTransaction((query) =>
        Effect.gen(function* () {
          const now = yield* dbTime(query)
          // SQL narrows only terminal states; validated policies decide actual eligibility.
          // Scan/delete bound is identical; invalid or Forever rows are not automatic purges.
          const rows = yield* query.query(
            `SELECT * FROM ${jobs} WHERE state IN ('Completed','Dead') AND cleanup_at <= $1
        ORDER BY cleanup_at,id LIMIT $2 FOR UPDATE SKIP LOCKED`,
            [now, limit]
          )
          let removed = 0
          for (const row of rows) {
            const eligible = Result.flatMap(snapshot(row), (stored) =>
              Lifecycle.cleanupEligible(stored, now)
            )
            if (Result.isSuccess(eligible) && eligible.success) {
              yield* query.query(`DELETE FROM ${jobs} WHERE id=$1`, [row.id])
              removed++
            }
          }
          return removed
        })
      )
    })
})
