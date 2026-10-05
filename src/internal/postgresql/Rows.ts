import { Effect, Result, Schema } from "effect"
import * as Lifecycle from "../../JobLifecycle.js"
import { JobStoreProtocolError } from "../../JobStore.js"
import type { ClaimedJob } from "../../JobStore.js"
import { EpochMillis } from "../../JobPolicy.js"
import type { TransactionQuery } from "../../PostgreSqlTransaction.js"

/** pg int8 is text by default; accept only exact bounded decimal integer values. */
const integer = (value: unknown): unknown =>
  typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value
export const snapshot = (row: Record<string, unknown>) =>
  Lifecycle.validateSnapshot({
    jobId: row.id,
    policy: row.policy,
    state: row.state,
    availableAt: integer(row.available_at),
    updatedAt: integer(row.updated_at),
    attemptsMade: integer(row.attempts_made),
    stalledCount: integer(row.stalled_count),
    lifecycleVersion: integer(row.lifecycle_version),
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at === null ? null : integer(row.lease_expires_at),
    completedAt: row.completed_at === null ? null : integer(row.completed_at),
    lastFailureCode: row.last_failure_code
  })
export const claimArtifact = (
  row: Record<string, unknown>,
  stored: Lifecycle.JobSnapshot
): Result.Result<ClaimedJob, Lifecycle.JobLifecycleError> =>
  Result.map(Lifecycle.ownershipOf(stored), (ownership) => ({
    ownership,
    snapshot: stored,
    prepared: {
      catalog: { queue: row.queue, kind: row.kind, version: row.version },
      producer: {
        operation: row.operation,
        operationId: row.operation_id,
        slot: row.slot
      },
      policy: row.policy,
      ...(row.initial_available_at === null
        ? {}
        : { availableAt: integer(row.initial_available_at) }),
      encoded: {
        formatVersion: row.format_version,
        payloadBytes:
          row.payload instanceof Uint8Array ? new Uint8Array(row.payload) : row.payload,
        semanticProjectionBytes:
          row.projection instanceof Uint8Array
            ? new Uint8Array(row.projection)
            : row.projection
      }
    }
  }))
export const fromResult = <A>(result: Result.Result<A, Lifecycle.JobLifecycleError>) =>
  Result.match(result, {
    onSuccess: Effect.succeed,
    onFailure: (error) =>
      Effect.fail(
        new JobStoreProtocolError({
          reason:
            error.reason === "invalid-command" ? "invalid-input" : "invalid-artifact"
        })
      )
  })
export const dbTime = (query: TransactionQuery) =>
  query
    .query("SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now")
    .pipe(
      Effect.flatMap((rows) =>
        Schema.decodeUnknownEffect(EpochMillis)(integer(rows[0]?.now)).pipe(
          Effect.mapError(() => new JobStoreProtocolError({ reason: "invalid-artifact" }))
        )
      )
    )
export const writeSnapshot = (
  query: TransactionQuery,
  jobs: string,
  row: Lifecycle.JobSnapshot
) => {
  const retention =
    row.state === "Completed" ? row.policy.completedRetention : row.policy.deadRetention
  const expiry =
    row.completedAt !== null && retention._tag === "Duration"
      ? Lifecycle.addTimestamp(row.completedAt, retention.millis)
      : null
  const cleanupAt = expiry !== null && Result.isSuccess(expiry) ? expiry.success : null
  return query.query(
    `UPDATE ${jobs} SET state=$2,available_at=$3,updated_at=$4,attempts_made=$5,stalled_count=$6,
  lifecycle_version=$7,lease_token=$8,lease_expires_at=$9,completed_at=$10,last_failure_code=$11,cleanup_at=$12 WHERE id=$1`,
    [
      row.jobId,
      row.state,
      row.availableAt,
      row.updatedAt,
      row.attemptsMade,
      row.stalledCount,
      row.lifecycleVersion,
      row.leaseToken,
      row.leaseExpiresAt,
      row.completedAt,
      row.lastFailureCode,
      cleanupAt
    ]
  )
}
