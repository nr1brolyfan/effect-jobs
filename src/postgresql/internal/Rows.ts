import { Effect, Result, Schema, SchemaGetter, SchemaParser } from "effect"
import * as Lifecycle from "../../JobLifecycle.js"
import { JobStoreProtocolError } from "../../JobStore.js"
import type { ClaimedJob } from "../../JobStore.js"
import { JobLineage } from "../../JobOperators.js"
import { EpochMillis, PersistedJobPolicy } from "../../JobPolicy.js"
import type { TransactionQuery } from "../PostgreSqlTransaction.js"

/** pg int8 is text by default; accept only exact bounded decimal integer values. */
export const integer = (value: unknown): unknown =>
  typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value
// Keep the exact int8 spelling policy, then validate through the target Schema.
export const Integer = Schema.Unknown.pipe(
  Schema.decode({
    decode: SchemaGetter.transform(integer),
    encode: SchemaGetter.forbiddenEncoding
  })
)
const StoredPolicy = Schema.Unknown.pipe(
  Schema.decodeTo(Schema.toType(PersistedJobPolicy), {
    decode: SchemaGetter.transformEffect((input) =>
      SchemaParser.decodeUnknownEffect(PersistedJobPolicy, { onExcessProperty: "error" })(
        input
      )
    ),
    encode: SchemaGetter.forbiddenEncoding
  })
)
const SnapshotRow = Schema.Struct({
  jobId: Schema.Unknown,
  policy: StoredPolicy,
  state: Schema.Unknown,
  availableAt: Integer,
  updatedAt: Integer,
  createdAt: Integer,
  finalizedAttempts: Integer,
  stalledCount: Integer,
  lifecycleVersion: Integer,
  leaseToken: Schema.Unknown,
  leaseExpiresAt: Integer,
  completedAt: Integer,
  lastFailureCode: Schema.Unknown
}).pipe(
  Schema.encodeKeys({
    jobId: "id",
    availableAt: "available_at",
    updatedAt: "updated_at",
    createdAt: "created_at",
    finalizedAttempts: "attempts_made",
    stalledCount: "stalled_count",
    lifecycleVersion: "lifecycle_version",
    leaseToken: "lease_token",
    leaseExpiresAt: "lease_expires_at",
    completedAt: "completed_at",
    lastFailureCode: "last_failure_code"
  }),
  Schema.decodeTo(Lifecycle.JobSnapshot)
)
export const snapshot = (row: Record<string, unknown>) =>
  Schema.decodeUnknownResult(SnapshotRow)(row).pipe(
    Result.mapError(() => new Lifecycle.JobLifecycleError({ reason: "invalid-snapshot" }))
  )
export const claimArtifact = (
  row: Record<string, unknown>,
  stored: Lifecycle.JobSnapshot
): Result.Result<ClaimedJob, Lifecycle.JobLifecycleError> =>
  Result.map(Lifecycle.ownershipOf(stored), (ownership) => ({
    ownership,
    snapshot: stored,
    prepared: {
      catalog: { queue: row.queue, name: row.kind, version: row.version },
      producer: {
        operation: row.operation,
        operationId: row.operation_id,
        slot: row.slot
      },
      policy: stored.policy,
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
const ClockRow = Schema.Struct({ now: Integer.pipe(Schema.decodeTo(EpochMillis)) })
export const dbTime = (query: TransactionQuery) =>
  query
    .query("SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now")
    .pipe(
      Effect.flatMap((rows) =>
        Schema.decodeUnknownEffect(ClockRow)(rows[0]).pipe(
          Effect.map((row) => row.now),
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
    (row.state === "Completed" || row.state === "Dead") &&
    row.completedAt !== null &&
    retention._tag === "Duration"
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
      row.finalizedAttempts,
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

/** Validate the durable immediate edge independently of worker lifecycle snapshots. */
export const lineage = (row: Record<string, unknown>) =>
  Effect.gen(function* () {
    if (
      row.original_source_job_id === null &&
      row.source_job_id === null &&
      row.redrive_kind === null
    ) {
      return null
    }
    const edge = yield* Schema.decodeUnknownEffect(JobLineage)({
      originalSourceJobId: row.original_source_job_id,
      sourceJobId: row.source_job_id,
      kind: row.redrive_kind
    }).pipe(
      Effect.mapError(() => new JobStoreProtocolError({ reason: "invalid-artifact" }))
    )
    if (edge.originalSourceJobId === row.id) {
      return yield* new JobStoreProtocolError({ reason: "invalid-artifact" })
    }
    return edge
  })
