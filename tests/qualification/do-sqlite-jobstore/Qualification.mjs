import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"

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
  effect: version("effect"),
  alchemy: version("alchemy"),
  alchemyCloudflare: version("@alchemy.run/cloudflare"),
  miniflare: version("miniflare"),
  workerd
}
assert.deepEqual(pins, {
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

const workerOptions = {
  name: "qualification-do-sqlite-jobstore",
  modules: true,
  script,
  compatibilityDate,
  durableObjects: { STORE: { className: "Store", useSQLite: true } },
  cf: false
}

const bounded = (label, operation) =>
  new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`${label} timed out`)), deadlineMs)
    operation.then(resolve, reject).finally(() => clearTimeout(deadline))
  })

const withStore = async (run, observer = () => new Response(null, { status: 404 })) => {
  const resourcePersistencePath = await mkdtemp(
    join(tmpdir(), "jobs-do-sqlite-lifecycle-")
  )
  let runtime
  const stop = async () => {
    if (runtime === undefined) {
      return
    }
    const current = runtime
    runtime = undefined
    await bounded("workerd disposal", current.dispose())
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
    await bounded("workerd startup", runtime.ready)
  }
  const call = (path, body) =>
    bounded(
      path,
      (async () => {
        const response = await runtime.dispatchFetch(
          "http://qualification.local" + path,
          {
            signal: AbortSignal.timeout(deadlineMs),
            ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) })
          }
        )
        const text = await response.text()
        assert.equal(response.status, 200, text)
        return JSON.parse(text)
      })()
    )
  try {
    await restart()
    await run({ call, state: () => call("/state"), restart })
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

const seedInput = (operationId, options = {}) => ({
  operationId,
  queue: "invoices",
  artifact: "current",
  lease: "default",
  maxStalledCount: 1,
  maxFinalizedAttempts: 3,
  ...options
})
const seed = async (host, operationId, options = {}, path = "/seed") => {
  const value = await host.call(path, seedInput(operationId, options))
  assert.equal(value._tag, "Inserted")
  return value.jobId
}
const requestFor = (queue = "invoices", leaseToken = randomUUID()) => ({
  queue,
  supportedCatalog: [{ queue, name: "invoice.generate", version: 1 }],
  leaseToken
})
const claim = async (host, request) => {
  const result = await host.call("/claim", request)
  assert.equal(result._tag, "Claimed")
  return result.claim
}
const recover = (host, queue, limit) => host.call("/recover", { queue, limit })
const finalization = (claimed, command = { _tag: "Complete" }) => ({
  ownership: claimed.ownership,
  before: claimed.snapshot,
  finalization: command
})

const job = (state, id) => {
  const row = state.rows.find((row) => row.jobId === id)
  assert.ok(row, "persisted job missing")
  return row
}
const artifact = (state, id) => {
  const row = state.artifacts.find((row) => row.jobId === id)
  assert.ok(row, "persisted artifact missing")
  return row
}
const compareAscii = (left, right) => (left < right ? -1 : Number(left > right))
const persisted = ({ rows, artifacts }) => ({ rows, artifacts })
const expectTransition = (row, state, version, attempts, stalls) => {
  assert.deepEqual(
    [row.state, row.lifecycleVersion, row.finalizedAttempts, row.stalledCount],
    [state, version, attempts, stalls]
  )
  if (state !== "Active") {
    assert.equal(row.leaseToken, null)
    assert.equal(row.leaseExpiresAt, null)
  }
}
const expectedSnapshot = (row) => {
  const { maxAttempts, ...config } = JSON.parse(row.policy)
  return {
    jobId: row.jobId,
    state: row.state,
    policy: { ...config, maxFinalizedAttempts: maxAttempts },
    availableAt: row.availableAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    finalizedAttempts: row.finalizedAttempts,
    stalledCount: row.stalledCount,
    lifecycleVersion: row.lifecycleVersion,
    leaseToken: row.leaseToken,
    leaseExpiresAt: row.leaseExpiresAt,
    completedAt: row.completedAt,
    lastFailureCode: row.lastFailureCode
  }
}
const expectClaim = (claimed, request, initial, current, id) => {
  const row = job(current, id)
  const bytes = artifact(initial, id)
  assert.deepEqual(artifact(current, id), bytes)
  assert.equal(job(initial, id).policy, row.policy)
  assert.equal(row.leaseToken, request.leaseToken)
  assert.deepEqual(claimed.ownership, {
    jobId: id,
    leaseToken: request.leaseToken,
    leaseExpiresAt: row.leaseExpiresAt,
    lifecycleVersion: row.lifecycleVersion
  })
  assert.deepEqual(
    claimed.snapshot,
    expectedSnapshot(row),
    "claim must return the exact snapshot"
  )
  assert.equal(
    row.leaseExpiresAt,
    row.updatedAt + claimed.snapshot.policy.leaseDurationMillis
  )
  assert.ok(row.updatedAt >= initial.now && row.updatedAt <= current.now)
  const data = "invoice:" + row.operationId
  const expectedBytes = Buffer.from(JSON.stringify(data))
  const expectedProjection = Buffer.from(JSON.stringify({ data, protected: {} }))
  assert.equal(bytes.payload, expectedBytes.toString("hex").toUpperCase())
  assert.equal(bytes.projection, expectedProjection.toString("hex").toUpperCase())
  assert.deepEqual(
    claimed.prepared,
    {
      catalog: { queue: row.queue, name: row.name, version: row.version },
      producer: {
        operation: row.operation,
        operationId: row.operationId,
        slot: row.slot
      },
      policy: claimed.snapshot.policy,
      encoded: {
        formatVersion: 1,
        payloadBytes: [...expectedBytes],
        semanticProjectionBytes: [...expectedProjection]
      }
    },
    "claim must bind the matching immutable artifact"
  )
}

const waitForExpiry = async (host, leaseExpiresAt) => {
  const until = performance.now() + deadlineMs
  while (performance.now() < until) {
    const state = await host.state()
    if (state.now >= leaseExpiresAt) {
      return state
    }
    // Poll storage time with a bounded deadline. The timer only paces reads.
    await delay(15)
  }
  assert.fail("SQLite time did not reach the lease expiry within the deadline")
}

test("separate concurrent requests claim only one supported row and its exact artifact", () =>
  withStore(async (host) => {
    const unsupported = await seed(host, "unsupported", { artifact: "unsupported" })
    const other = await seed(host, "other-queue", { queue: "other" })
    const target = await seed(host, "contended")
    const initial = await host.state()
    const requests = [requestFor(), requestFor()]
    const results = await Promise.all(
      requests.map((request) => host.call("/claim", request))
    )
    assert.deepEqual(results.map((result) => result._tag).sort(compareAscii), [
      "Claimed",
      "Empty"
    ])
    const winner = results.findIndex((result) => result._tag === "Claimed")
    const losingToken = requests[1 - winner].leaseToken
    const current = await host.state()
    assert.equal(current.objectId, initial.objectId)
    assert.equal(current.epoch, initial.epoch)
    assert.deepEqual(current.calls, { claim: 2, finalize: 0 })
    assert.deepEqual(current.acknowledgments, { claim: 1, finalize: 0 })
    expectTransition(job(current, target), "Active", 1, 0, 0)
    expectClaim(results[winner].claim, requests[winner], initial, current, target)
    assert.deepEqual(job(current, unsupported), job(initial, unsupported))
    assert.deepEqual(job(current, other), job(initial, other))
    assert.deepEqual(current.artifacts, initial.artifacts)
    assert.deepEqual(await host.call("/reconcile-claim", losingToken), {
      _tag: "NotOwned"
    })
  }))

test("SQLite time gates queue-scoped bounded recovery, fresh claims and stale fencing", () =>
  withStore(async (host) => {
    const pending = [
      await seed(host, "expiry-a", { lease: "short" }),
      await seed(host, "expiry-b", { lease: "short" })
    ]
    const other = await seed(host, "expiry-other", { lease: "short", queue: "other" })
    const initial = await host.state()
    const claims = [await claim(host, requestFor()), await claim(host, requestFor())]
    assert.deepEqual(
      new Set(claims.map(({ ownership }) => ownership.jobId)),
      new Set(pending)
    )
    const [firstClaim, secondClaim] = claims.sort(
      (a, b) =>
        a.ownership.leaseExpiresAt - b.ownership.leaseExpiresAt ||
        compareAscii(a.ownership.jobId, b.ownership.jobId)
    )
    const target = firstClaim.ownership.jobId
    const second = secondClaim.ownership.jobId
    const otherClaim = await claim(host, requestFor("other"))
    assert.equal(otherClaim.ownership.jobId, other)
    const active = await host.state()
    assert.ok(active.now < firstClaim.ownership.leaseExpiresAt)
    expectTransition(job(active, target), "Active", 1, 0, 0)
    assert.equal(
      await recover(host, "invoices", 1),
      0,
      "unexpired leases must be skipped"
    )
    const beforeExpiry = await host.state()
    assert.ok(
      beforeExpiry.now < firstClaim.ownership.leaseExpiresAt,
      "early recovery must run before the real expiry"
    )
    assert.deepEqual(persisted(beforeExpiry), persisted(active))

    const expired = await waitForExpiry(
      host,
      Math.max(
        firstClaim.ownership.leaseExpiresAt,
        secondClaim.ownership.leaseExpiresAt,
        otherClaim.ownership.leaseExpiresAt
      )
    )
    assert.deepEqual(
      persisted(expired),
      persisted(active),
      "expiry alone cannot finalize an attempt"
    )
    const oldRequest = finalization(firstClaim)
    assert.deepEqual(await host.call("/finalize", oldRequest), {
      _tag: "JobOwnershipLost"
    })
    assert.deepEqual(
      await host.call("/reconcile-claim", firstClaim.ownership.leaseToken),
      {
        _tag: "InsufficientLease",
        ownership: firstClaim.ownership
      }
    )
    for (const limit of [0, 501, 1.5]) {
      assert.deepEqual(await recover(host, "invoices", limit), {
        _tag: "JobStoreProtocolError",
        reason: "invalid-input"
      })
    }
    assert.deepEqual(persisted(await host.state()), persisted(expired))

    assert.equal(await recover(host, "invoices", 1), 1)
    const recovered = await host.state()
    const recoveredRow = job(recovered, target)
    expectTransition(recoveredRow, "Pending", 2, 0, 1)
    assert.ok(recoveredRow.updatedAt >= firstClaim.ownership.leaseExpiresAt)
    assert.deepEqual(job(recovered, second), job(expired, second))
    assert.deepEqual(job(recovered, other), job(expired, other))
    const fresh = requestFor()
    assert.notEqual(fresh.leaseToken, firstClaim.ownership.leaseToken)
    const newClaim = await claim(host, fresh)
    const owned = await host.state()
    expectTransition(job(owned, target), "Active", 3, 0, 1)
    expectClaim(newClaim, fresh, recovered, owned, target)
    assert.deepEqual(
      await host.call("/reconcile-claim", firstClaim.ownership.leaseToken),
      {
        _tag: "NotOwned"
      }
    )
    assert.deepEqual(
      await host.call("/finalize", oldRequest),
      {
        _tag: "JobOwnershipLost"
      },
      "old ownership must not finalize the new claim"
    )
    const valid = finalization(newClaim)
    for (const change of [
      { leaseToken: randomUUID() },
      { lifecycleVersion: valid.ownership.lifecycleVersion - 1 },
      { leaseExpiresAt: valid.ownership.leaseExpiresAt + 1 }
    ]) {
      assert.deepEqual(
        await host.call("/finalize", {
          ...valid,
          ownership: { ...valid.ownership, ...change },
          before: { ...valid.before, ...change }
        }),
        { _tag: "JobOwnershipLost" }
      )
    }
    const forged = { ...valid, before: { ...valid.before, stalledCount: 0 } }
    assert.deepEqual(await host.call("/finalize", forged), { _tag: "JobOwnershipLost" })
    assert.deepEqual(persisted(await host.state()), persisted(owned))

    assert.deepEqual(await host.call("/finalize", valid), { _tag: "Applied" })
    const finalized = await host.state()
    expectTransition(job(finalized, target), "Completed", 4, 1, 1)
    assert.equal(job(finalized, target).completedAt, job(finalized, target).updatedAt)
    assert.equal(job(finalized, target).policy, job(initial, target).policy)
    assert.deepEqual(finalized.artifacts, initial.artifacts)
    assert.equal(await recover(host, "invoices", 1), 1)
    assert.equal(await recover(host, "invoices", 1), 0)
    const end = await host.state()
    expectTransition(job(end, second), "Pending", 2, 0, 1)
    assert.deepEqual(
      job(end, other),
      job(expired, other),
      "recovery must stay in the requested queue"
    )
  }))

test("finalization limit counts attempts while stall limit and OutcomeUnknown do not", () =>
  withStore(async (host) => {
    const limited = await seed(host, "attempt-limit", { maxFinalizedAttempts: 1 })
    const active = await claim(host, requestFor())
    const before = await host.state()
    expectTransition(job(before, limited), "Active", 1, 0, 0)
    assert.deepEqual(
      await host.call("/finalize", finalization(active, { _tag: "OutcomeUnknown" })),
      { _tag: "JobStoreProtocolError", reason: "invalid-input" }
    )
    assert.deepEqual(persisted(await host.state()), persisted(before))
    const retry = finalization(active, { _tag: "Retry", code: "temporary" })
    assert.deepEqual(await host.call("/finalize", retry), { _tag: "Applied" })
    const dead = await host.state()
    expectTransition(job(dead, limited), "Dead", 2, 1, 0)
    assert.equal(job(dead, limited).lastFailureCode, "temporary")
    assert.equal(job(dead, limited).completedAt, job(dead, limited).updatedAt)
    assert.deepEqual(dead.artifacts, before.artifacts)

    const stalled = await seed(host, "stall-limit", {
      lease: "short",
      maxStalledCount: 0
    })
    const expiredClaim = await claim(host, requestFor())
    const exact = finalization(expiredClaim, {
      _tag: "Dead",
      code: "stall_limit_exceeded"
    })
    const expired = await waitForExpiry(host, expiredClaim.ownership.leaseExpiresAt)
    expectTransition(job(expired, stalled), "Active", 1, 0, 0)
    assert.equal(await recover(host, "invoices", 500), 1)
    const after = await host.state()
    expectTransition(job(after, stalled), "Dead", 2, 0, 1)
    assert.equal(job(after, stalled).lastFailureCode, "stall_limit_exceeded")
    assert.equal(job(after, stalled).completedAt, job(after, stalled).updatedAt)
    assert.deepEqual(await host.call("/reconcile-finalization", exact), {
      _tag: "OwnershipLost"
    })
    assert.deepEqual(persisted(await host.state()), persisted(after))
  }))

test("lost claim and finalization reconcile exactly before and after workerd restart", () =>
  withStore(async (host) => {
    const target = await seed(host, "lost-responses", { maxFinalizedAttempts: 1 })
    const initial = await host.state()
    const original = requestFor()
    assert.deepEqual(await host.call("/claim?ack=drop", original), { _tag: "Unknown" })
    const afterClaim = await host.state()
    assert.deepEqual(afterClaim.calls, { claim: 1, finalize: 0 })
    assert.deepEqual(afterClaim.acknowledgments, { claim: 1, finalize: 0 })
    assert.deepEqual(afterClaim.dropped, { claim: 1, finalize: 0 })
    expectTransition(job(afterClaim, target), "Active", 1, 0, 0)
    assert.deepEqual(await host.call("/reconcile-claim", randomUUID()), {
      _tag: "NotOwned"
    })
    const owned = await host.call("/reconcile-claim", original.leaseToken)
    assert.equal(owned._tag, "Owned")
    expectClaim(owned.claim, original, initial, afterClaim, target)
    assert.deepEqual(persisted(await host.state()), persisted(afterClaim))

    await host.restart()
    const restartedClaim = await host.state()
    assert.notEqual(restartedClaim.epoch, afterClaim.epoch)
    assert.equal(restartedClaim.objectId, afterClaim.objectId)
    assert.deepEqual(persisted(restartedClaim), persisted(afterClaim))
    assert.deepEqual(await host.call("/reconcile-claim", original.leaseToken), owned)
    assert.deepEqual((await host.state()).calls, { claim: 0, finalize: 0 })

    const exact = finalization(owned.claim, { _tag: "Retry", code: "temporary" })
    assert.deepEqual(await host.call("/reconcile-finalization", exact), {
      _tag: "StillOwned"
    })
    assert.deepEqual(await host.call("/finalize?ack=drop", exact), { _tag: "Unknown" })
    const terminal = await host.state()
    assert.deepEqual(terminal.calls, { claim: 0, finalize: 1 })
    assert.deepEqual(terminal.acknowledgments, { claim: 0, finalize: 1 })
    assert.deepEqual(terminal.dropped, { claim: 0, finalize: 1 })
    const row = job(terminal, target)
    expectTransition(row, "Dead", 2, 1, 0)
    assert.equal(row.policy, job(initial, target).policy)
    assert.deepEqual(JSON.parse(row.finalizationReceipt), exact)
    assert.deepEqual(terminal.artifacts, initial.artifacts)
    const assertExact = async () => {
      assert.deepEqual(await host.call("/reconcile-finalization", exact), {
        _tag: "Applied"
      })
      const wrongSnapshot = {
        ...exact,
        before: { ...exact.before, updatedAt: exact.before.updatedAt - 1 }
      }
      const wrongTransition = {
        ...exact,
        finalization: { _tag: "Dead", code: "temporary" }
      }
      const wrongCode = {
        ...exact,
        finalization: { _tag: "Retry", code: "different" }
      }
      // Different before/command that would independently plan the same terminal
      // row still cannot match the durable receipt. A different code also loses.
      for (const wrong of [wrongSnapshot, wrongTransition, wrongCode]) {
        assert.deepEqual(
          await host.call("/reconcile-finalization", wrong),
          {
            _tag: "OwnershipLost"
          },
          "terminal status alone (or an identical resulting row) cannot prove the original request"
        )
      }
      assert.deepEqual(await host.call("/reconcile-claim", original.leaseToken), {
        _tag: "NotOwned"
      })
    }
    await assertExact()
    assert.deepEqual(persisted(await host.state()), persisted(terminal))
    assert.deepEqual((await host.state()).calls, terminal.calls)

    await host.restart()
    const restartedFinalization = await host.state()
    assert.notEqual(restartedFinalization.epoch, terminal.epoch)
    assert.equal(restartedFinalization.objectId, terminal.objectId)
    assert.deepEqual(persisted(restartedFinalization), persisted(terminal))
    await assertExact()
    const end = await host.state()
    assert.deepEqual(persisted(end), persisted(terminal))
    assert.deepEqual(end.calls, { claim: 0, finalize: 0 })

    assert.equal(await host.call("/fixture-increment-terminal-version", target), target)
    const altered = await host.state()
    assert.deepEqual(job(altered, target), {
      ...row,
      lifecycleVersion: row.lifecycleVersion + 1
    })
    assert.deepEqual(
      await host.call("/reconcile-finalization", exact),
      {
        _tag: "OwnershipLost"
      },
      "matching receipt and terminal status cannot prove an altered persisted transition"
    )
    assert.deepEqual(persisted(await host.state()), persisted(altered))
  }))

test("incompatible policies and invalid catalog selection do not write", () =>
  withStore(async (host) => {
    await seed(host, "incompatible", { lease: "incompatible" }, "/fixture-seed-legacy")
    const before = await host.state()
    const request = requestFor()
    assert.deepEqual(
      await host.call("/claim", {
        ...request,
        supportedCatalog: requestFor("other").supportedCatalog
      }),
      { _tag: "JobStoreProtocolError", reason: "invalid-input" }
    )
    assert.deepEqual(persisted(await host.state()), persisted(before))
    assert.deepEqual(await host.call("/claim", request), {
      _tag: "JobPolicyIncompatible",
      reserveMillis: 100,
      requiredMillis: 250
    })
    assert.deepEqual(persisted(await host.state()), persisted(before))
  }))

test("pre-execution release clears exact ownership without finalizing or stalling", () =>
  withStore(async (host) => {
    const target = await seed(host, "release")
    const owned = await claim(host, requestFor())
    const before = await host.state()
    assert.deepEqual(await host.call("/release", owned.ownership), { _tag: "Applied" })
    const after = await host.state()
    expectTransition(job(after, target), "Pending", 2, 0, 0)
    assert.equal(job(after, target).availableAt, job(after, target).updatedAt)
    assert.deepEqual(after.artifacts, before.artifacts)
    assert.deepEqual(await host.call("/release", owned.ownership), {
      _tag: "JobOwnershipLost"
    })
    assert.deepEqual(persisted(await host.state()), persisted(after))
  }))

for (const operation of ["claim", "finalize"]) {
  test(`held native sync orders dropped ${operation}`, () => {
    const observations = []
    const firstObservation = Promise.withResolvers()
    const release = Promise.withResolvers()
    const observer = async (request) => {
      const phase = new URL(request.url).pathname.slice(1)
      observations.push({ phase, ...(await request.json()) })
      firstObservation.resolve()
      if (phase === "sync-held") {
        await bounded("release held sync", release.promise)
      }
      return new Response(null, { status: 204 })
    }
    return withStore(async (host) => {
      await seed(host, "held-sync")
      const { objectId } = await host.state()
      const request =
        operation === "claim"
          ? requestFor()
          : finalization(await claim(host, requestFor()))
      const lost = host.call(`/${operation}?ack=drop&hold-sync`, request)
      try {
        await bounded(
          "first barrier observation",
          Promise.race([firstObservation.promise, lost])
        )
      } finally {
        observations.push({ phase: "release" })
        release.resolve()
      }
      const result = await lost
      assert.deepEqual(
        observations,
        [
          { phase: "sync-held", operation, objectId },
          { phase: "release" },
          {
            phase: "response-created",
            operation,
            objectId,
            barrierPhase: "released",
            dropPhase: "released"
          }
        ],
        `barrier order: ${operation} drop and response creation must follow native sync and release`
      )
      assert.deepEqual(result, { _tag: "Unknown" })
    }, observer)
  })
}

const recoveryFailures = /** @type {const} */ ([
  ["sql", { _tag: "SqliteStoreUnavailable", commitKnowledge: "Unknown" }],
  ["fence", { _tag: "JobStoreProtocolError", reason: "invalid-artifact" }]
])
for (const [fault, expected] of recoveryFailures) {
  test(`recovery rolls back its first update after a second-row ${fault} failure`, () =>
    withStore(async (host) => {
      const ids = [
        await seed(host, "rollback-a", { lease: "short" }),
        await seed(host, "rollback-b", { lease: "short" })
      ]
      const claims = [await claim(host, requestFor()), await claim(host, requestFor())]
      assert.deepEqual(
        new Set(claims.map((value) => value.ownership.jobId)),
        new Set(ids)
      )
      const [first, second] = claims
        .map((value) => value.ownership)
        .sort(
          (a, b) => a.leaseExpiresAt - b.leaseExpiresAt || compareAscii(a.jobId, b.jobId)
        )
      assert.equal(await host.call("/fixture-fail-second-recovery", fault), "installed")
      const before = await waitForExpiry(host, second.leaseExpiresAt)
      assert.deepEqual(
        before.rows
          .filter(
            (row) =>
              row.queue === "invoices" &&
              row.state === "Active" &&
              row.leaseExpiresAt <= before.now
          )
          .map((row) => row.jobId)
          .sort(compareAscii),
        ids.sort(compareAscii)
      )
      assert.deepEqual(await recover(host, "invoices", 2), expected)
      const after = await host.state()
      assert.equal(after.objectId, before.objectId)
      assert.equal(after.epoch, before.epoch)
      assert.equal(job(after, second.jobId).state, "Active")
      assert.equal(
        job(after, first.jobId).state,
        "Active",
        "first update leaked from failed batch"
      )
      assert.deepEqual(persisted(after), persisted(before))
    }))
}

test("recovery includes expiry equal to the same SQLite sample", () =>
  withStore(async (host) => {
    const ids = [
      await seed(host, "boundary-before"),
      await seed(host, "boundary-equal"),
      await seed(host, "boundary-after")
    ]
    for (const _id of ids) {
      await claim(host, requestFor())
    }
    const before = await host.state()
    for (const id of ids) {
      expectTransition(job(before, id), "Active", 1, 0, 0)
    }
    const { count, sampledNow } = await host.call("/fixture-recover-at-boundary", ids)
    const after = await host.state()
    assert.ok(
      Number.isSafeInteger(sampledNow) &&
        sampledNow >= before.now &&
        sampledNow <= after.now
    )
    const [expired, equal, future] = ids
    assert.deepEqual(job(after, future), {
      ...job(before, future),
      leaseExpiresAt: sampledNow + 1
    })
    assert.deepEqual(after.artifacts, before.artifacts)
    const recoveredRow = (id) => ({
      ...job(before, id),
      state: "Pending",
      lifecycleVersion: 2,
      stalledCount: 1,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: sampledNow
    })
    assert.deepEqual(
      job(after, expired),
      recoveredRow(expired),
      "expiry at SQLite sample minus 1 ms"
    )
    assert.deepEqual(
      job(after, equal),
      recoveredRow(equal),
      "expiry equal to the SQLite sample must recover"
    )
    assert.equal(count, 2)
  }))

test("new incompatible job leaves no queue head or payload, including after restart", () =>
  withStore(async (host) => {
    const before = await host.state()
    assert.deepEqual(persisted(before), { rows: [], artifacts: [] })
    assert.deepEqual(
      await host.call(
        "/seed",
        seedInput("review-incompatible", { lease: "incompatible" })
      ),
      { _tag: "JobPolicyIncompatible", reserveMillis: 100, requiredMillis: 250 }
    )
    assert.deepEqual(persisted(await host.state()), persisted(before))
    await host.restart()
    const after = await host.state()
    assert.notEqual(after.epoch, before.epoch)
    assert.equal(after.objectId, before.objectId)
    assert.deepEqual(persisted(after), persisted(before))

    const compatible = await seed(host, "review-compatible")
    const inserted = await host.state()
    assert.deepEqual(
      inserted.rows.map((row) => row.jobId),
      [compatible]
    )
    assert.deepEqual(
      inserted.artifacts.map((row) => row.jobId),
      [compatible]
    )
    const request = requestFor()
    expectClaim(
      await claim(host, request),
      request,
      inserted,
      await host.state(),
      compatible
    )
  }))

test("incompatible replay retains the first route, policy, availability and artifact", () =>
  withStore(async (host) => {
    for (const [operationId, first, replay] of [
      ["triage-retained", {}, {}],
      ["triage-retained-available", { availableAt: 123 }, { availableAt: 456 }]
    ]) {
      const id = await seed(host, operationId, first)
      const before = await host.state()
      if (first.availableAt !== undefined) {
        assert.equal(job(before, id).availableAt, first.availableAt)
        assert.equal(job(before, id).initialAvailableAt, first.availableAt)
      }
      assert.deepEqual(
        await host.call(
          "/seed",
          seedInput(operationId, {
            queue: "other",
            lease: "incompatible",
            maxStalledCount: 2,
            maxFinalizedAttempts: 5,
            ...replay
          })
        ),
        { _tag: "AlreadyPresent", jobId: id }
      )
      assert.deepEqual(persisted(await host.state()), persisted(before))
      await host.restart()
      assert.deepEqual(persisted(await host.state()), persisted(before))
    }
  }))

test("new admission requires an inclusive response reserve and representable SQLite lease expiry", () =>
  withStore(async (host) => {
    const before = await host.state()
    assert.ok(before.now > 0, "SQLite time must make a maximumMillis lease overflow")
    assert.deepEqual(
      await host.call("/seed", seedInput("reserve-249", { lease: "reserve-249" })),
      { _tag: "JobPolicyIncompatible", reserveMillis: 249, requiredMillis: 250 }
    )
    assert.deepEqual(
      await host.call("/seed", seedInput("overflow", { lease: "overflow" })),
      { _tag: "JobPolicyIncompatible" }
    )
    assert.deepEqual(persisted(await host.state()), persisted(before))
    const ids = []
    for (const reserve of [250, 251]) {
      const lease = "reserve-" + reserve
      const id = await seed(host, lease, { lease })
      ids.push(id)
      const state = await host.state()
      const policy = JSON.parse(job(state, id).policy)
      assert.equal(policy.leaseDurationMillis - policy.attemptTimeoutMillis, reserve)
      assert.ok(artifact(state, id).payload.length > 0)
    }
    const state = await host.state()
    assert.deepEqual(
      state.rows.map((row) => row.jobId).sort(compareAscii),
      ids.toSorted(compareAscii)
    )
    assert.deepEqual(
      state.artifacts.map((row) => row.jobId).sort(compareAscii),
      ids.toSorted(compareAscii)
    )
  }))
