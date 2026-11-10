// Browser FFI regression against the built production UI; controlled HTTP/WebSocket.
// Run: node apps/website/tests/ui/OperatorReappearance.browser.mjs . full|drawer
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { resolve } from "node:path"
import { createHash } from "node:crypto"

const repo = resolve(process.argv[2])
const surface = process.argv[3] ?? "full"
const Fixture = await import(
  pathToFileURL(`${repo}/packages/playground-contracts/dist/Fixtures.js`)
)
const require = createRequire(`${repo}/apps/playground-worker/package.json`)
const { chromium, expect } = require("@playwright/test")
const sandbox = {
  ...Fixture.sandbox,
  expiresAt: Date.now() + 600000,
  capabilities: Object.fromEntries(
    Object.keys(Fixture.sandbox.capabilities).map((k) => [k, true])
  )
}
let state = "Pending",
  version = 1,
  detailReads = 0,
  mutations = 0
const detail = () => ({
  ...Fixture.detail,
  job: {
    ...Fixture.detail.job,
    state,
    completedAt: null,
    lifecycleVersion: version,
    availableAt: Date.now() + 600000
  },
  lineage: {
    sourceJobId: "prior-root",
    originalSourceJobId: "prior-root",
    kind: "Redrive"
  },
  // A repair successor retains its chain-level unresolved problem across live updates.
  problem: {
    rootJobId: "prior-root",
    state: "InProgress",
    version: 1,
    updatedAt: Date.now(),
    activeSuccessorJobId: Fixture.detail.job.jobId,
    outcomeKnowledge: "KnownFailure",
    resolution: null
  },
  eligibility: {
    redrive: { enabled: false, reason: "not-eligible" },
    correctedRedrive: { enabled: false, reason: "not-eligible" }
  }
})
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname
  if (
    req.method === "POST" &&
    [
      "/api/jobs/operator",
      "/api/jobs/repair",
      "/api/jobs/resolution",
      "/api/scenarios/run",
      "/api/sandbox/reset"
    ].includes(path)
  ) {
    mutations++
  }
  if (path === "/Client.js" || path === "/Jobs.css") {
    res.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/css")
    return res.end(readFileSync(`${repo}/apps/website/dist${path}`))
  }
  if (path === "/jobs" || path.startsWith("/jobs/")) {
    res.setHeader("Content-Type", "text/html")
    return res.end(
      '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/Jobs.css"></head><body><main id="jobs"></main><script type="module" src="/Client.js"></script></body></html>'
    )
  }
  res.setHeader("Content-Type", "application/json")
  if (path === "/api/sandbox" || path === "/api/sandbox/issue") {
    return res.end(JSON.stringify(sandbox))
  }
  if (path.endsWith("/jobs/detail")) {
    detailReads++
    return res.end(JSON.stringify(detail()))
  }
  if (path === "/api/jobs") {
    return res.end(
      JSON.stringify({
        ...Fixture.page,
        items: [detail().job],
        stats: { ...Fixture.page.stats, Completed: 0, [state]: 1 },
        attentionStats: { Open: 0, InProgress: 1, Resolved: 0, needsAttention: 1 }
      })
    )
  }
  res.statusCode = 404
  res.end('{"code":"not-found"}')
})
const sockets = new Set()
let sequence = 1
const send = (socket, kind) => {
  const message = Buffer.from(
    JSON.stringify({
      kind,
      sandbox: sandbox.ref,
      reason: "jobs-changed",
      sequence: sequence++
    })
  )
  socket.write(
    Buffer.concat([
      message.length < 126
        ? Buffer.from([0x81, message.length])
        : Buffer.from([0x81, 126, message.length >> 8, message.length & 255]),
      message
    ])
  )
}
server.on("upgrade", (req, socket) => {
  const accept = createHash("sha1")
    .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64")
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
  )
  sockets.add(socket)
  socket.on("close", () => sockets.delete(socket))
  send(socket, "ready")
  socket.on("data", () => {})
})
await new Promise((done) => server.listen(0, "127.0.0.1", done))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.setViewportSize({ width: surface === "drawer" ? 390 : 1280, height: 1000 })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  // Observe the actual React instance across null rendering, without product hooks.
  await page.addInitScript(() => {
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      inject: () => 1,
      onCommitFiberUnmount() {},
      onCommitFiberRoot(_id, root) {
        const visit = (fiber) => {
          if (!fiber) {
            return
          }
          const props = fiber.memoizedProps
          if (
            typeof fiber.type === "function" &&
            props?.runtime &&
            props.detail &&
            typeof props.now === "number" &&
            typeof props.blocked === "boolean"
          ) {
            window.operatorInstance = fiber
          }
          visit(fiber.child)
          visit(fiber.sibling)
        }
        visit(root.current)
      }
    }
  })
  page.setDefaultTimeout(5000)
  await page.goto(`http://127.0.0.1:${server.address().port}/jobs`)
  try {
    await page
      .getByRole("button", { name: Fixture.detail.job.jobId, exact: true })
      .click()
  } catch (e) {
    console.log(await page.locator("body").innerText())
    throw e
  }
  if (surface === "full") {
    await page.getByRole("button", { name: "Open full details", exact: true }).click()
  }
  const cancel = page.getByRole("button", { name: "Cancel job", exact: true })
  await expect(cancel).toBeVisible()
  await cancel.click()
  await expect(
    page.getByRole("button", { name: "Confirm action", exact: true })
  ).toBeVisible()
  await page.evaluate(() => {
    window.initialOperatorInstance = window.operatorInstance
  })
  assert.equal(await page.evaluate(() => Boolean(window.initialOperatorInstance)), true)
  const sameInstance = async () => {
    assert.equal(
      await page.evaluate(
        () =>
          window.operatorInstance === window.initialOperatorInstance ||
          window.operatorInstance.alternate === window.initialOperatorInstance
      ),
      true,
      "OperatorControls must retain the same React instance"
    )
  }
  const refresh = async (next) => {
    state = next
    version++
    const before = detailReads
    for (const socket of sockets) {
      send(socket, "invalidate")
    }
    await expect.poll(() => detailReads).toBeGreaterThan(before)
  }
  await refresh("Active")
  await expect(cancel).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Confirm action", exact: true })
  ).toHaveCount(0)
  await sameInstance()
  await refresh("RetryScheduled")
  await expect(cancel).toBeVisible()
  await sameInstance()
  await expect(page.locator("dialog[open]")).toHaveCount(0)
  assert.equal(mutations, 0, "live transitions must not mutate")
  await cancel.click()
  await expect(page.locator("dialog[open]")).toHaveCount(1)
  await expect(
    page.getByRole("button", { name: "Confirm action", exact: true })
  ).toBeVisible()
  assert.equal(mutations, 0, "fresh confirmation must not mutate before Confirm")
  await page.getByRole("button", { name: "Keep current job", exact: true }).click()
  await expect(page.locator("dialog[open]")).toHaveCount(0)
  await page.getByRole("button", { name: "Retry now", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Confirm action", exact: true })
  ).toBeVisible()
  await expect(page.locator("dialog[open]")).toHaveCount(1)
  assert.equal(mutations, 0, "Retry now confirmation must not mutate before Confirm")
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      surface,
      result: "PASS",
      transition: "Pending -> Active -> RetryScheduled",
      sameComponentInstance: true,
      noStaleOrAutomaticDialog: true,
      cancelConfirmationReopened: 1,
      retryNowConfirmationWorks: true,
      mutations,
      detailReads
    })
  )
} finally {
  await browser?.close()
  for (const socket of sockets) {
    socket.destroy()
  }
  await new Promise((done) => server.close(done))
}
