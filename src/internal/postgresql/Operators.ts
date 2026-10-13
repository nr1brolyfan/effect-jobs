import { Effect, Result, Schema } from "effect"
import type { JobDefinition } from "../../Job.js"
import type {
  JobOperatorsService,
  JobCorrectedRedriveRequest,
  JobLineage
} from "../../JobOperators.js"
import {
  JobOperatorExpected,
  JobOperatorRejected,
  JobRedriveRequest
} from "../../JobOperators.js"
import * as Lifecycle from "../../JobLifecycle.js"
import { CatalogIdentity, ProducerIdentity } from "../../JobIdentity.js"
import { decodeJobPayload, encodeJobPayload } from "../../JobPayloadCodec.js"
import { PreparedArtifact } from "../lifecycle/Artifacts.js"
import { PostgreSqlInvalidHandle } from "../../PostgreSqlTransaction.js"
import type {
  ApplicationAdapter,
  PostgreSqlError,
  TransactionQuery
} from "../../PostgreSqlTransaction.js"
import { dbTime, snapshot, integer, lineage } from "./Rows.js"
import { EpochMillis } from "../../JobPolicy.js"
import { PostgreSqlConfigurationError } from "../../PostgreSqlSchema.js"
import { insertOrCompareAt } from "./Producer.js"

const reject = (reason: JobOperatorRejected["reason"]) =>
  new JobOperatorRejected({ reason })
const strict = { onExcessProperty: "error" } as const
const planResult = <A>(result: Result.Result<A, Lifecycle.JobLifecycleError>) =>
  Result.match(result, {
    onSuccess: Effect.succeed,
    onFailure: (error) =>
      Effect.fail(
        reject(
          error.reason === "invalid-snapshot"
            ? "invalid-artifact"
            : error.reason === "invalid-command"
              ? "invalid-input"
              : error.reason === "state-version-conflict" ||
                  error.reason === "already-due" ||
                  error.reason === "arithmetic-bound"
                ? error.reason
                : "not-eligible"
        )
      )
  })
/** No connection/transaction ownership; pass the exact configured adapter and quoted relations. */
export const makeOperators = (
  adapter: ApplicationAdapter,
  jobs: string,
  payloads: string,
  operationResponseBudgetMillis: number
): JobOperatorsService<PostgreSqlError> => {
  if (!Schema.is(EpochMillis)(operationResponseBudgetMillis)) {
    throw new PostgreSqlConfigurationError({ field: "operationResponseBudgetMillis" })
  }
  const ambient =
    adapter.ambient ??
    Effect.fail(new PostgreSqlInvalidHandle({ reason: "unqualified-handle" }))
  const lock = (
    query: TransactionQuery,
    expected: JobOperatorExpected,
    artifact: boolean
  ) =>
    Effect.gen(function* () {
      const row = (yield* query.query(
        artifact
          ? `SELECT j.*,p.format_version,p.payload,p.projection FROM ${jobs} j LEFT JOIN ${payloads} p ON p.job_id=j.id WHERE j.id=$1 FOR UPDATE OF j`
          : `SELECT * FROM ${jobs} WHERE id=$1 FOR UPDATE`,
        [expected.jobId]
      ))[0]
      if (row === undefined) {
        return yield* reject("not-found")
      }
      const before = yield* planResult(snapshot(row))
      if (
        before.jobId !== expected.jobId ||
        before.state !== expected.state ||
        before.lifecycleVersion !== expected.lifecycleVersion
      ) {
        return yield* reject("state-version-conflict")
      }
      return { row, before }
    })
  const transition = (action: "retryNow" | "cancel") =>
    Effect.fn(`JobOperators.${action}`)(function* (input: JobOperatorExpected) {
      const query = yield* ambient
      const expected = yield* Schema.decodeEffect(
        JobOperatorExpected,
        strict
      )(input).pipe(Effect.mapError(() => reject("invalid-input")))
      const { before } = yield* lock(query, expected, false)
      const now = yield* dbTime(query).pipe(
        Effect.mapError((error) =>
          error._tag === "JobStoreProtocolError" ? reject("invalid-artifact") : error
        )
      )
      const after = yield* planResult(Lifecycle[action](before, expected, now))
      const changed = yield* query.query(
        `UPDATE ${jobs} SET state=$4,available_at=$5,updated_at=$6,lifecycle_version=$7,completed_at=$8,cleanup_at=NULL
       WHERE id=$1 AND state=$2 AND lifecycle_version=$3 AND lease_token IS NULL AND lease_expires_at IS NULL RETURNING id`,
        [
          expected.jobId,
          expected.state,
          expected.lifecycleVersion,
          after.state,
          after.availableAt,
          after.updatedAt,
          after.lifecycleVersion,
          after.completedAt
        ]
      )
      if (changed.length !== 1) {
        return yield* reject("state-version-conflict")
      }
      return {
        jobId: before.jobId,
        beforeState: before.state,
        beforeVersion: before.lifecycleVersion,
        after
      }
    })
  const sourceMetadata = Schema.Struct({
    catalog: PreparedArtifact.fields.catalog,
    producer: PreparedArtifact.fields.producer,
    policy: PreparedArtifact.fields.policy,
    availableAt: PreparedArtifact.fields.availableAt
  })
  const repair = <S extends Schema.Top>(
    definition: Pick<JobDefinition<S>, "catalog" | "payload">,
    input: JobRedriveRequest | JobCorrectedRedriveRequest<S["Type"]>,
    corrected: boolean
  ) =>
    Effect.gen(function* () {
      // Establish authority before any payload preparation or codec service access.
      const query = yield* ambient
      const request = yield* Schema.decodeUnknownEffect(
        corrected
          ? Schema.Struct({ ...JobRedriveRequest.fields, payload: Schema.Unknown })
          : JobRedriveRequest,
        strict
      )(input).pipe(Effect.mapError(() => reject("invalid-input")))
      const { row, before } = yield* lock(query, request.expected, !corrected)
      if (before.state !== "Dead" && before.state !== "Isolated") {
        return yield* reject("not-eligible")
      }
      if (
        before.policy.leaseDurationMillis - before.policy.attemptTimeoutMillis <
        operationResponseBudgetMillis
      ) {
        return yield* reject("invalid-artifact")
      }
      yield* lineage(row).pipe(Effect.mapError(() => reject("invalid-artifact")))
      const metadata = yield* Schema.decodeUnknownEffect(
        sourceMetadata,
        strict
      )({
        catalog: { queue: row.queue, kind: row.kind, version: row.version },
        producer: {
          operation: row.operation,
          operationId: row.operation_id,
          slot: row.slot
        },
        policy: before.policy,
        ...(row.initial_available_at === null
          ? {}
          : { availableAt: integer(row.initial_available_at) })
      }).pipe(Effect.mapError(() => reject("invalid-artifact")))
      if (
        !Schema.is(CatalogIdentity)(definition.catalog) ||
        !Schema.toEquivalence(CatalogIdentity)(metadata.catalog, definition.catalog)
      ) {
        return yield* reject("unsupported-catalog")
      }
      if (Schema.toEquivalence(ProducerIdentity)(metadata.producer, request.producer)) {
        return yield* reject("invalid-input")
      }
      const encoded = corrected
        ? yield* encodeJobPayload(
            definition.payload,
            (request as JobCorrectedRedriveRequest<S["Type"]>).payload
          )
        : yield* Schema.decodeUnknownEffect(
            PreparedArtifact.fields.encoded,
            strict
          )({
            formatVersion: row.format_version,
            payloadBytes:
              row.payload instanceof Uint8Array
                ? new Uint8Array(row.payload)
                : row.payload,
            semanticProjectionBytes:
              row.projection instanceof Uint8Array
                ? new Uint8Array(row.projection)
                : row.projection
          }).pipe(Effect.mapError(() => reject("invalid-artifact")))
      // Both forms authenticate canonical projection and decode with the exact definition.
      yield* decodeJobPayload(definition.payload, encoded)
      const now = yield* dbTime(query).pipe(
        Effect.mapError((error) =>
          error._tag === "JobStoreProtocolError" ? reject("invalid-artifact") : error
        )
      )
      const edge: JobLineage = {
        originalSourceJobId: request.expected.jobId,
        sourceJobId: request.expected.jobId,
        kind: corrected ? "CorrectedRedrive" : "Redrive"
      }
      const result = yield* insertOrCompareAt(
        query,
        jobs,
        payloads,
        { ...metadata, encoded, producer: request.producer, availableAt: now },
        now,
        undefined,
        edge
      )
      return {
        source: request.expected,
        jobId: result.jobId,
        inserted: result._tag === "Inserted",
        dbNow: now,
        lineage: edge
      }
    })
  return {
    retryNow: transition("retryNow"),
    cancel: transition("cancel"),
    redrive: Effect.fn("JobOperators.redrive")(
      <S extends Schema.Top>(
        definition: Pick<JobDefinition<S>, "catalog" | "payload">,
        request: JobRedriveRequest
      ) => repair(definition, request, false)
    ),
    correctedRedrive: Effect.fn("JobOperators.correctedRedrive")(
      <S extends Schema.Top>(
        definition: Pick<JobDefinition<S>, "catalog" | "payload">,
        request: JobCorrectedRedriveRequest<S["Type"]>
      ) => repair(definition, request, true)
    )
  }
}
