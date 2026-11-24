import { DurableObject } from "cloudflare:workers"
import { Duration, Effect, Match, Result, Schema } from "effect"
import * as Job from "../../../src/Job.js"
import { JobPolicyIncompatible } from "../../../src/JobContract.js"
import { JobId } from "../../../src/JobId.js"
import { QueueName } from "../../../src/JobIdentity.js"
import * as JobPolicy from "../../../src/JobPolicy.js"
import * as JobProducer from "../../../src/JobProducer.js"
import * as JobQueue from "../../../src/JobQueue.js"
import * as JobRetryPolicy from "../../../src/JobRetryPolicy.js"
import { withTransaction } from "../../../src/internal/do-sqlite/Transaction.js"
import { makeStore } from "../../../src/internal/do-sqlite/Store.js"
import { ddl, storageTime } from "../../../src/internal/do-sqlite/Storage.js"
interface Bindings {
  readonly STORE: DurableObjectNamespace<Store>
  readonly OBSERVE: Fetcher
}

const Seed = Schema.Struct({
  operationId: Schema.String,
  queue: QueueName,
  artifact: Schema.Literals(["current", "unsupported"]),
  lease: Schema.Literals(["short", "default", "incompatible"]),
  maxStalledCount: Schema.Int,
  maxFinalizedAttempts: Schema.Int
})
const decodeSeed = Schema.decodeUnknownSync(Seed, { onExcessProperty: "error" })
const jobId = Schema.decodeUnknownSync(JobId)
const decodeBoundaryIds = Schema.decodeUnknownSync(Schema.Tuple([JobId, JobId, JobId]))

const recoveryFault = `
  CREATE TRIGGER fixture_fail_second_recovery BEFORE UPDATE ON jobs
  WHEN OLD.state = 'Active' AND NEW.state = 'Pending' AND OLD.queue = 'invoices'
    AND OLD.operationId IN ('rollback-a', 'rollback-b')
    AND EXISTS (
      SELECT 1 FROM jobs AS peer WHERE peer.queue = OLD.queue AND peer.jobId <> OLD.jobId
        AND peer.operationId IN ('rollback-a', 'rollback-b') AND peer.state = 'Pending'
        AND peer.lifecycleVersion = OLD.lifecycleVersion + 1
    )
  BEGIN SELECT RAISE(ABORT, 'fixture second recovery update failed'); END;
`

const observe = async (binding: Fetcher, phase: string, evidence: object) => {
  const response = await binding.fetch("http://observer.local/" + phase, {
    method: "POST",
    body: JSON.stringify(evidence)
  })
  if (!response.ok) {
    throw new Error("fixture observer rejected " + phase)
  }
}
const decodeRecovery = Schema.decodeUnknownResult(
  Schema.Struct({ queue: Schema.Unknown, limit: Schema.Unknown }),
  { onExcessProperty: "error" }
)

const producer = Effect.runSync(
  Effect.gen(function* () {
    const primary = yield* JobQueue.make("invoices")
    const other = yield* JobQueue.make("other")
    const current = yield* Job.make({ name: "invoice.generate", payload: Schema.String })
    const unsupported = yield* Job.make({
      name: "invoice.generate",
      version: 2,
      payload: Schema.String
    })
    return yield* JobProducer.make("invoice.issue").pipe(
      JobProducer.withSlot("current", current, { queues: [primary, other] }),
      JobProducer.withSlot("unsupported", unsupported, { queues: [primary, other] })
    )
  })
)

const seedPolicies = {
  short: { leaseDuration: Duration.millis(1500), attemptTimeout: Duration.millis(100) },
  default: {},
  incompatible: {
    leaseDuration: Duration.millis(200),
    attemptTimeout: Duration.millis(100)
  }
} as const

const json = (body: unknown) =>
  new Response(
    JSON.stringify(body, (_, value: unknown) =>
      value instanceof Uint8Array ? Array.from(value) : value
    ),
    { headers: { "content-type": "application/json" } }
  )

export class Store extends DurableObject<Bindings> {
  readonly epoch = crypto.randomUUID()
  readonly calls = { claim: 0, finalize: 0 }
  readonly acknowledgments = { claim: 0, finalize: 0 }
  readonly dropped = { claim: 0, finalize: 0 }

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env)
    ctx.storage.sql.exec(ddl)
  }

  async seed(input: unknown) {
    const { operationId, queue, artifact, lease, maxStalledCount, maxFinalizedAttempts } =
      decodeSeed(input)
    if (queue !== "invoices" && queue !== "other") {
      throw new Error("unsupported fixture queue")
    }
    const native = this.ctx.storage
    const result = await Effect.runPromise(
      withTransaction(native, (tx) =>
        Effect.gen(function* () {
          const policy = yield* JobPolicy.make({
            ...seedPolicies[lease],
            maxStalledCount,
            retry: JobRetryPolicy.fixed(Duration.millis(500)).pipe(
              JobRetryPolicy.maxFinalizedAttempts(maxFinalizedAttempts)
            )
          })
          return yield* producer.enqueueInTransaction(tx, {
            queue,
            slot: artifact,
            operationId,
            payload: "invoice:" + operationId,
            policy
          })
        })
      )
    )
    await native.sync()
    return result
  }

  state() {
    const native = this.ctx.storage
    const sql = native.sql
    return native.transactionSync(() => ({
      epoch: this.epoch,
      objectId: this.ctx.id.toString(),
      now: storageTime(sql),
      calls: this.calls,
      acknowledgments: this.acknowledgments,
      dropped: this.dropped,
      rows: sql.exec("SELECT * FROM jobs ORDER BY jobId").toArray(),
      artifacts: sql
        .exec(
          "SELECT jobId, formatVersion, hex(payload) AS payload, hex(projection) AS projection FROM payloads ORDER BY jobId"
        )
        .toArray()
    }))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === "/state" && request.method === "GET") {
      return json(this.state())
    }
    if (request.method !== "POST") {
      return new Response(null, { status: 405 })
    }
    const body: unknown = await request.json()
    if (url.pathname === "/fixture-increment-terminal-version") {
      const id = jobId(body)
      const updated = this.ctx.storage.sql
        .exec<{ jobId: string }>(
          "UPDATE jobs SET lifecycleVersion = lifecycleVersion + 1 WHERE jobId = ? AND state = 'Dead' RETURNING jobId",
          id
        )
        .one()
      return json(updated.jobId)
    }
    if (url.pathname === "/seed") {
      return json(await this.seed(body))
    }
    if (url.pathname === "/fixture-fail-second-recovery") {
      this.ctx.storage.sql.exec(recoveryFault)
      return json("installed")
    }

    const native = this.ctx.storage
    const drop = url.searchParams.get("ack") === "drop"
    const heldOperation = url.searchParams.has("hold-sync")
      ? Match.value(url.pathname).pipe(
          Match.when("/claim", () => "claim" as const),
          Match.when("/finalize", () => "finalize" as const),
          Match.orElse(() => undefined)
        )
      : undefined
    const observer = this.env.OBSERVE
    const observation = { operation: heldOperation, objectId: this.ctx.id.toString() }
    let barrierPhase = "not-started"
    let dropPhase: string | undefined
    const boundaryIds =
      url.pathname === "/fixture-recover-at-boundary"
        ? decodeBoundaryIds(body)
        : undefined
    let sampledNow: number | undefined
    const operationToAck =
      url.pathname === "/claim"
        ? "claim"
        : url.pathname === "/finalize"
          ? "finalize"
          : undefined
    const store = makeStore(
      {
        transactionSync: (body) => native.transactionSync(body),
        sync: async () => {
          barrierPhase = "started"
          await native.sync()
          barrierPhase = "native-fulfilled"
          if (heldOperation !== undefined) {
            await observe(observer, "sync-held", observation)
            barrierPhase = "released"
          }
          if (operationToAck !== undefined) {
            this.acknowledgments[operationToAck]++
            if (drop) {
              this.dropped[operationToAck]++
              // Preserve the fixture's distinction between held and unheld barriers.
              dropPhase = heldOperation === undefined ? "not-started" : barrierPhase
              throw new Error("fixture lost the acknowledgment after native sync")
            }
          }
        },
        sql: {
          exec<Row extends Record<string, SqlStorageValue>>(
            query: string,
            ...bindings: unknown[]
          ) {
            const cursor = native.sql.exec<Row>(query, ...bindings)
            if (boundaryIds === undefined || !query.includes("unixepoch('subsec')")) {
              return cursor
            }
            return {
              toArray: () => cursor.toArray(),
              one: () => {
                const row = cursor.one()
                const now = row.now
                if (typeof now !== "number") {
                  throw new Error("fixture expected SQLite time")
                }
                sampledNow = now
                boundaryIds.forEach((id, index) => {
                  native.sql
                    .exec(
                      `UPDATE jobs SET leaseExpiresAt = ? WHERE jobId = ?
                    AND state = 'Active' AND queue = 'invoices' RETURNING jobId`,
                      now + index - 1,
                      id
                    )
                    .one()
                })
                return row
              }
            }
          }
        }
      },
      250
    )
    const operation: Response | Effect.Effect<unknown, { readonly _tag: string }> =
      Match.value(url.pathname).pipe(
        Match.when("/claim", () => {
          this.calls.claim++
          return store.claim(body)
        }),
        Match.when("/reconcile-claim", () => store.reconcileClaim(body)),
        Match.when("/release", () => store.release(body, "BeforeExecution")),
        Match.when("/finalize", () => {
          this.calls.finalize++
          return store.finalize(body)
        }),
        Match.when("/reconcile-finalization", () => store.reconcileFinalization(body)),
        Match.when("/fixture-recover-at-boundary", () =>
          store.recoverExpired("invoices", 3)
        ),
        Match.when("/recover", () => {
          const recovery = decodeRecovery(body)
          return Result.isSuccess(recovery)
            ? store.recoverExpired(recovery.success.queue, recovery.success.limit)
            : new Response(null, { status: 400 })
        }),
        Match.orElse(() => new Response(null, { status: 404 }))
      )
    if (operation instanceof Response) {
      return operation
    }
    const result = await Effect.runPromise(Effect.result(operation))
    const response = json(
      Result.match(result, {
        onSuccess: (value) =>
          boundaryIds === undefined ? value : { count: value, sampledNow },
        onFailure: (error) => ({
          _tag: error._tag,
          ...("reason" in error ? { reason: error.reason } : {}),
          ...("commitKnowledge" in error
            ? { commitKnowledge: error.commitKnowledge }
            : {}),
          ...(error instanceof JobPolicyIncompatible
            ? { requiredMillis: error.requiredMillis, reserveMillis: error.reserveMillis }
            : {})
        })
      })
    )
    if (heldOperation !== undefined) {
      // Snapshot at construction in the DO, before the output gate can delay HTTP.
      await observe(observer, "response-created", {
        ...observation,
        barrierPhase,
        dropPhase
      })
    }
    return response
  }
}

export default {
  fetch: (request: Request, env: Bindings) =>
    env.STORE.getByName("qualification-jobs").fetch(request)
}
