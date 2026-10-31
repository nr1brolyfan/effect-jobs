import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
const root = resolve(import.meta.dirname, "../../../..")
const playwrightPackage =
  process.env.PLAYWRIGHT_PACKAGE ??
  "/home/pc/multica_workspaces/upventure-43a8c02fcc9d/upve-2151-dc3e0e68e0b3/qualification/node_modules/.bun/@playwright+test@1.56.1/node_modules/@playwright/test"
const require = createRequire(resolve(playwrightPackage, "package.json"))
const { chromium, expect } = require("./index.js")
const script = readFileSync(root + "/apps/website/dist/Client.js")
const css = readFileSync(root + "/apps/website/dist/Jobs.css")
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
    name: "playground.welcome-email",
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

// HTTP response gates exercise the production route/registry without sleeps or a fixture focus effect.
const requests = [],
  errors = [],
  observations = []
let waiting = [],
  responseVersion = 0
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost")
  const path = url.pathname
  requests.push({ path, method: req.method })
  if (path === "/Client.js" || path === "/Jobs.css") {
    res.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/css")
    res.end(path.endsWith(".js") ? script : css)
    return
  }
  if (path === "/jobs" || path.startsWith("/jobs/")) {
    res.setHeader("Content-Type", "text/html")
    res.end(
      '<!doctype html><html lang="en"><head><link rel="stylesheet" href="/Jobs.css"></head><body><main id="jobs"></main><script type="module" src="/Client.js"></script></body></html>'
    )
    return
  }
  res.setHeader("Content-Type", "application/json")
  if (path === "/api/sandbox" || path === "/api/sandbox/issue") {
    res.end(JSON.stringify(sandbox))
  } else if (path === "/api/jobs") {
    res.end(JSON.stringify(pageData))
  } else if (path === "/api/jobs/detail") {
    waiting.push({ res, jobId: url.searchParams.get("jobId") })
  } else {
    res.statusCode = 404
    res.end('{"code":"not-found"}')
  }
})
const sockets = new Set()
let signalSequence = 0
const signal = (socket, kind) => {
  const bytes = Buffer.from(
    JSON.stringify({
      kind,
      sandbox: sandbox.ref,
      reason: "jobs-changed",
      sequence: ++signalSequence
    })
  )
  const header =
    bytes.length < 126
      ? Buffer.from([0x81, bytes.length])
      : Buffer.from([0x81, 126, bytes.length >> 8, bytes.length & 255])
  socket.write(Buffer.concat([header, bytes]))
}
server.on("upgrade", (req, socket) => {
  const accept = createHash("sha1")
    .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64")
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
      accept +
      "\r\n\r\n"
  )
  sockets.add(socket)
  socket.on("close", () => sockets.delete(socket))
  socket.on("error", () => sockets.delete(socket))
  signal(socket, "ready")
})
const release = (jobId = job.jobId, failure) => {
  const matching = waiting.filter((item) => item.jobId === jobId)
  assert.ok(matching.length, "delayed detail request reached transport")
  waiting = waiting.filter((item) => item.jobId !== jobId)
  responseVersion++
  for (const { res } of matching) {
    if (failure) {
      res.statusCode = 404
      res.end(JSON.stringify({ code: failure }))
    } else {
      res.end(
        JSON.stringify({
          ...detail,
          job: { ...job, jobId, lifecycleVersion: responseVersion },
          problem: { ...problem, rootJobId: jobId },
          related: {
            items: [
              {
                jobId: "review-related",
                state: "Dead",
                kind: null,
                sourceAvailable: true
              }
            ],
            nextCursor: null
          }
        })
      )
    }
  }
}
const received = async (page, action, jobId = job.jobId) => {
  const request = page.waitForRequest(
    (req) =>
      new URL(req.url()).pathname === "/api/jobs/detail" &&
      new URL(req.url()).searchParams.get("jobId") === jobId
  )
  await action()
  await request
  // A request event precedes server receipt; this RPC response confirms the server has the gated request.
  await expect.poll(() => waiting.some((item) => item.jobId === jobId)).toBe(true)
}
const focused = (page) =>
  page.evaluate(
    () => document.activeElement?.hasAttribute("data-job-details-heading") ?? false
  )
const heading = (page) => page.locator("[data-job-details-heading]")
await new Promise((done) => server.listen(0, "127.0.0.1", done))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.UI_CHROMIUM_PATH ??
      "/home/pc/.cache/ms-playwright/chromium-1194/chrome-linux/chrome"
  })
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto(origin + "/jobs")
  // Consume ready admission's initial authoritative refresh before starting gated navigation.
  await expect
    .poll(() => requests.filter((request) => request.path === "/api/jobs").length)
    .toBeGreaterThanOrEqual(2)
  await expect(page.getByRole("button", { name: job.jobId, exact: true })).toBeVisible()
  await received(page, () =>
    page.getByRole("button", { name: job.jobId, exact: true }).click()
  )
  release()
  await expect(
    page.getByRole("heading", { name: "Quick job details", exact: true })
  ).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.getByRole("button", { name: job.jobId, exact: true })).toBeFocused()
  observations.push({ scenario: "drawer Escape restores selected row", pass: true })
  await received(page, () =>
    page.getByRole("button", { name: job.jobId, exact: true }).click()
  )
  release()
  await expect(
    page.getByRole("button", { name: "Open full details", exact: true })
  ).toBeVisible()
  await received(page, () =>
    page.getByRole("button", { name: "Open full details", exact: true }).click()
  )
  await expect(heading(page)).toHaveCount(0)
  release()
  await expect(heading(page)).toBeFocused()
  observations.push({
    scenario: "delayed Open full",
    headingFocused: await focused(page)
  })
  const back = page.getByRole("button", { name: "Back to jobs", exact: true })
  await back.focus()
  await received(page, async () => {
    for (const socket of sockets) {
      signal(socket, "invalidate")
    }
  })
  const update = page.waitForResponse(
    (res) => new URL(res.url()).pathname === "/api/jobs/detail"
  )
  release()
  await update
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  )
  await expect(back).toBeFocused()
  observations.push({
    scenario: "same identity refresh preserves chosen button",
    pass: true
  })
  await received(
    page,
    () =>
      page
        .getByRole("button", { name: "Open related job review-related", exact: true })
        .click(),
    "review-related"
  )
  await expect(heading(page)).toHaveCount(0)
  release("review-related")
  await expect(heading(page)).toBeFocused()
  await expect(page.getByLabel("Job metadata")).toContainText("review-related")
  observations.push({
    scenario: "related route/job change focuses current heading",
    pass: true
  })
  await page.getByRole("button", { name: "Back to jobs", exact: true }).click()
  await expect(page.getByRole("button", { name: job.jobId, exact: true })).toBeFocused()
  observations.push({ scenario: "full Back restores list row", pass: true })
  await page.close()
  const direct = await browser.newPage()
  direct.setDefaultTimeout(5000)
  await received(direct, () =>
    direct.goto(origin + "/jobs/" + job.jobId + "?generation=1")
  )
  await expect(heading(direct)).toHaveCount(0)
  release()
  await expect(heading(direct)).toBeFocused()
  observations.push({
    scenario: "delayed direct link",
    headingFocused: await focused(direct)
  })
  await direct.getByRole("button", { name: "Back to jobs", exact: true }).focus()
  await received(
    direct,
    () =>
      direct.evaluate(() => {
        history.pushState(null, "", "/jobs/review-missing?generation=1")
        dispatchEvent(new PopStateEvent("popstate"))
      }),
    "review-missing"
  )
  release("review-missing", "not-found")
  await expect(heading(direct)).toHaveCount(0)
  await expect(direct.getByRole("status")).toContainText("not-found")
  observations.push({
    scenario: "missing new identity removes old heading",
    headingFocused: await focused(direct)
  })
  await direct.close()
  const stale = await browser.newPage()
  await stale.goto(origin + "/jobs/" + job.jobId + "?generation=2")
  await expect(stale.getByRole("status")).toContainText("Stale generation")
  await expect(heading(stale)).toHaveCount(0)
  observations.push({
    scenario: "stale generation never mounts heading",
    headingFocused: await focused(stale)
  })
  await stale.close()
  const expired = await browser.newPage()
  await expired.clock.install()
  await received(expired, () =>
    expired.goto(origin + "/jobs/" + job.jobId + "?generation=1")
  )
  await expired.clock.fastForward(130000)
  release()
  await expect(heading(expired)).toHaveCount(0)
  observations.push({
    scenario: "expiry before delayed response never focuses old heading",
    headingFocused: await focused(expired)
  })
  await expired.close()
  const raced = await browser.newPage()
  raced.setDefaultTimeout(5000)
  await received(raced, () => raced.goto(origin + "/jobs/" + job.jobId + "?generation=1"))
  await received(
    raced,
    () =>
      raced.evaluate(() => {
        history.pushState(null, "", "/jobs/review-related?generation=1")
        dispatchEvent(new PopStateEvent("popstate"))
      }),
    "review-related"
  )
  release("review-related")
  await expect(heading(raced)).toBeFocused()
  const chosen = raced.getByRole("button", { name: "Back to jobs", exact: true })
  await chosen.focus()
  const oldResponse = raced.waitForResponse(
    (res) =>
      new URL(res.url()).pathname === "/api/jobs/detail" &&
      new URL(res.url()).searchParams.get("jobId") === job.jobId
  )
  release()
  await oldResponse
  await raced.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  )
  await expect(chosen).toBeFocused()
  await expect(raced.getByLabel("Job metadata")).toContainText("review-related")
  observations.push({
    scenario: "late old response cannot overwrite current identity or steal focus",
    pass: true
  })
  await raced.evaluate(() => {
    history.pushState(null, "", "/jobs/review-related?generation=2")
    dispatchEvent(new PopStateEvent("popstate"))
  })
  await expect(heading(raced)).toHaveCount(0)
  await expect(raced.getByRole("status")).toContainText("Stale generation")
  observations.push({
    scenario: "current heading revoked by stale route",
    headingFocused: await focused(raced)
  })
  await raced.close()
  assert.deepEqual(errors, [])
  writeFileSync(
    process.env.FOCUS_RESULT ?? "evidence/gates/focus-result.json",
    JSON.stringify(
      {
        scope: "production Dashboard/Runtime/Client/CSS; gated synthetic HTTP; no PG",
        bundleSha256: createHash("sha256").update(script).digest("hex"),
        cssSha256: createHash("sha256").update(css).digest("hex"),
        chromium: browser.version(),
        observations,
        requests,
        errors
      },
      null,
      2
    ) + "\n"
  )
  console.log(JSON.stringify(observations))
} finally {
  writeFileSync(
    process.env.FOCUS_ATTEMPT ?? "evidence/gates/focus-attempt.json",
    JSON.stringify(
      { observations, requests, pending: waiting.map((item) => item.jobId), errors },
      null,
      2
    ) + "\n"
  )
  for (const { res } of waiting) {
    res.end("{}")
  }
  for (const socket of sockets) {
    socket.destroy()
  }
  await browser?.close()
  server.closeAllConnections()
  await new Promise((done) => server.close(done))
  writeFileSync(
    process.env.FOCUS_CLEANUP ?? "evidence/gates/focus-cleanup.json",
    JSON.stringify({
      serverListening: server.listening,
      socketsDestroyed: Array.from(sockets).every((socket) => socket.destroyed),
      browserClosed: true,
      pendingResponsesEnded: true
    }) + "\n"
  )
}
