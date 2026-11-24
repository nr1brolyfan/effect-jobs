import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { performance } from "node:perf_hooks"
import { build } from "esbuild"
import { convertV4MiniflareOptions, Miniflare } from "miniflare"

const fixture = import.meta.dirname
const packedConsumer = process.env.JOBS_DO_SQLITE_PACKED_CONSUMER
const workerRoot = packedConsumer ?? fixture
const require = createRequire(import.meta.url)
const requireFromMiniflare = createRequire(require.resolve("miniflare"))
const workerd = requireFromMiniflare("workerd")
const compatibilityDate = "2026-10-01"
const deadlineMs = 3000

assert.equal(
  process.env.MINIFLARE_WORKERD_PATH,
  undefined,
  "use Miniflare's locked workerd"
)
assert.equal(workerd.version, "1.20261006.1")
const workerdVersion = execFileSync(workerd.default, ["--version"], {
  encoding: "utf8",
  timeout: deadlineMs
}).trim()
assert.match(workerdVersion, /\b2026-10-06\b/)
const version = (name) =>
  JSON.parse(readFileSync(join(fixture, "node_modules", name, "package.json"), "utf8"))
    .version
const pins = {
  node: process.version,
  effect: JSON.parse(
    readFileSync(join(workerRoot, "node_modules/effect/package.json"), "utf8")
  ).version,
  miniflare: version("miniflare"),
  alchemy: version("alchemy"),
  alchemyCloudflare: version("@alchemy.run/cloudflare"),
  workerd: workerd.version,
  workerdVersion,
  compatibilityDate
}
assert.equal(pins.effect, "4.1.3")
assert.equal(pins.miniflare, "5.20261006.1-alpha")
assert.equal(pins.alchemy, "2.0.0-beta.85")
assert.equal(pins.alchemyCloudflare, "2.0.0-beta.85")

const bundle = await build({
  absWorkingDir: workerRoot,
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
        // Product source lives above the fixture. Give it the same Effect instance
        // as the fixture.
        builder.onResolve({ filter: /^effect(?:\/|$)/ }, (args) =>
          args.pluginData === "fixture-effect"
            ? undefined
            : builder.resolve(args.path, {
                resolveDir: workerRoot,
                kind: args.kind,
                pluginData: "fixture-effect"
              })
        )
      }
    }
  ]
})
const inputs = Object.keys(bundle.metafile.inputs)
assert.ok(
  inputs.every(
    (path) =>
      !path.includes("node_modules/alchemy/") &&
      !path.includes("node_modules/@alchemy.run/")
  )
)
if (packedConsumer !== undefined) {
  assert.ok(
    inputs.includes("node_modules/effect-jobs/dist/internal/do-sqlite/Transaction.js")
  )
  assert.ok(
    inputs.includes("node_modules/effect-jobs/dist/internal/do-sqlite/Storage.js")
  )
  assert.ok(
    inputs.every(
      (path) =>
        path === "Worker.mts" ||
        path.startsWith("node_modules/effect-jobs/dist/") ||
        path.startsWith("node_modules/effect/")
    )
  )
}
const effectInputs = inputs.filter((path) => /(?:^|\/)node_modules\/effect\//.test(path))
assert.ok(effectInputs.length > 0)
assert.ok(effectInputs.every((path) => path.startsWith("node_modules/effect/")))
const script = bundle.outputFiles[0].text
const sha256 = (data) => createHash("sha256").update(data).digest("hex")
console.log(
  JSON.stringify({
    ...pins,
    worker: packedConsumer === undefined ? "source" : "installed archive",
    bundleSha256: sha256(script),
    workerdBinarySha256: sha256(await readFile(workerd.default)),
    effectModules: effectInputs.length,
    deadlineMs
  })
)

const workerOptions = {
  name: "qualification-do-sqlite",
  modules: true,
  script,
  compatibilityDate,
  durableObjects: { STORE: { className: "Store", useSQLite: true } },
  cf: false
}

const withDeadline = async (description, operation) => {
  let timer
  try {
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${description} exceeded ${deadlineMs} ms`)),
        deadlineMs
      )
    })
    return await Promise.race([operation, deadline])
  } finally {
    clearTimeout(timer)
  }
}

const withStore = async (run) => {
  const resourcePersistencePath = await mkdtemp(join(tmpdir(), "jobs-do-sqlite-"))
  let runtime
  const observations = []
  const entered = Promise.withResolvers()
  const release = Promise.withResolvers()
  const observer = async (request) => {
    const phase = new URL(request.url).pathname.slice(1)
    observations.push({ phase, ...(await request.json()) })
    if (phase === "sync-entered") {
      entered.resolve()
      await release.promise
    }
    return new Response(null, { status: 204 })
  }
  const stop = async () => {
    const current = runtime
    runtime = undefined
    if (current) {
      await withDeadline("workerd disposal", current.dispose())
    }
  }
  const restart = async () => {
    await stop()
    runtime = new Miniflare({
      ...convertV4MiniflareOptions({
        ...workerOptions,
        serviceBindings: { OBSERVE: observer }
      }),
      resourcePersistencePath
    })
    await withDeadline("workerd startup", runtime.ready)
  }
  const call = (path, { status = 200, method = "GET" } = {}) =>
    withDeadline(
      path,
      (async () => {
        const response = await runtime.dispatchFetch(
          "http://qualification.local" + path,
          {
            method,
            signal: AbortSignal.timeout(deadlineMs)
          }
        )
        const body = await response.text()
        assert.equal(response.status, status, body)
        return { body, headers: response.headers }
      })()
    )
  try {
    await restart()
    await run({
      state: async (query = "") => JSON.parse((await call("/state" + query)).body),
      mutate: async (mode, status, operation = "issue-42") =>
        JSON.parse(
          (await call(`/${mode}?operation=${operation}`, { status, method: "POST" })).body
        ),
      loseResponse: (query = "") =>
        call("/lose-response" + query, { status: 503, method: "POST" }),
      observations,
      barrierEntered: entered.promise,
      releaseBarrier: () => {
        observations.push({ phase: "sync-released" })
        release.resolve()
      },
      receipt: async (query, status) =>
        (await call("/receipt?" + query, { status })).body,
      restart
    })
  } finally {
    try {
      await stop()
    } finally {
      await rm(resourcePersistencePath, { recursive: true, force: true })
    }
  }
}

const failure = (channel, details = {}) => ({
  outcome: "Failure",
  reasons: [{ channel, ...details }]
})
const escaped = {
  enqueue: failure("Fail", { tag: "JobsTransactionClosed" }),
  domain: failure("Fail", { tag: "SqliteTransactionClosed" })
}
const allWrites = ["domain-written", "job-written", "payload-written", "receipt-written"]
const begin = [
  "native-start",
  "native-callback",
  "effect-callback",
  "domain-written",
  "codec-entered"
]
const codec = ["codec-suspended", "codec-resumed", "codec-exited"]
const closed = ["owner-closed", "native-rejected"]
const committed = ["owner-closed", "native-fulfilled", "sync-start", "sync-complete"]
const bodyWritten = [...begin, ...codec, ...allWrites.slice(1)]

const assertEmpty = (state) => {
  assert.deepEqual(state.domain, [])
  assert.deepEqual(state.jobs, [])
  assert.deepEqual(state.payloads, [])
  assert.deepEqual(state.receipts, [])
}

const encodeHex = (value) =>
  Buffer.from(JSON.stringify(value)).toString("hex").toUpperCase()
const assertCommitted = (state, receipt) => {
  assert.equal(receipt.operationId, "issue-42")
  assert.equal(receipt.result._tag, "Inserted")
  const id = receipt.result.jobId
  assert.match(id, /^[0-9a-f-]{36}$/)
  assert.deepEqual(
    state.domain,
    [{ operation_id: "issue-42", value: "issued" }],
    "domain commit"
  )
  assert.deepEqual(state.jobs, [
    {
      id,
      operation: "invoice.issue",
      operation_id: "issue-42",
      slot: "generate",
      queue: "qualification",
      name: "invoice.generate",
      version: 1
    }
  ])
  assert.deepEqual(state.payloads, [
    {
      job_id: id,
      format: 1,
      bytes: encodeHex("wire:invoice-42"),
      projection: encodeHex({ data: "wire:invoice-42", protected: {} })
    }
  ])
  assert.deepEqual(state.receipts, [
    {
      operation_id: "issue-42",
      job_id: id,
      body: JSON.stringify(receipt)
    }
  ])
}

test("commit uses a real suspended Context codec and closes both write capabilities", () =>
  withStore(async ({ mutate, state, receipt }) => {
    const result = await mutate("commit")
    assert.deepEqual(result, { outcome: "Success", escaped, receipt: result.receipt })
    const rows = await state()
    assert.deepEqual(rows.events, [...bodyWritten, ...committed])
    assertCommitted(rows, result.receipt)
    assert.equal(await receipt("operation=issue-42"), JSON.stringify(result.receipt))
    assertEmpty(await state("?object=separate-store"))
  }))

test("an equal enqueue compares the stored bytes and preserves all four rows", () =>
  withStore(async ({ mutate, state }) => {
    const result = await mutate("commit")
    const duplicate = await mutate("duplicate")
    assert.deepEqual(duplicate, {
      outcome: "Success",
      escaped,
      receipt: {
        operationId: "issue-42",
        result: {
          _tag: "AlreadyPresent",
          jobId: result.receipt.result.jobId
        }
      }
    })
    assertCommitted(await state(), result.receipt)
  }))

/** @type {Array<[string, ReturnType<typeof failure>, string[]]>} */
const rollbackCases = [
  [
    "payload-write-failure",
    failure("Fail", { tag: "SqliteWriteFailed" }),
    [...begin, ...codec, "job-written", "payload-write-failure-caught", ...closed]
  ],
  [
    "interrupt-after-writes",
    failure("Interrupt"),
    [...bodyWritten, "interrupt-requested", ...closed, "interrupt-joined"]
  ],
  ["typed", failure("Fail", { tag: "FixtureRejected" }), [...bodyWritten, ...closed]],
  ["defect", failure("Die", { expected: true }), [...bodyWritten, ...closed]],
  [
    "conflict",
    failure("Fail", { tag: "JobIntegrityConflict" }),
    [
      ...bodyWritten,
      "codec-entered",
      ...codec,
      "conflict-caught",
      "conflict-write-rejected",
      "conflict-body-returning",
      ...closed
    ]
  ],
  [
    "interrupt",
    failure("Interrupt"),
    [
      ...begin,
      "codec-suspended",
      "interrupt-requested",
      "codec-cancelled",
      "codec-exited",
      ...closed,
      "interrupt-joined"
    ]
  ]
]
for (const [mode, result, events] of rollbackCases) {
  test(`${mode} rolls back and rejects escaped writes`, (t) =>
    withStore(async ({ mutate, state, receipt }) => {
      const start = performance.now()
      const response = await mutate(mode)
      const elapsedMs = Math.round(performance.now() - start)
      assert.ok(
        elapsedMs < deadlineMs,
        "mutation must settle within the request deadline"
      )
      t.diagnostic(`transaction request settled in ${elapsedMs} ms`)
      assert.deepEqual(response, { ...result, escaped })
      const rows = await state()
      assert.deepEqual(rows.events, events)
      assertEmpty(rows)
      assert.equal(await receipt("operation=issue-42", 404), "")
    }))
}

test("the commit oracle rejects a fulfilled transaction that always rolls back", () =>
  withStore(async ({ mutate, state, receipt }) => {
    const result = await mutate("negative-control")
    assert.deepEqual(result, { outcome: "Success", escaped, receipt: result.receipt })
    const rows = await state()
    assert.deepEqual(rows.events, [
      ...bodyWritten,
      "owner-closed",
      "negative-native-rollback",
      ...committed.slice(1)
    ])
    assert.throws(() => assertCommitted(rows, result.receipt), {
      code: "ERR_ASSERTION",
      message: /^domain commit/
    })
    assertEmpty(rows)
    assert.equal(await receipt("operation=issue-42", 404), "")
  }))

test("loss after the native barrier reconciles by operation ID through restart", () =>
  withStore(async ({ loseResponse, state, receipt, restart }) => {
    const lost = await loseResponse()
    assert.deepEqual(JSON.parse(lost.body), { outcome: "Unknown" })
    const original = await receipt("operation=issue-42")
    assert.equal(
      createHash("sha256").update(original).digest("base64"),
      lost.headers.get("x-fixture-ack-sha256")
    )
    const rows = await state()
    assert.deepEqual(rows.events, [...bodyWritten, ...committed])
    assertCommitted(rows, JSON.parse(original))
    assert.equal(await receipt("operation=unrelated", 404), "")
    assert.deepEqual(await state(), rows)

    await restart()
    const restarted = await state()
    assert.notEqual(restarted.epoch, rows.epoch)
    assert.deepEqual(restarted.events, [])
    assertCommitted(restarted, JSON.parse(original))
    assert.equal(await receipt("operation=issue-42"), original)
    assert.deepEqual(await state(), restarted)
  }))

test("the DO creates its lost response only after the held sync settles", () =>
  withStore(async (store) => {
    const lost = store.loseResponse("?hold-barrier")
    try {
      await withDeadline(
        "sync entry",
        Promise.race([
          store.barrierEntered,
          lost.then(() => {
            throw new Error("loss response preceded sync entry")
          })
        ])
      )
    } finally {
      store.releaseBarrier()
    }
    assert.deepEqual(JSON.parse((await lost).body), { outcome: "Unknown" })
    assert.deepEqual(
      store.observations,
      [
        { phase: "sync-entered" },
        { phase: "sync-released" },
        { phase: "response-created", trace: [...bodyWritten, ...committed] },
        { phase: "unknown-injected" }
      ],
      "barrier order: the DO must construct the response after sync settles"
    )
  }))

test("forced DO abort resets the object and discards the open transaction", () =>
  withStore(async ({ mutate, state, receipt, observations }) => {
    const baseline = await mutate("commit")
    const before = await state()
    assertCommitted(before, baseline.receipt)
    assert.deepEqual(await mutate("forced-abort", 503, "aborted-operation"), {
      outcome: "NativeAbortObserved"
    })
    const after = await state()
    assert.notEqual(after.epoch, before.epoch)
    assert.deepEqual(after.events, [])
    assert.deepEqual(
      observations,
      [
        {
          phase: "abort-after-writes",
          operationId: "aborted-operation",
          epoch: before.epoch,
          rows: { domain: 1, jobs: 1, payloads: 1, receipts: 1 },
          trace: bodyWritten
        }
      ],
      "abort phase: one witness from the open native callback after all four writes"
    )
    assertCommitted(after, baseline.receipt)
    assert.equal(await receipt("operation=aborted-operation", 404), "")
    assert.equal(await receipt("operation=issue-42"), JSON.stringify(baseline.receipt))
  }))
