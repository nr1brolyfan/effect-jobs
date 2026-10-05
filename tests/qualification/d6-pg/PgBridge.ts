/** Qualification prototype only. No pool construction, DDL, transaction control or replay. */
import { randomUUID } from "node:crypto"
import { Context, Effect, Layer } from "effect"
import {
  EnqueueResults,
  JobIntegrityConflict,
  type PreparedJob
} from "../../../src/JobContract.js"
import type { JobId } from "../../../src/JobId.js"
import type { JobsTransaction } from "../../../src/JobTransaction.js"
import { withJoinedTransaction } from "../../../src/internal/JobTransaction.js"
import * as App from "./ApplicationTransactions.js"

export class ApplicationSource extends Context.Service<ApplicationSource, App.Source>()(
  "d6/ApplicationSource"
) {}
export type Failure = App.PgFailure | App.InvalidHandle
export interface Integration {
  readonly join: <A, E, R>(
    handle: App.Handle,
    body: (tx: JobsTransaction<Failure>) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | Failure, R>
  readonly withTransaction: <A, E, R>(
    body: (tx: JobsTransaction<Failure>, handle: App.Handle) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | Failure, R>
}
export class JobTransactions extends Context.Service<JobTransactions, Integration>()(
  "d6/JobTransactions"
) {}

const insert = (handle: App.Handle, prepared: PreparedJob) =>
  Effect.gen(function* () {
    const { producer, catalog, encoded } = prepared
    const id = randomUUID() as JobId
    const rows = yield* handle.query<{ id: JobId }>(
      `INSERT INTO d6_fixture.jobs (id, operation, operation_id, slot, catalog, policy)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (operation,operation_id,slot) DO NOTHING RETURNING id`,
      [
        id,
        producer.operation,
        producer.operationId,
        producer.slot,
        JSON.stringify(catalog),
        JSON.stringify(prepared.policy)
      ]
    )
    if (rows.length === 0) {
      const existing = yield* handle.query<{
        id: JobId
        catalog: string
        projection: Buffer
      }>(
        `SELECT j.id,j.catalog,p.projection FROM d6_fixture.jobs j JOIN d6_fixture.job_payloads p ON p.job_id=j.id
       WHERE operation=$1 AND operation_id=$2 AND slot=$3`,
        [producer.operation, producer.operationId, producer.slot]
      )
      const prior = existing[0]
      if (
        prior === undefined ||
        prior.catalog !== JSON.stringify(catalog) ||
        !prior.projection.equals(Buffer.from(encoded.semanticProjectionBytes))
      ) {
        return yield* new JobIntegrityConflict()
      }
      return EnqueueResults.AlreadyPresent({ jobId: prior.id })
    }
    yield* handle.query(
      "INSERT INTO d6_fixture.job_payloads (job_id,payload,projection) VALUES ($1,$2,$3)",
      [
        id,
        Buffer.from(encoded.payloadBytes),
        Buffer.from(encoded.semanticProjectionBytes)
      ]
    )
    return EnqueueResults.Inserted({ jobId: id })
  })

export const make = Effect.gen(function* () {
  const source = yield* ApplicationSource
  const join: Integration["join"] = (handle, body) =>
    App.validate(source, handle).pipe(
      Effect.flatMap(() =>
        withJoinedTransaction((prepared) => insert(handle, prepared), body)
      )
    )
  return JobTransactions.of({
    join,
    withTransaction: (body) =>
      App.withTransaction(source, (handle) => join(handle, (tx) => body(tx, handle)))
  })
})
export const layerNoDeps = Layer.effect(JobTransactions, make)
