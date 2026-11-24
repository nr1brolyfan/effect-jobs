import { DurableObject } from "cloudflare:workers"
import { Data, Duration, Effect, Layer, Schema } from "effect"
import * as Sqlite from "effect-jobs/DurableObjectSqlite"
import * as Job from "effect-jobs/Job"
import * as JobApi from "effect-jobs/JobApi"
import * as JobGroup from "effect-jobs/JobGroup"
import * as JobProducer from "effect-jobs/JobProducer"
import * as JobQueue from "effect-jobs/JobQueue"
import * as JobStorage from "effect-jobs/JobStorage"
import * as JobWorker from "effect-jobs/JobWorker"

interface Bindings {
  readonly INVOICES: DurableObjectNamespace<InvoiceJobs>
}

const responseBudgetMillis = 250
const Invoice = Schema.Struct({
  invoiceId: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
  amountCents: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))
})
const decodeCommand = Schema.decodeUnknownEffect(
  Schema.Struct({
    operationId: Schema.String,
    payload: Invoice,
    failAfterWrites: Schema.optional(Schema.Boolean)
  }),
  { onExcessProperty: "error" }
)

class InjectedRollback extends Data.TaggedError("InjectedRollback")<{}> {}

const { api, group, producer, queue } = Effect.runSync(
  Effect.gen(function* () {
    const queue = yield* JobQueue.make("invoices")
    const record = yield* Job.make({ name: "invoice.record", payload: Invoice })
    const producer = yield* JobProducer.make("invoice.issue").pipe(
      JobProducer.withSlot("record", record, { queue })
    )
    const group = yield* JobGroup.make("invoices", { record })
    const api = yield* JobApi.make("invoice-example").pipe(JobApi.addGroup(group))
    return { api, group, producer, queue }
  })
)

export class InvoiceJobs extends DurableObject<Bindings> {
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env)
    // The application runs its migrations on the target object's own storage.
    ctx.storage.transactionSync(() => {
      ctx.storage.sql.exec(Sqlite.ddl)
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS invoices (
          operationId TEXT PRIMARY KEY NOT NULL,
          invoiceId TEXT NOT NULL,
          amountCents INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS recorded_invoices (
          jobId TEXT PRIMARY KEY NOT NULL,
          invoiceId TEXT NOT NULL,
          amountCents INTEGER NOT NULL
        ) STRICT;
      `)
    })
  }

  private issue(request: Request) {
    const storage = this.ctx.storage
    return Effect.gen(function* () {
      const body: unknown = yield* Effect.tryPromise(() => request.json())
      const { operationId, payload, failAfterWrites } = yield* decodeCommand(body)
      const result = yield* Sqlite.withTransaction(
        storage,
        responseBudgetMillis,
        (transaction, write) =>
          Effect.gen(function* () {
            const enqueued = yield* producer.enqueueInTransaction(transaction, {
              slot: "record",
              operationId,
              payload
            })
            if (enqueued._tag === "Inserted") {
              yield* write((sql) => {
                sql.exec(
                  "INSERT INTO invoices VALUES (?, ?, ?)",
                  operationId,
                  payload.invoiceId,
                  payload.amountCents
                )
              })
              if (failAfterWrites) {
                return yield* new InjectedRollback()
              }
            }
            return enqueued
          })
      )
      yield* Effect.tryPromise(() => storage.sync())
      return Response.json(result)
    }).pipe(
      Effect.catchTag("InjectedRollback", () =>
        Effect.succeed(Response.json({ _tag: "InjectedRollback" }, { status: 409 }))
      )
    )
  }

  private drain() {
    const storage = this.ctx.storage
    const handlers = JobGroup.handlers(group, (builder) =>
      Effect.succeed(
        builder.handle("record", ({ context, payload }) =>
          Effect.sync(() => {
            storage.sql.exec(
              "INSERT INTO recorded_invoices VALUES (?, ?, ?) ON CONFLICT(jobId) DO NOTHING",
              context.jobId,
              payload.invoiceId,
              payload.amountCents
            )
          })
        )
      )
    )
    const jobs = JobStorage.layer({
      store: Sqlite.makeStore(storage, responseBudgetMillis),
      operationResponseBudget: Duration.millis(responseBudgetMillis)
    })
    const worker = JobWorker.layer(api, { queues: [{ queue, concurrency: 1 }] }).pipe(
      Layer.provide(Layer.mergeAll(handlers, jobs))
    )
    return JobWorker.drain(queue, { maxJobs: 1, recoveryLimit: 1 }).pipe(
      Effect.provide(worker),
      Effect.timeout("2 seconds")
    )
  }

  private inspect(operationId: string) {
    const storage = this.ctx.storage
    const { sql } = storage
    // Example oracle. These queries inspect this object's current state directly.
    return storage.transactionSync(() => ({
      invoices: sql
        .exec(
          "SELECT invoiceId, amountCents FROM invoices WHERE operationId = ?",
          operationId
        )
        .toArray(),
      jobs: sql
        .exec(
          "SELECT jobId, state FROM jobs WHERE operation = 'invoice.issue' AND operationId = ?",
          operationId
        )
        .toArray(),
      recordings: sql
        .exec(
          `SELECT r.jobId, r.invoiceId, r.amountCents FROM recorded_invoices r
          JOIN jobs j ON r.jobId = j.jobId
          WHERE j.operation = 'invoice.issue' AND j.operationId = ?`,
          operationId
        )
        .toArray(),
      payloadCount: sql
        .exec<{ count: number }>("SELECT count(*) AS count FROM payloads")
        .one().count
    }))
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === "POST" && url.pathname === "/issue") {
      return Effect.runPromise(this.issue(request))
    }
    if (request.method === "POST" && url.pathname === "/drain") {
      return Response.json(await Effect.runPromise(this.drain()))
    }
    const operationId = url.searchParams.get("operationId")
    if (request.method === "GET" && url.pathname === "/inspect" && operationId) {
      return Response.json(this.inspect(operationId))
    }
    return new Response(null, { status: 404 })
  }
}

export default {
  fetch: (request: Request, env: Bindings) =>
    env.INVOICES.getByName("invoice-example").fetch(request)
}
