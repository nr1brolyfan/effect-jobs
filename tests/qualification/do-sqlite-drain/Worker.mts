import { DurableObject } from "cloudflare:workers"
import { Duration, Effect, Layer, Match, Schema } from "effect"
import * as Job from "../../../src/Job.js"
import * as JobApi from "../../../src/JobApi.js"
import { type HandlerInput } from "../../../src/JobContract.js"
import * as JobGroup from "../../../src/JobGroup.js"
import * as JobProducer from "../../../src/JobProducer.js"
import * as JobQueue from "../../../src/JobQueue.js"
import * as JobStorage from "../../../src/JobStorage.js"
import * as JobWorker from "../../../src/JobWorker.js"
import { withTransaction } from "../../../src/internal/do-sqlite/Transaction.js"
import { ddl, type SqlStorage } from "../../../src/internal/do-sqlite/Storage.js"
import { makeStore } from "../../../src/internal/do-sqlite/Store.js"

const responseBudgetMillis = 250

interface Bindings {
  readonly JOBS: DurableObjectNamespace<Jobs>
}

const Payload = Schema.Struct({
  invoiceId: Schema.String.pipe(Schema.check(Schema.isNonEmpty())),
  amountCents: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))
})
const Enqueue = Schema.Struct({ operationId: Schema.String, payload: Payload })
const decodeEnqueue = Schema.decodeUnknownEffect(Enqueue, { onExcessProperty: "error" })

const { api, group, producer, queue } = Effect.runSync(
  Effect.gen(function* () {
    const queue = yield* JobQueue.make("invoices")
    const invoice = yield* Job.make({ name: "invoice.deliver", payload: Payload })
    const producer = yield* JobProducer.make("invoice.issue").pipe(
      JobProducer.withSlot("deliver", invoice, { queue })
    )
    const group = yield* JobGroup.make("invoices", { invoice })
    const api = yield* JobApi.make("qualification").pipe(JobApi.addGroup(group))
    return { api, group, producer, queue }
  })
)

export class Jobs extends DurableObject<Bindings> {
  private readonly epoch = crypto.randomUUID()
  private readonly entries: Array<HandlerInput<typeof Payload.Type>> = []
  private readonly scopes = { acquired: 0, released: 0 }
  private drains = 0

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env)
    ctx.storage.sql.exec(ddl)
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS invoice_deliveries (
        jobId TEXT PRIMARY KEY REFERENCES jobs(jobId),
        invoiceId TEXT NOT NULL,
        amountCents INTEGER NOT NULL,
        confirmation TEXT NOT NULL
      ) STRICT
    `)
  }

  private workerLayer() {
    const handlers = JobGroup.handlers(group, (builder) =>
      Effect.gen({ self: this }, function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            this.scopes.acquired++
          }),
          () =>
            Effect.sync(() => {
              this.scopes.released++
            })
        )
        return builder.handle("invoice", (input) =>
          Effect.sync(() => {
            this.entries.push(input)
            const { invoiceId, amountCents } = input.payload
            this.ctx.storage.sql.exec(
              "INSERT INTO invoice_deliveries VALUES (?, ?, ?, ?)",
              input.context.jobId,
              invoiceId,
              amountCents,
              `delivered:${invoiceId}:${amountCents}`
            )
          })
        )
      })
    )
    const storage = JobStorage.layer({
      store: makeStore(this.ctx.storage, responseBudgetMillis),
      operationResponseBudget: Duration.millis(responseBudgetMillis)
    })
    return JobWorker.layer(api, { queues: [{ queue, concurrency: 1 }] }).pipe(
      Layer.provide(Layer.mergeAll(handlers, storage))
    )
  }

  // A derived fixture can join the application write to this native transaction.
  protected writeDomain?(
    sql: SqlStorage,
    operationId: string,
    payload: typeof Payload.Type
  ): void

  protected enqueue(request: Request) {
    const native = this.ctx.storage
    return Effect.gen({ self: this }, function* () {
      const input: unknown = yield* Effect.promise(() => request.json())
      const command = yield* decodeEnqueue(input)
      const result = yield* withTransaction(native, responseBudgetMillis, (tx, write) =>
        Effect.gen({ self: this }, function* () {
          const result = yield* producer.enqueueInTransaction(tx, {
            slot: "deliver",
            ...command
          })
          if (result._tag === "Inserted") {
            yield* write((sql) =>
              this.writeDomain?.(sql, command.operationId, command.payload)
            )
          }
          return result
        })
      )
      yield* Effect.promise(() => native.sync())
      return result
    })
  }

  private state() {
    const native = this.ctx.storage
    // Raw SQLite rows let the runner check persisted state independently of the worker port.
    return native.transactionSync(() => ({
      epoch: this.epoch,
      objectId: this.ctx.id.toString(),
      drains: this.drains,
      scopes: this.scopes,
      entries: this.entries,
      deliveries: native.sql
        .exec("SELECT * FROM invoice_deliveries ORDER BY jobId")
        .toArray(),
      jobs: native.sql.exec("SELECT * FROM jobs ORDER BY jobId").toArray()
    }))
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (request.method === "GET" && path === "/state") {
      return Response.json(this.state())
    }
    if (request.method !== "POST") {
      return new Response(null, { status: 404 })
    }
    return Match.value(path).pipe(
      Match.when("/enqueue", async () =>
        Response.json(await Effect.runPromise(this.enqueue(request)))
      ),
      Match.when("/assemble", async () => {
        const worker = JobWorker.JobWorker.pipe(
          Effect.as("assembled"),
          Effect.provide(this.workerLayer()),
          Effect.timeout("2 seconds")
        )
        return Response.json(await Effect.runPromise(worker))
      }),
      Match.when("/drain", async () => {
        this.drains++
        const drain = JobWorker.drain(queue, { maxJobs: 1, recoveryLimit: 1 }).pipe(
          Effect.provide(this.workerLayer()),
          Effect.timeout("2 seconds")
        )
        return Response.json(await Effect.runPromise(drain))
      }),
      Match.orElse(() => new Response(null, { status: 404 }))
    )
  }
}

export default {
  fetch: (request: Request, env: Bindings) =>
    env.JOBS.getByName("qualification-invoices").fetch(request)
}
