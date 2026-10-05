import { Effect, Schema } from "effect"
import { EnqueueResults, JobIntegrityConflict } from "../../JobContract.js"
import type { PreparedJob } from "../../JobContract.js"
import type { JobId } from "../../JobId.js"
import { JobId as JobIdSchema } from "../../JobId.js"
import type { TransactionQuery } from "../../PostgreSqlTransaction.js"
import { dbTime } from "./Rows.js"
import { PostgreSqlFailure } from "../../PostgreSqlTransaction.js"

/** READ COMMITTED is required: the post-conflict statement sees the committed winner. */
export const insertOrCompare = (
  query: TransactionQuery,
  jobs: string,
  payloads: string,
  prepared: PreparedJob
) =>
  Effect.gen(function* () {
    const { catalog, producer, encoded } = prepared
    const id = yield* Effect.sync(() => globalThis.crypto.randomUUID() as JobId)
    const now = yield* dbTime(query).pipe(
      Effect.mapError(() => new PostgreSqlFailure({ commitKnowledge: "NotCommitted" }))
    )
    const rows = yield* query.query(
      `INSERT INTO ${jobs} (id,operation,operation_id,slot,queue,kind,version,policy,initial_available_at,state,available_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Pending',$10,$11)
      ON CONFLICT (operation,operation_id,slot) DO NOTHING RETURNING id`,
      [
        id,
        producer.operation,
        producer.operationId,
        producer.slot,
        catalog.queue,
        catalog.kind,
        catalog.version,
        JSON.stringify(prepared.policy),
        prepared.availableAt ?? null,
        prepared.availableAt ?? now,
        now
      ]
    )
    if (rows.length === 0) {
      // Hold the parent until comparison completes: cleanup cannot remove evidence in between.
      const prior = (yield* query.query(
        `SELECT j.id,j.queue,j.kind,j.version,p.format_version,p.projection FROM ${jobs} j JOIN ${payloads} p ON p.job_id=j.id
        WHERE j.operation=$1 AND j.operation_id=$2 AND j.slot=$3 FOR KEY SHARE OF j`,
        [producer.operation, producer.operationId, producer.slot]
      ))[0]
      const projection = prior?.projection
      if (
        prior === undefined ||
        !Schema.is(JobIdSchema)(prior.id) ||
        prior.queue !== catalog.queue ||
        prior.kind !== catalog.kind ||
        prior.version !== catalog.version ||
        prior.format_version !== encoded.formatVersion ||
        !(projection instanceof Uint8Array) ||
        projection.length !== encoded.semanticProjectionBytes.length ||
        !encoded.semanticProjectionBytes.every((byte, i) => byte === projection[i])
      ) {
        // Poison this producer transaction even if trusted application code catches the typed error.
        // A real SQL error forces the outer owner to roll back all domain writes.
        yield* query.query("SELECT 1/0").pipe(Effect.ignore)
        return yield* new JobIntegrityConflict()
      }
      return EnqueueResults.AlreadyPresent({ jobId: prior.id as JobId })
    }
    yield* query.query(
      `INSERT INTO ${payloads} (job_id,format_version,payload,projection) VALUES ($1,$2,$3,$4)`,
      [
        id,
        encoded.formatVersion,
        new Uint8Array(encoded.payloadBytes),
        new Uint8Array(encoded.semanticProjectionBytes)
      ]
    )
    return EnqueueResults.Inserted({ jobId: id })
  })
