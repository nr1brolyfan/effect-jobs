import { DurableObject } from "cloudflare:workers"
import {
  Match,
  Context,
  Data,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Schema,
  SchemaGetter
} from "effect"
import * as Job from "../../../src/Job.js"
import type { EnqueueResult } from "../../../src/JobContract.js"
import * as JobPolicy from "../../../src/JobPolicy.js"
import * as JobProducer from "../../../src/JobProducer.js"
import * as JobQueue from "../../../src/JobQueue.js"
import { ddl as jobsDdl } from "../../../src/internal/do-sqlite/Storage.js"
import { withTransaction } from "../../../src/internal/do-sqlite/Transaction.js"

class Encoding extends Context.Service<
  Encoding,
  {
    readonly prefix: string
    readonly suspend: Effect.Effect<void>
  }
>()("qualification/do-sqlite/Encoding") {}

class FixtureRejected extends Data.TaggedError("FixtureRejected")<{}> {}

const responseBudgetMillis = 250
const forcedAbortReason = "qualification-forced-abort"
const injectedDefect = new Error("qualification-defect")
const Mutation = Schema.Literals([
  "commit",
  "duplicate",
  "payload-write-failure",
  "incompatible",
  "incompatible-caught",
  "typed",
  "defect",
  "conflict",
  "interrupt",
  "interrupt-after-writes",
  "forced-abort",
  "negative-control"
])
const isMutation = Schema.is(Mutation)

const payload = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    encode: SchemaGetter.transformEffect((value) =>
      Effect.gen(function* () {
        const encoding = yield* Encoding
        yield* encoding.suspend
        return encoding.prefix + value
      })
    ),
    decode: SchemaGetter.transform((value) => value.slice("wire:".length))
  })
)

const producer = Effect.runSync(
  Effect.gen(function* () {
    const queue = yield* JobQueue.make("qualification")
    const job = yield* Job.make({ name: "invoice.generate", payload })
    return yield* JobProducer.make("invoice.issue").pipe(
      JobProducer.withSlot("generate", job, { queue })
    )
  })
)

const ddl = `
  CREATE TABLE IF NOT EXISTS domain (
    operation_id TEXT PRIMARY KEY, value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS receipts (
    operation_id TEXT PRIMARY KEY REFERENCES domain(operation_id),
    job_id TEXT NOT NULL REFERENCES jobs(jobId), body TEXT NOT NULL
  );
`

const describeExit = <A, E extends { readonly _tag: string }>(exit: Exit.Exit<A, E>) => {
  if (Exit.isSuccess(exit)) {
    return { outcome: "Success" }
  }
  return {
    outcome: "Failure",
    reasons: exit.cause.reasons.map((reason) =>
      Match.value(reason).pipe(
        Match.tagsExhaustive({
          Fail: (failure) => ({ channel: "Fail", tag: failure.error._tag }),
          Die: (failure) => ({
            channel: "Die",
            expected: failure.defect === injectedDefect
          }),
          Interrupt: () => ({ channel: "Interrupt" })
        })
      )
    )
  }
}

interface Bindings {
  readonly STORE: DurableObjectNamespace<Store>
  readonly OBSERVE: Fetcher
}

const observe = async (observer: Fetcher, phase: string, details: object = {}) => {
  const response = await observer.fetch("http://observer.local/" + phase, {
    method: "POST",
    body: JSON.stringify(details)
  })
  if (!response.ok) {
    throw new Error("fixture observer rejected " + phase)
  }
}

export class Store extends DurableObject<Bindings> {
  readonly epoch = crypto.randomUUID()
  readonly events: string[] = []

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env)
    // The fixture application owns schema setup.
    ctx.storage.sql.exec(jobsDdl + ddl)
  }

  snapshot() {
    const sql = this.ctx.storage.sql
    return Response.json({
      epoch: this.epoch,
      events: this.events,
      domain: sql.exec("SELECT * FROM domain ORDER BY operation_id").toArray(),
      jobs: sql
        .exec(
          "SELECT jobId AS id, operation, operationId AS operation_id, slot, queue, name, version FROM jobs ORDER BY jobId"
        )
        .toArray(),
      payloads: sql
        .exec(
          "SELECT jobId AS job_id, formatVersion AS format, hex(payload) AS bytes, hex(projection) AS projection FROM payloads ORDER BY jobId"
        )
        .toArray(),
      receipts: sql.exec("SELECT * FROM receipts ORDER BY operation_id").toArray()
    })
  }

  async mutate(mode: typeof Mutation.Type, operationId: string, holdBarrier: boolean) {
    const native = this.ctx.storage
    const sql = native.sql
    const traceStart = this.events.length
    const record = (event: string) => {
      this.events.push(event)
    }

    // Observe the real native callback and settlement. Invoke all native APIs on
    // their original receiver so the wrapper cannot alter the storage semantics.
    const transaction = async <A,>(body: () => Promise<A>) => {
      record("native-start")
      try {
        const value = await native.transaction(async (txn) => {
          record("native-callback")
          const value = await body()
          if (mode === "negative-control") {
            txn.rollback()
            record("negative-native-rollback")
          }
          return value
        })
        record("native-fulfilled")
        return value
      } catch (error) {
        record("native-rejected")
        throw error
      }
    }
    const storage = {
      transaction,
      sql: {
        exec<Row extends Record<string, SqlStorageValue>>(
          query: string,
          ...bindings: unknown[]
        ) {
          if (
            mode === "payload-write-failure" &&
            query.startsWith("INSERT INTO payloads")
          ) {
            // Fail after the library has written the job, through native SQLite.
            return sql.exec<Row>("INSERT INTO payloads (jobId) VALUES (?)", bindings[0])
          }
          const cursor = sql.exec<Row>(query, ...bindings)
          if (query.startsWith("INSERT INTO jobs")) {
            record("job-written")
          }
          if (query.startsWith("INSERT INTO payloads")) {
            record("payload-written")
          }
          return cursor
        }
      }
    }

    const input = { operationId, slot: "generate", payload: "invoice-42" } as const
    const codecEntered = Deferred.makeUnsafe<void>()
    const encoding = {
      prefix: "wire:",
      suspend: Effect.callback<void>((resume) => {
        record("codec-entered")
        queueMicrotask(() => {
          if (mode === "interrupt") {
            Deferred.doneUnsafe(codecEntered, Effect.void)
          } else {
            record("codec-resumed")
            resume(Effect.void)
          }
        })
        record("codec-suspended")
        return Effect.sync(() => record("codec-cancelled"))
      }).pipe(Effect.ensuring(Effect.sync(() => record("codec-exited"))))
    }
    const provideEncoding = Effect.provideService(Encoding, encoding)
    type Escaped = Effect.Effect<unknown, { readonly _tag: string }>
    let escapedDomain: Escaped | undefined
    let escapedEnqueue:
      | Effect.Effect<EnqueueResult, { readonly _tag: string }>
      | undefined

    const operation = withTransaction(storage, responseBudgetMillis, (tx, write) =>
      Effect.gen({ self: this }, function* () {
        record("effect-callback")
        const enqueue = producer.enqueueInTransaction(tx, input)
        escapedEnqueue = producer
          .enqueueInTransaction(tx, {
            ...input,
            operationId: operationId + "-escaped"
          })
          .pipe(provideEncoding)

        escapedDomain = write((sql) =>
          sql.exec(
            "INSERT INTO domain VALUES (?, ?)",
            operationId + "-escaped",
            "escaped"
          )
        )
        if (mode === "duplicate") {
          return JSON.stringify({ operationId, result: yield* enqueue })
        }
        yield* write((sql) =>
          sql.exec("INSERT INTO domain VALUES (?, ?)", operationId, "issued")
        )
        record("domain-written")
        if (mode === "payload-write-failure") {
          yield* enqueue.pipe(
            Effect.catchTags({
              SqliteWriteFailed: () =>
                Effect.sync(() => record("payload-write-failure-caught"))
            })
          )
          return "caught"
        }
        const result = yield* enqueue
        const body = JSON.stringify({ operationId, result })
        yield* write((sql) =>
          sql.exec(
            "INSERT INTO receipts VALUES (?, ?, ?)",
            operationId,
            result.jobId,
            body
          )
        )
        record("receipt-written")

        if (mode === "incompatible" || mode === "incompatible-caught") {
          const policy = yield* JobPolicy.make({
            leaseDuration: Duration.millis(200),
            attemptTimeout: Duration.millis(100)
          })
          const incompatible = producer.enqueueInTransaction(tx, {
            ...input,
            operationId: operationId + "-incompatible",
            policy
          })
          if (mode === "incompatible") {
            yield* incompatible
          } else {
            yield* incompatible.pipe(
              Effect.catchTags({
                JobPolicyIncompatible: () =>
                  Effect.sync(() => record("incompatible-caught"))
              })
            )
            yield* write((sql) =>
              sql.exec(
                "UPDATE domain SET value = ? WHERE operation_id = ?",
                "issued",
                operationId
              )
            )
            record("domain-write-after-rejection")
          }
        }

        if (mode === "interrupt-after-writes") {
          Deferred.doneUnsafe(codecEntered, Effect.void)
          return yield* Effect.never
        }
        if (mode === "typed") {
          return yield* new FixtureRejected()
        }
        if (mode === "defect") {
          return yield* Effect.die(injectedDefect)
        }
        if (mode === "conflict") {
          yield* producer
            .enqueueInTransaction(tx, { ...input, payload: "different" })
            .pipe(
              Effect.catchTags({
                JobIntegrityConflict: () => Effect.sync(() => record("conflict-caught"))
              })
            )
          yield* escapedDomain.pipe(
            Effect.catchTags({
              JobIntegrityConflict: () =>
                Effect.sync(() => record("conflict-write-rejected"))
            })
          )
          record("conflict-body-returning")
        }
        if (mode === "forced-abort") {
          const rows = sql
            .exec(
              `SELECT
                  (SELECT count(*) FROM domain WHERE operation_id = ?) AS domain,
                  (SELECT count(*) FROM jobs WHERE operationId = ?) AS jobs,
                  (SELECT count(*) FROM payloads WHERE jobId = ?) AS payloads,
                  (SELECT count(*) FROM receipts WHERE operation_id = ?) AS receipts`,
              operationId,
              operationId,
              result.jobId,
              operationId
            )
            .one()
          yield* Effect.promise(() =>
            observe(this.env.OBSERVE, "abort-after-writes", {
              operationId,
              epoch: this.epoch,
              rows,
              trace: this.events.slice(traceStart)
            })
          )
          this.ctx.abort(forcedAbortReason)
          return yield* Effect.die(new Error("native abort returned"))
        }
        return body
      }).pipe(Effect.ensuring(Effect.sync(() => record("owner-closed"))))
    ).pipe(provideEncoding)

    const exit = await Effect.runPromiseExit(
      mode === "interrupt" || mode === "interrupt-after-writes"
        ? Effect.scoped(
            Effect.gen(function* () {
              const owner = yield* Effect.forkScoped(operation)
              yield* Deferred.await(codecEntered)
              record("interrupt-requested")
              yield* Fiber.interrupt(owner)
              record("interrupt-joined")
              return yield* Fiber.join(owner)
            })
          )
        : operation
    )

    // These are real attempts to use retained authority after native settlement.
    if (!escapedEnqueue || !escapedDomain) {
      throw new Error("owner never exposed an enqueue capability")
    }
    const escaped = {
      enqueue: describeExit(await Effect.runPromiseExit(escapedEnqueue)),
      domain: describeExit(await Effect.runPromiseExit(escapedDomain))
    }
    if (Exit.isFailure(exit)) {
      return Response.json({ ...describeExit(exit), escaped })
    }

    const sync = async () => {
      record("sync-start")
      const pending = native.sync()
      if (holdBarrier) {
        await Promise.all([pending, observe(this.env.OBSERVE, "sync-entered")])
      } else {
        await pending
      }
      record("sync-complete")
    }
    await sync()
    const response = Response.json(
      { ...describeExit(exit), escaped, receipt: JSON.parse(exit.value) },
      {
        headers: { "x-fixture-barrier": "complete" }
      }
    )
    if (holdBarrier) {
      // Capture the phase at construction, before the output gate can delay delivery.
      await observe(this.env.OBSERVE, "response-created", {
        trace: this.events.slice(traceStart)
      })
    }
    return response
  }

  override async fetch(request: Request) {
    const url = new URL(request.url)
    const operationId = url.searchParams.get("operation") ?? "issue-42"
    const mode = url.pathname.slice(1)
    if (mode === "state" && request.method === "GET") {
      return this.snapshot()
    }
    if (mode === "receipt" && request.method === "GET") {
      const row = this.ctx.storage.sql
        .exec<{ body: string }>(
          "SELECT body FROM receipts WHERE operation_id = ?",
          operationId
        )
        .toArray()[0]
      return row
        ? new Response(row.body, { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 404 })
    }
    if (request.method !== "POST") {
      return new Response(null, { status: 405 })
    }
    if (!isMutation(mode)) {
      return new Response(null, { status: 404 })
    }
    return await this.mutate(mode, operationId, url.searchParams.has("hold-barrier"))
  }
}

export default {
  async fetch(request: Request, env: Bindings) {
    const url = new URL(request.url)
    const stub = env.STORE.getByName(
      url.searchParams.get("object") ?? "app-owned-storage"
    )
    if (url.pathname === "/lose-response") {
      url.pathname = "/commit"
      const original = await stub.fetch(new Request(url, request))
      if (!original.ok || original.headers.get("x-fixture-barrier") !== "complete") {
        throw new Error("cannot inject response loss before durable completion")
      }
      const reply = await original.json<{ receipt: unknown }>()
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(reply.receipt))
      )
      const unknown = Response.json(
        { outcome: "Unknown" },
        {
          status: 503,
          // Only the harness receives this witness, never the original receipt.
          headers: {
            "x-fixture-ack-sha256": btoa(String.fromCharCode(...new Uint8Array(digest)))
          }
        }
      )
      if (url.searchParams.has("hold-barrier")) {
        await observe(env.OBSERVE, "unknown-injected")
      }
      return unknown
    }
    try {
      return await stub.fetch(request)
    } catch (error) {
      if (url.pathname === "/forced-abort" && String(error).includes(forcedAbortReason)) {
        return Response.json({ outcome: "NativeAbortObserved" }, { status: 503 })
      }
      throw error
    }
  }
}
