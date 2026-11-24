import assert from "node:assert/strict"
import { once } from "node:events"
import { existsSync, readdirSync } from "node:fs"
import { createConnection } from "node:net"
import { join } from "node:path"
import { Effect } from "effect"
import type { InvoiceJobs } from "./Worker.mjs"

const root = process.env.JOBS_QUALIFICATION_ROOT
assert.equal(
  process.env.ALCHEMY_TEST_DEV,
  "true",
  "refusing to initialize Alchemy outside local mode"
)
assert.equal(process.env.CI, "true")
assert.equal(process.env.ALCHEMY_TELEMETRY_DISABLED, "1")
assert.equal(root, process.cwd())
assert.equal(process.env.HOME, join(process.cwd(), "home"))
assert.equal(existsSync(join(process.cwd(), "home", ".alchemy")), false)
assert.equal(existsSync(".env"), false)
assert.equal(existsSync(".alchemy/state"), false)
assert.equal(existsSync(".alchemy/local"), false)

const Test = await import("@alchemy.run/test/Alchemy")
assert.equal(Test.resolveDev({}), true)

const [Alchemy, Cloudflare] = await Promise.all([
  import("alchemy"),
  import("@alchemy.run/cloudflare")
])

const providers = Cloudflare.providers()
const state = Alchemy.localState()
const stage = "qualification"
const { test, deploy, destroy, afterAll } = Test.make({ providers, state, stage })
const stack = Alchemy.Stack(
  "SqliteQualification",
  { providers, state },
  Effect.gen(function* () {
    const worker = yield* Cloudflare.Worker("InvoiceWorker", {
      main: join(import.meta.dirname, "Worker.mts"),
      env: {
        JOBS: Cloudflare.DurableObject<InvoiceJobs>("InvoiceJobs", { storage: "sqlite" })
      },
      compatibility: { date: "2026-10-01" },
      build: {
        input: {
          // The drain fixture's tsconfig points at declarations. Bundle the
          // executable modules, with one Effect installation for the full Worker.
          tsconfig: false,
          resolve: {
            alias: {
              effect: join(import.meta.dirname, "node_modules/effect/dist")
            }
          }
        }
      },
      dev: { host: "127.0.0.1", port: 0 }
    })
    return {
      url: worker.url,
      workerId: worker.workerId,
      namespaces: worker.durableObjectNamespaces
    }
  })
)

let deployedUrl: URL | undefined

const request = (method: "GET" | "POST", path: string, body?: unknown) =>
  Effect.tryPromise(async (signal) => {
    assert.ok(deployedUrl)
    const response = await fetch(new URL(path, deployedUrl), {
      method,
      signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      redirect: "error",
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    })
    const text = await response.text()
    assert.equal(response.status, 200, text)
    return JSON.parse(text)
  })

test(
  "deploys once and explicitly drains one native SQLite job through HTTP",
  Effect.gen(function* () {
    const deployed = yield* deploy(stack)
    assert.match(deployed.workerId, /^dev:/)
    assert.deepEqual(Object.keys(deployed.namespaces), ["InvoiceJobs"])
    assert.ok(deployed.url)
    const url = new URL(deployed.url)
    assert.equal(url.protocol, "http:")
    assert.ok(url.hostname === "localhost" || url.hostname === "127.0.0.1")
    assert.ok(url.port)
    assert.equal(url.href, `http://${url.hostname}:${url.port}/`)
    url.hostname = "127.0.0.1"
    deployedUrl = url
    assert.ok(existsSync(".alchemy/state/SqliteQualification/qualification"))
    yield* Effect.logInfo("local deployment and SQLite DO binding ready")

    const operationId = "qualification-invoice"
    const payload = { invoiceId: "fixture-invoice", amountCents: 4200 }
    const domain = [{ operationId, ...payload }]
    const empty = yield* request("GET", "/state")
    assert.deepEqual(yield* request("GET", "/domain"), [])
    assert.match(empty.objectId, /^[a-f0-9]{64}$/)
    assert.deepEqual(empty, {
      objectId: empty.objectId,
      epoch: empty.epoch,
      jobs: [],
      scopes: { acquired: 0, released: 0 },
      drains: 0,
      entries: [],
      deliveries: []
    })

    const { _tag, jobId } = yield* request("POST", "/enqueue", { operationId, payload })
    assert.equal(_tag, "Inserted")
    assert.equal(typeof jobId, "string")
    assert.deepEqual(yield* request("GET", "/domain"), domain)
    const pending = yield* request("GET", "/state")
    assert.deepEqual(pending, { ...empty, jobs: pending.jobs })
    assert.equal(pending.jobs.length, 1)
    assert.equal(pending.jobs[0].jobId, jobId)
    assert.equal(pending.jobs[0].operationId, operationId)
    assert.equal(pending.jobs[0].state, "Pending")
    assert.equal(pending.jobs[0].finalizedAttempts, 0)
    assert.equal(pending.jobs[0].finalizationReceipt, null)
    assert.equal(yield* request("POST", "/assemble"), "assembled")
    assert.deepEqual(yield* request("GET", "/state"), {
      ...pending,
      scopes: { acquired: 1, released: 1 }
    })

    assert.deepEqual(yield* request("POST", "/drain"), {
      _tag: "MoreWork",
      claimed: 1,
      recovered: 0
    })
    const after = yield* request("GET", "/state")
    assert.equal(after.objectId, empty.objectId)
    assert.equal(after.epoch, empty.epoch)
    assert.equal(after.drains, 1)
    assert.deepEqual(after.scopes, { acquired: 2, released: 2 })
    assert.deepEqual(after.entries, [
      {
        payload,
        context: {
          jobId,
          catalog: { queue: "invoices", name: "invoice.deliver", version: 1 },
          producer: { operation: "invoice.issue", operationId, slot: "deliver" },
          nextFinalizationNumber: 1
        }
      }
    ])
    assert.deepEqual(after.deliveries, [
      { jobId, ...payload, confirmation: "delivered:fixture-invoice:4200" }
    ])
    assert.equal(after.jobs.length, 1)
    const [job] = after.jobs
    assert.equal(job.jobId, jobId)
    assert.equal(job.state, "Completed")
    assert.equal(job.finalizedAttempts, 1)
    assert.equal(job.stalledCount, 0)
    assert.equal(job.lifecycleVersion, 2)
    assert.equal(job.leaseToken, null)
    assert.equal(job.leaseExpiresAt, null)
    assert.ok(Number.isInteger(job.completedAt) && job.completedAt >= job.createdAt)
    const receipt = JSON.parse(job.finalizationReceipt)
    assert.deepEqual(receipt.finalization, { _tag: "Complete" })
    assert.equal(receipt.before.state, "Active")
    assert.equal(receipt.before.jobId, jobId)
    assert.equal(receipt.before.finalizedAttempts, 0)
    assert.equal(receipt.before.lifecycleVersion, 1)
    assert.equal(receipt.ownership.jobId, jobId)
    assert.equal(receipt.ownership.leaseToken, receipt.before.leaseToken)
    assert.ok(receipt.ownership.leaseToken)
    assert.deepEqual(yield* request("GET", "/domain"), domain)
    assert.ok(
      readdirSync(".alchemy/local", { recursive: true }).some((path) =>
        path.toString().endsWith(".sqlite")
      )
    )
    yield* Effect.logInfo(
      "fresh storage, domain and Pending observed, one delivery and finalizedAttempts=1"
    )
    assert.notEqual(
      process.env.JOBS_QUALIFICATION_FAIL,
      "true",
      "intentional failure after drain"
    )
  }),
  { timeout: 30_000 }
)

afterAll(
  Effect.gen(function* () {
    yield* destroy(stack)
    assert.equal(existsSync(".alchemy/state/SqliteQualification/qualification"), false)
    const url = deployedUrl
    if (url) {
      yield* Effect.promise(async () => {
        const socket = createConnection({
          host: url.hostname,
          port: Number(url.port),
          signal: AbortSignal.timeout(2_000)
        })
        try {
          await assert.rejects(once(socket, "connect"), { code: "ECONNREFUSED" })
        } finally {
          socket.destroy()
        }
      })
    }
    yield* Effect.logInfo("destroy removed stack state and closed the HTTP listener")
  }),
  { timeout: 15_000 }
)
