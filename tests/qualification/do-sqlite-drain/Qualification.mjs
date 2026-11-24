import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

// Use the atomicity harness's existing npm installation and lockfile.
const harness = new URL("../do-sqlite-atomicity/", import.meta.url)
const require = createRequire(new URL("Atomicity.mjs", harness))
const { build } = require("esbuild")
const { Miniflare, convertV4MiniflareOptions } = require("miniflare")
const { default: workerdBinary, version: workerd } = createRequire(
  require.resolve("miniflare")
)("workerd")

const compatibilityDate = "2026-10-01"
const deadlineMs = 5000
const version = (name) =>
  JSON.parse(readFileSync(new URL(`node_modules/${name}/package.json`, harness), "utf8"))
    .version
const pins = {
  esbuild: version("esbuild"),
  effect: version("effect"),
  alchemy: version("alchemy"),
  alchemyCloudflare: version("@alchemy.run/cloudflare"),
  miniflare: version("miniflare"),
  workerd
}
assert.deepEqual(pins, {
  esbuild: "0.28.2",
  effect: "4.1.3",
  alchemy: "2.0.0-beta.85",
  alchemyCloudflare: "2.0.0-beta.85",
  miniflare: "5.20261006.1-alpha",
  workerd: "1.20261006.1"
})
assert.equal(process.env.MINIFLARE_WORKERD_PATH, undefined)
const workerdVersion = execFileSync(workerdBinary, ["--version"], {
  encoding: "utf8",
  timeout: deadlineMs
}).trim()
assert.match(workerdVersion, /\b2026-10-06\b/)

const bundle = await build({
  absWorkingDir: import.meta.dirname,
  entryPoints: ["Worker.mts"],
  bundle: true,
  write: false,
  metafile: true,
  format: "esm",
  target: "es2022",
  external: ["cloudflare:workers"],
  plugins: [
    {
      name: "fixture-effect",
      setup(builder) {
        builder.onResolve({ filter: /^effect(?:\/|$)/ }, (args) => ({
          path: require.resolve(args.path)
        }))
      }
    }
  ]
})
const effectModules = Object.keys(bundle.metafile.inputs).filter((path) =>
  /(?:^|\/)node_modules\/effect\//.test(path)
)
assert.ok(effectModules.length > 0)
assert.ok(
  effectModules.every((path) =>
    path.startsWith("../do-sqlite-atomicity/node_modules/effect/")
  )
)
const script = bundle.outputFiles[0].text
const sha256 = (data) => createHash("sha256").update(data).digest("hex")
console.log(
  JSON.stringify({
    ...pins,
    node: process.version,
    compatibilityDate,
    deadlineMs,
    workerdVersion,
    workerdBinarySha256: sha256(await readFile(workerdBinary)),
    harnessLockSha256: sha256(await readFile(new URL("package-lock.json", harness))),
    bundleSha256: sha256(script),
    effectModules: effectModules.length
  })
)

const bounded = async (label, operation) => {
  let timer
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), deadlineMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

const withJobs = async (run) => {
  const resourcePersistencePath = await mkdtemp(join(tmpdir(), "jobs-do-sqlite-drain-"))
  let runtime
  const stop = async () => {
    if (runtime !== undefined) {
      await bounded("workerd disposal", runtime.dispose())
      runtime = undefined
    }
  }
  const restart = async () => {
    await stop()
    runtime = new Miniflare({
      ...convertV4MiniflareOptions({
        name: "qualification-do-sqlite-drain",
        modules: true,
        script,
        compatibilityDate,
        durableObjects: { JOBS: { className: "Jobs", useSQLite: true } },
        cf: false
      }),
      resourcePersistencePath
    })
    await bounded("workerd startup", runtime.ready)
  }
  const request = (method, path, body) =>
    bounded(
      path,
      (async () => {
        const response = await runtime.dispatchFetch(
          "http://qualification.local" + path,
          {
            method,
            signal: AbortSignal.timeout(deadlineMs),
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
          }
        )
        const text = await response.text()
        assert.equal(response.status, 200, text)
        return JSON.parse(text)
      })()
    )

  try {
    await restart()
    await run({ request, restart })
  } finally {
    try {
      await stop()
    } finally {
      await bounded(
        "temporary storage cleanup",
        rm(resourcePersistencePath, { recursive: true, force: true })
      )
    }
  }
}

test("one explicit source drain delivers and finalizes a DO SQLite job", async (t) => {
  await withJobs(async ({ request, restart }) => {
    const payload = { invoiceId: "fixture-invoice", amountCents: 4200 }
    const operationId = "deliver-fixture-invoice"
    const state = () => request("GET", "/state")

    const empty = await state()
    assert.deepEqual(empty.jobs, [])
    assert.deepEqual(empty.entries, [])
    assert.deepEqual(empty.deliveries, [])
    assert.deepEqual(empty.scopes, { acquired: 0, released: 0 })
    assert.equal(empty.drains, 0)

    const { _tag, jobId } = await request("POST", "/enqueue", { operationId, payload })
    assert.equal(_tag, "Inserted")
    assert.equal(typeof jobId, "string")
    const pending = await state()
    const [
      { state: pendingState, finalizedAttempts, finalizationReceipt, jobId: storedId }
    ] = pending.jobs
    assert.equal(pending.jobs.length, 1)
    assert.deepEqual(
      [pendingState, finalizedAttempts, finalizationReceipt, storedId],
      ["Pending", 0, null, jobId]
    )
    assert.deepEqual(pending, { ...empty, jobs: pending.jobs })

    assert.equal(await request("POST", "/assemble"), "assembled")
    const assembled = await state()
    assert.deepEqual(assembled, { ...pending, scopes: { acquired: 1, released: 1 } })

    const drained = await request("POST", "/drain")
    assert.deepEqual(drained, { _tag: "MoreWork", claimed: 1, recovered: 0 })
    const after = await state()
    assert.equal(after.objectId, empty.objectId)
    assert.equal(after.epoch, empty.epoch)
    assert.equal(after.drains, 1)
    assert.deepEqual(after.scopes, { acquired: 2, released: 2 })

    await t.test("observes actual handler entry and its application write", () => {
      assert.deepEqual(
        after.entries,
        [
          {
            payload,
            context: {
              jobId,
              catalog: { queue: "invoices", name: "invoice.deliver", version: 1 },
              producer: { operation: "invoice.issue", operationId, slot: "deliver" },
              nextFinalizationNumber: 1
            }
          }
        ],
        "expected exactly one actual handler entry with the decoded payload"
      )
      assert.deepEqual(after.deliveries, [
        {
          jobId,
          ...payload,
          confirmation: "delivered:fixture-invoice:4200"
        }
      ])
    })

    await t.test("reads independent durable finalization evidence", () => {
      assert.equal(after.jobs.length, 1)
      const [job] = after.jobs
      assert.equal(job.jobId, jobId)
      assert.equal(job.state, "Completed", "expected persisted Completed state")
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
    })

    await restart()
    const reopened = await state()
    assert.notEqual(reopened.epoch, after.epoch)
    assert.deepEqual(reopened, {
      ...after,
      epoch: reopened.epoch,
      entries: [],
      drains: 0,
      scopes: { acquired: 0, released: 0 }
    })
    t.diagnostic(
      JSON.stringify({
        objectId: after.objectId,
        beforeRestart: after.epoch,
        afterRestart: reopened.epoch,
        handlerEntries: [
          pending.entries.length,
          assembled.entries.length,
          after.entries.length,
          reopened.entries.length
        ],
        deliveries: [
          pending.deliveries.length,
          assembled.deliveries.length,
          after.deliveries.length,
          reopened.deliveries.length
        ],
        finalizedAttempts: [
          pending.jobs[0].finalizedAttempts,
          assembled.jobs[0].finalizedAttempts,
          after.jobs[0].finalizedAttempts,
          reopened.jobs[0].finalizedAttempts
        ],
        drains: [pending.drains, assembled.drains, after.drains, reopened.drains]
      })
    )
  })
})
