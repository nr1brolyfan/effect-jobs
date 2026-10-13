// Adapted from the original UPVE-2177/2179 browser reproduction.
// Production Dashboard + drawer + repair slot with synthetic HTTP; no PG.
// The defect oracle is now ordinary pointer access and acknowledged commands.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { connect } from "node:net"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
const root = resolve(import.meta.dirname, "../../../../..")
const require = createRequire(resolve(root, "apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
const output = resolve(root, ".toolchain/t1/composition")
mkdirSync(output, { recursive: true })
const script = readFileSync(resolve(root, "apps/website/dist/Client.js"))
const css = readFileSync(resolve(root, "apps/website/dist/Jobs.css"))
const sandbox = {
  ref: { sandboxId: "review-sandbox", generation: 1 },
  expiresAt: Date.now() + 120000,
  capabilities: {
    runScenario: true,
    resetSandbox: true,
    retryJob: true,
    cancelJob: true,
    redriveJob: true
  }
}
const job = {
  jobId: "review-dead",
  catalog: {
    queue: "playground-communications",
    kind: "playground.welcome-email",
    version: 1
  },
  state: "Dead",
  availableAt: Date.now() - 2000,
  updatedAt: Date.now() - 1000,
  completedAt: Date.now() - 1000,
  attemptsMade: 1,
  stalledCount: 0,
  lifecycleVersion: 2,
  lastFailureCode: "fake_provider_terminal_rejected"
}
const problem = {
  rootJobId: job.jobId,
  state: "Open",
  version: 0,
  updatedAt: job.updatedAt,
  activeSuccessorJobId: null,
  outcomeKnowledge: "KnownFailure",
  resolution: null
}
const detail = {
  sandbox: sandbox.ref,
  job,
  producer: {
    operation: "playground.synthetic",
    operationId: "review-command",
    slot: "welcome-email"
  },
  policy: {
    leaseDurationMillis: 90000,
    attemptTimeoutMillis: 30000,
    maxAttempts: 3,
    maxStalledCount: 1,
    retrySchedule: { _tag: "FixedDelayV1", delayMillis: 5000 },
    completedRetention: { _tag: "Duration", millis: 7776000000 },
    deadRetention: { _tag: "Forever" }
  },
  relations: {
    syntheticActor: "demo-customer",
    syntheticOrderId: "demo-order-a",
    syntheticTenant: "demo-tenant-a"
  },
  createdAt: null,
  payload: {
    _tag: "Available",
    formatVersion: 1,
    catalog: job.catalog,
    encoded: {
      sandbox: sandbox.ref,
      version: 1,
      seed: 123,
      sequence: 1,
      behavior: "dead",
      actor: "demo-customer",
      tenant: "demo-tenant-a",
      order: "demo-order-a"
    },
    validation: "Valid",
    encryption: "None"
  },
  result: { _tag: "Unavailable", reason: "not-stored" },
  history: { coverage: "RetainedFacts", attempts: null, items: [], nextCursor: null },
  provider: {
    source: "synthetic-postgresql",
    accepted: false,
    invocations: 1,
    observedAt: null
  },
  lineage: null,
  problem,
  related: { items: [], nextCursor: null },
  eligibility: {
    redrive: { enabled: true, reason: null },
    correctedRedrive: { enabled: true, reason: null }
  }
}
const pageData = {
  sandbox: sandbox.ref,
  items: [job],
  nextCursor: null,
  filteredTotal: 1,
  stats: {
    total: 1,
    Pending: 0,
    RetryScheduled: 0,
    Active: 0,
    Completed: 0,
    Cancelled: 0,
    Dead: 1,
    Isolated: 0
  },
  attentionStats: { Open: 1, InProgress: 0, Resolved: 0, needsAttention: 1 }
}

const requests = [],
  receipts = [],
  checks = [],
  errors = []
const committed = new Map()
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname
  if (path === "/Client.js" || path === "/Jobs.css") {
    res.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/css")
    res.end(path.endsWith(".js") ? script : css)
    return
  }
  if (path === "/jobs" || path.startsWith("/jobs/")) {
    res.setHeader("Content-Type", "text/html")
    res.end(
      '<!doctype html><html lang="en"><head><title>Repair composition</title><link rel="stylesheet" href="/Jobs.css"></head><body><main id="jobs"></main><script type="module" src="/Client.js"></script></body></html>'
    )
    return
  }
  res.setHeader("Content-Type", "application/json")
  if (path === "/api/sandbox" || path === "/api/sandbox/issue") {
    res.end(JSON.stringify(sandbox))
  } else if (path === "/api/jobs") {
    res.end(JSON.stringify(pageData))
  } else if (path === "/api/jobs/detail") {
    res.end(JSON.stringify(detail))
  } else if (
    path === "/api/jobs/repair" ||
    path === "/api/jobs/resolution" ||
    path.endsWith("/receipt")
  ) {
    let body = ""
    for await (const chunk of req) {
      body += chunk
    }
    const command = JSON.parse(body)
    if (path.endsWith("/receipt")) {
      const receipt = committed.get(command.requestId)
      assert.ok(receipt)
      assert.deepEqual(command.sandbox, receipt.sandbox)
      receipts.push({ path, request: command, result: receipt })
      res.end(JSON.stringify(receipt))
    } else {
      requests.push({ path, command })
      const observedAt = Date.now()
      const resolving = path === "/api/jobs/resolution"
      const result = {
        _tag: "Committed",
        sandbox: command.sandbox,
        requestId: command.requestId,
        observedAt,
        problem: {
          ...problem,
          version: 1,
          state: resolving ? "Resolved" : "InProgress",
          activeSuccessorJobId: resolving ? null : "review-successor",
          resolution: resolving
            ? {
                kind:
                  command.action === "manual-close"
                    ? "ManualClose"
                    : "OperatorReconciled",
                reason: command.reason,
                observedAt,
                successorJobId: null
              }
            : null
        },
        ...(resolving
          ? {}
          : {
              action: command.action,
              sourceJobId: command.jobId,
              sourceState: command.expectedState,
              sourceLifecycleVersion: command.expectedLifecycleVersion,
              resultJobId: "review-successor"
            })
      }
      committed.set(command.requestId, result)
      res.end(
        JSON.stringify({
          _tag: "OutcomeUnknown",
          sandbox: command.sandbox,
          requestId: command.requestId
        })
      )
    }
  } else {
    res.statusCode = 404
    res.end('{"code":"not-found"}')
  }
})
await new Promise((done) => server.listen(0, "127.0.0.1", done))
const port = server.address().port
let browser
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.UI_CHROMIUM_PATH
      ? { executablePath: process.env.UI_CHROMIUM_PATH }
      : {})
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  page.setDefaultTimeout(3500)
  page.on("pageerror", (error) => errors.push(error.message))
  const open = async (surface) => {
    await page.goto(`http://127.0.0.1:${port}/jobs`)
    await page.getByRole("button", { name: job.jobId, exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Quick job details", exact: true })
    ).toBeVisible()
    if (surface === "full") {
      await page.getByRole("button", { name: "Open full details", exact: true }).click()
      await expect(
        page.getByRole("heading", { name: "Job details", exact: true })
      ).toBeVisible()
    }
  }
  for (const surface of ["drawer", "full"]) {
    for (const [triggerName, action] of [
      ["Redrive as new job", "redrive"],
      ["Correct and redrive", "corrected-redrive"],
      ["Close problem", "manual-close"],
      ["Reconcile applied effect", "reconcile-applied"]
    ]) {
      await open(surface)
      const trigger = page.getByRole("button", { name: triggerName, exact: true })
      for (const cancel of ["button", "Escape"]) {
        await trigger.click()
        const reason = page.getByLabel("Reason (synthetic context only)")
        await reason.click()
        await reason.fill("Cancel only this confirmation")
        if (cancel === "button") {
          await page
            .getByRole("button", { name: "Keep current problem", exact: true })
            .click()
        } else {
          await page.keyboard.press("Escape")
        }
        await expect(reason).toHaveCount(0)
        await expect(trigger).toBeFocused()
        await expect(
          page.getByRole("heading", {
            name: surface === "drawer" ? "Quick job details" : "Job details",
            exact: true
          })
        ).toBeVisible()
        checks.push({
          surface,
          action,
          cancel,
          focusRestored: true,
          selectionRetained: true
        })
      }
      await trigger.click()
      const reason = page.getByLabel("Reason (synthetic context only)")
      await reason.click()
      await reason.fill("Repair synthetic behavior")
      const repairing = action === "redrive" || action === "corrected-redrive"
      const submit = page.getByRole("button", {
        name: repairing ? "Submit repair" : "Record resolution",
        exact: true
      })
      if (repairing) {
        await expect(submit).toBeDisabled()
        await page
          .getByLabel("Investigation", { exact: true })
          .selectOption("KnownFailure")
        await page.getByLabel("I confirm possible duplicate effects").check()
      }
      if (action === "corrected-redrive") {
        const editor = page.getByLabel("Validated synthetic replacement JSON")
        const payload = JSON.parse(await editor.inputValue())
        await editor.click()
        await editor.fill(JSON.stringify({ ...payload, behavior: "success" }))
        await expect(page.getByText("Changed: /behavior", { exact: true })).toBeVisible()
      }
      await expect(submit).toBeEnabled()
      await submit.click()
      const receiptButton = page.getByRole("button", {
        name: repairing ? "Check repair receipt" : "Check exact resolution receipt",
        exact: true
      })
      await expect(receiptButton).toBeVisible()
      const sent = requests.at(-1)
      assert.equal(sent.command.action, action)
      assert.equal(sent.command.reason, "Repair synthetic behavior")
      assert.deepEqual(sent.command.sandbox, sandbox.ref)
      assert.match(sent.command.requestId, /^[0-9a-f-]{36}$/u)
      if (repairing) {
        assert.equal(sent.command.confirmDuplicateEffects, true)
        assert.equal(sent.command.expectedLifecycleVersion, job.lifecycleVersion)
        assert.equal(sent.command.jobId, job.jobId)
      } else {
        assert.equal(sent.command.rootJobId, problem.rootJobId)
      }
      if (action === "corrected-redrive") {
        assert.equal(sent.command.payload.behavior, "success")
      }
      await receiptButton.click()
      const acknowledgement =
        surface === "drawer"
          ? page.getByRole("dialog", { name: "Quick job details", exact: true })
          : page
      await expect(
        acknowledgement.getByText(
          "Acknowledged. Refreshing retained facts; execution state remains truthful.",
          { exact: true }
        )
      ).toBeVisible()
      await expect(receiptButton).toHaveCount(0)
      const receipt = receipts.at(-1)
      assert.equal(receipt.request.requestId, sent.command.requestId)
      assert.equal(receipt.result._tag, "Committed")
      assert.equal(requests.length, receipts.length)
      await expect(
        page.getByRole("heading", {
          name: surface === "drawer" ? "Quick job details" : "Job details",
          exact: true
        })
      ).toBeVisible()
      checks.push({
        surface,
        action,
        ordinaryClicks: true,
        exactReceipt: true,
        acknowledged: true
      })
    }
  }
  assert.deepEqual(errors, [])
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        scope: "production Client/CSS; synthetic HTTP; no PG",
        chromium: browser.version(),
        bundleSha256: createHash("sha256").update(script).digest("hex"),
        cssSha256: createHash("sha256").update(css).digest("hex"),
        checks,
        requests,
        receipts,
        errors
      },
      null,
      2
    ) + "\n"
  )
  console.log(
    JSON.stringify({
      result: "PASS",
      checks: checks.length,
      requests: requests.length,
      receipts: receipts.length
    })
  )
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
  assert.equal(server.listening, false)
  assert.equal(browser?.isConnected() ?? false, false)
  const absent = await new Promise((done) => {
    const socket = connect(port, "127.0.0.1")
    socket.once("error", (error) => {
      socket.destroy()
      done(error.code === "ECONNREFUSED")
    })
    socket.once("connect", () => {
      socket.destroy()
      done(false)
    })
  })
  assert.equal(absent, true)
  writeFileSync(
    resolve(output, "cleanup.json"),
    JSON.stringify({
      port,
      serverListening: server.listening,
      browserConnected: browser?.isConnected() ?? false,
      portRefused: absent
    }) + "\n"
  )
}
