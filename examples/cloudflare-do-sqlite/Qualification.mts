import assert from "node:assert/strict"
import { once } from "node:events"
import { existsSync } from "node:fs"
import { createConnection } from "node:net"
import { join } from "node:path"
import { Effect } from "effect"
import type { InvoiceJobs } from "./Worker.mjs"

assert.equal(process.env.ALCHEMY_TEST_DEV, "true", "run the local launcher")
assert.equal(process.env.ALCHEMY_TELEMETRY_DISABLED, "1")
assert.equal(process.env.HOME, join(process.cwd(), "home"))
assert.equal(existsSync(".alchemy/state"), false)
assert.equal(existsSync(".alchemy/local"), false)
assert.equal(existsSync(".env"), false)

const [Test, Alchemy, Cloudflare] = await Promise.all([
  import("@alchemy.run/test/Alchemy"),
  import("alchemy"),
  import("@alchemy.run/cloudflare")
])
assert.equal(Test.resolveDev({}), true)

const providers = Cloudflare.providers()
const state = Alchemy.localState()
const stage = "packed-example"
const { test, deploy, destroy, afterAll } = Test.make({ providers, state, stage })
const stack = Alchemy.Stack(
  "InvoiceExample",
  { providers, state },
  Effect.gen(function* () {
    return yield* Cloudflare.Worker("InvoiceWorker", {
      main: join(import.meta.dirname, "Worker.mts"),
      env: {
        INVOICES: Cloudflare.DurableObject<InvoiceJobs>("InvoiceJobs", {
          storage: "sqlite"
        })
      },
      compatibility: { date: "2026-10-01" },
      dev: { host: "127.0.0.1", port: 0 }
    })
  })
)

let listener: URL | undefined

const request = (url: URL, path: string, init?: RequestInit, status = 200) =>
  Effect.tryPromise(async (signal): Promise<unknown> => {
    const response = await fetch(new URL(path, url), {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)])
    })
    assert.equal(response.status, status)
    return response.json()
  })

test(
  "commits and rolls back invoice plus enqueue, then explicitly drains the packed job",
  Effect.gen(function* () {
    const worker = yield* deploy(stack)
    assert.match(worker.workerId, /^dev:/)
    assert.deepEqual(Object.keys(worker.durableObjectNamespaces), ["InvoiceJobs"])
    assert.ok(worker.url)
    const url = new URL(worker.url)
    assert.equal(url.protocol, "http:")
    assert.ok(url.hostname === "localhost" || url.hostname === "127.0.0.1")
    assert.ok(url.port)
    assert.equal(url.href, `http://${url.hostname}:${url.port}/`)
    url.hostname = "127.0.0.1"
    listener = url

    const invoice = { invoiceId: "sample-invoice", amountCents: 4200 }
    const inspect = (id: string) => request(url, `/inspect?operationId=${id}`)
    const issue = (operationId: string, failAfterWrites = false) =>
      request(
        url,
        "/issue",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ operationId, payload: invoice, failAfterWrites })
        },
        failAfterWrites ? 409 : 200
      )
    const drain = () => request(url, "/drain", { method: "POST" })

    const empty = { invoices: [], jobs: [], recordings: [], payloadCount: 0 }
    assert.deepEqual(yield* inspect("commit"), empty)
    const result = yield* issue("commit")
    assert.ok(
      typeof result === "object" &&
        result !== null &&
        "jobId" in result &&
        typeof result.jobId === "string" &&
        result.jobId.length > 0
    )
    const { jobId } = result
    assert.deepEqual(result, { _tag: "Inserted", jobId })
    const pending = {
      invoices: [invoice],
      jobs: [{ jobId, state: "Pending" }],
      recordings: [],
      payloadCount: 1
    }
    assert.deepEqual(yield* inspect("commit"), pending)
    yield* Effect.logInfo("independent read saw the committed invoice and pending job")

    assert.deepEqual(yield* issue("rollback", true), { _tag: "InjectedRollback" })
    assert.deepEqual(yield* inspect("rollback"), { ...empty, payloadCount: 1 })
    assert.deepEqual(yield* inspect("commit"), pending)
    yield* Effect.logInfo(
      "independent read confirmed rollback of the invoice, job and payload"
    )

    assert.deepEqual(yield* drain(), { _tag: "MoreWork", claimed: 1, recovered: 0 })
    assert.deepEqual(yield* inspect("commit"), {
      ...pending,
      jobs: [{ jobId, state: "Completed" }],
      recordings: [{ jobId, ...invoice }]
    })
    assert.deepEqual(yield* drain(), { _tag: "Idle", claimed: 0, recovered: 0 })
    yield* Effect.logInfo("one bounded drain recorded the invoice and finalized the job")
  }),
  { timeout: 30_000 }
)

afterAll(
  Effect.gen(function* () {
    yield* destroy(stack)
    assert.equal(existsSync(join(".alchemy/state/InvoiceExample", stage)), false)
    if (listener !== undefined) {
      const { hostname, port } = listener
      yield* Effect.tryPromise(async () => {
        const socket = createConnection({
          host: hostname,
          port: Number(port),
          signal: AbortSignal.timeout(2_000)
        })
        try {
          await assert.rejects(once(socket, "connect"), { code: "ECONNREFUSED" })
        } finally {
          socket.destroy()
        }
      })
    }
    yield* Effect.logInfo("destroy removed the local stack and closed the listener")
  }),
  { timeout: 15_000 }
)
