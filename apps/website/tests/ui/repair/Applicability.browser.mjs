// Production components/CSS against controlled HTTP snapshots; real PG is qualified separately.
import { Effect } from "effect"
import * as Crypto from "../../../../../packages/playground-contracts/dist/SyntheticCryptoFixture.js"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import * as Fixture from "../../../../../packages/playground-contracts/dist/Fixtures.js"
const require = createRequire(resolve("apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
const output = ".multica/task/applicability"
mkdirSync(output, { recursive: true })
const labels = [
  "Retry now",
  "Cancel job",
  "Redrive as new job",
  "Correct and redrive",
  "Reconcile applied effect",
  "Close problem"
]
let detail, sandbox, releaseMutation
let mutationCount = 0
const html =
  '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/Jobs.css"></head><body><main id="jobs"></main><script type="module" src="/Client.js"></script></body></html>'
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname
  if (path === "/Client.js" || path === "/Jobs.css") {
    res.setHeader("Content-Type", path.endsWith("js") ? "text/javascript" : "text/css")
    res.end(readFileSync(`apps/website/dist${path}`))
    return
  }
  if (
    path === "/jobs" ||
    path.startsWith("/jobs/") ||
    path === "/demo" ||
    path.startsWith("/demo/jobs/")
  ) {
    res.setHeader("Content-Type", "text/html")
    res.end(html)
    return
  }
  res.setHeader("Content-Type", "application/json")
  if (path === "/api/sandbox" || path === "/api/sandbox/issue" || path === "/api/demo") {
    res.end(JSON.stringify(sandbox))
  } else if (path.endsWith("/jobs/detail")) {
    res.end(JSON.stringify(detail))
  } else if (path === "/api/jobs" || path === "/api/demo/jobs") {
    res.end(
      JSON.stringify({
        ...Fixture.page,
        items: [detail.job],
        stats: { ...Fixture.page.stats, Completed: 0, [detail.job.state]: 1 }
      })
    )
  } else if (path === "/api/jobs/repair") {
    let body = ""
    for await (const chunk of req) {
      body += chunk
    }
    const command = JSON.parse(body)
    mutationCount++
    await new Promise((done) => {
      releaseMutation = done
    })
    res.end(
      JSON.stringify({
        _tag: "Rejected",
        sandbox: command.sandbox,
        requestId: command.requestId,
        jobId: command.jobId,
        reason: "not-eligible"
      })
    )
  } else {
    res.statusCode = 404
    res.end('{"code":"not-found"}')
  }
})
await new Promise((done) => server.listen(0, "127.0.0.1", done))
let browser
const checks = [],
  errors = []
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.UI_CHROMIUM_PATH
      ? { executablePath: process.env.UI_CHROMIUM_PATH }
      : {})
  })
  const page = await browser.newPage()
  page.setDefaultTimeout(4000)
  page.on("pageerror", (e) => errors.push(e.message))
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const publicMode of [false, true]) {
      for (const state of [
        "Pending",
        "RetryScheduled",
        "Active",
        "Completed",
        "Dead",
        "Isolated",
        "Cancelled"
      ]) {
        for (const resolution of [null, "Open", "InProgress", "Resolved"]) {
          const repairing =
            (state === "Dead" || state === "Isolated") &&
            (resolution === null || resolution === "Open")
          const problem = resolution
            ? {
                rootJobId: Fixture.detail.job.jobId,
                state: resolution,
                version: 0,
                updatedAt: Date.now(),
                activeSuccessorJobId: resolution === "InProgress" ? "successor" : null,
                outcomeKnowledge: "Unknown",
                resolution:
                  resolution === "Resolved"
                    ? {
                        kind: "ManualClose",
                        reason: "fixture",
                        observedAt: Date.now(),
                        successorJobId: null
                      }
                    : null
              }
            : null
          const enabled = {
            enabled: repairing && !publicMode,
            reason: repairing && !publicMode ? null : "not-eligible"
          }
          sandbox = {
            ...Fixture.sandbox,
            expiresAt: Date.now() + 600000,
            capabilities: Object.fromEntries(
              Object.keys(Fixture.sandbox.capabilities).map((k) => [k, !publicMode])
            )
          }
          detail = {
            ...Fixture.detail,
            job: {
              ...Fixture.detail.job,
              state,
              completedAt: ["Completed", "Dead", "Cancelled"].includes(state)
                ? Date.now()
                : null,
              availableAt: Date.now() + 600000
            },
            problem,
            eligibility: { redrive: enabled, correctedRedrive: enabled }
          }
          const expected = publicMode
            ? []
            : [
                ...(state === "RetryScheduled" ? [labels[0]] : []),
                ...(["Pending", "RetryScheduled"].includes(state) ? [labels[1]] : []),
                ...(repairing ? labels.slice(2, 4) : []),
                ...(resolution && resolution !== "Resolved" ? labels.slice(4) : [])
              ]
          await page.goto(
            `http://127.0.0.1:${server.address().port}/${publicMode ? "demo" : "jobs"}`
          )
          await page.getByRole("button", { name: detail.job.jobId, exact: true }).click()
          for (const surface of ["drawer", "full"]) {
            if (surface === "full") {
              await page
                .getByRole("button", { name: "Open full details", exact: true })
                .click()
            }
            await expect(
              page.getByRole("heading", {
                name: surface === "drawer" ? "Quick job details" : "Job details",
                exact: true
              })
            ).toBeVisible()
            for (const label of labels) {
              await expect(
                page.getByRole("button", { name: label, exact: true })
              ).toHaveCount(expected.includes(label) ? 1 : 0)
            }
            await expect(page.getByRole("region", { name: "Job operators" })).toHaveCount(
              expected.includes(labels[0]) || expected.includes(labels[1]) ? 1 : 0
            )
            await expect(
              page.getByRole("region", { name: "Repair and resolution", exact: true })
            ).toHaveCount(expected.some((l) => labels.slice(2).includes(l)) ? 1 : 0)
            await expect(page.locator("dt").filter({ hasText: /^Result$/ })).toHaveCount(
              0
            )
            checks.push({
              width,
              publicMode,
              state,
              resolution,
              surface,
              actions: expected
            })
          }
        }
      }
    }
  }

  sandbox = {
    ...sandbox,
    capabilities: Object.fromEntries(
      Object.keys(sandbox.capabilities).map((k) => [k, true])
    )
  }
  const document = await Effect.runPromise(
    Crypto.sealSyntheticDocument({
      subject: "demo-customer",
      tenant: "demo-tenant-a",
      note: "Local applicability fixture"
    })
  )
  detail = {
    ...detail,
    job: {
      ...detail.job,
      state: "Dead",
      catalog: Crypto.syntheticDocumentCatalog,
      completedAt: Date.now()
    },
    problem: { ...detail.problem, state: "Open", resolution: null },
    eligibility: {
      redrive: { enabled: true, reason: null },
      correctedRedrive: { enabled: true, reason: null }
    },
    payload: {
      _tag: "Available",
      formatVersion: 1,
      catalog: Crypto.syntheticDocumentCatalog,
      validation: "Valid",
      encryption: "SyntheticDocumentV1",
      encoded: {
        sandbox: sandbox.ref,
        version: 1,
        seed: 1,
        sequence: 1,
        behavior: "dead",
        actor: "demo-customer",
        tenant: "demo-tenant-a",
        order: "demo-order-a",
        document
      }
    }
  }
  await page.goto(`http://127.0.0.1:${server.address().port}/jobs`)
  await page.getByRole("button", { name: detail.job.jobId, exact: true }).click()
  const correct = page.getByRole("button", { name: "Correct and redrive", exact: true })
  await expect(correct).toBeVisible()
  await expect(correct).toBeDisabled()
  await expect(
    page.getByText("Unlock the payload to correct and redrive.", { exact: true })
  ).toBeVisible()
  await page.getByLabel("Demo unlock code", { exact: true }).fill("123")
  await page.getByRole("button", { name: "Unlock locally", exact: true }).click()
  await expect(correct).toBeEnabled()
  await page.getByRole("button", { name: "Relock", exact: true }).click()
  await expect(correct).toBeVisible()
  await expect(correct).toBeDisabled()
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new Error("fixture"))
    })
  })
  await page.getByRole("button", { name: "Copy payload", exact: true }).click()
  await expect(page.getByText("Clipboard unavailable.", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Redrive as new job", exact: true }).click()
  await page
    .getByLabel("Reason (synthetic context only)")
    .fill("Busy applicability fixture")
  await page.getByLabel("Investigation", { exact: true }).selectOption("KnownFailure")
  await page.getByLabel("I confirm possible duplicate effects").check()
  await page.getByRole("button", { name: "Submit repair", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Redrive as new job", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Redrive as new job", exact: true })
  ).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "Close problem", exact: true })
  ).toBeDisabled()
  await expect(correct).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Check repair receipt", exact: true })
  ).toBeDisabled()
  assert.equal(mutationCount, 1)
  releaseMutation()
  await expect(
    page.getByRole("button", { name: "Redrive as new job", exact: true })
  ).toBeEnabled()
  await expect(page.getByRole("status").filter({ hasText: "not-eligible" })).toBeVisible()
  checks.push({
    lockedCorrectable: true,
    relock: true,
    copyErrorVisible: true,
    busyControlsRemain: true,
    failedOperationVisible: true
  })
  assert.deepEqual(errors, [])
  writeFileSync(
    `${output}/result.json`,
    JSON.stringify({ result: "PASS", checks, errors, mutationCount }, null, 2)
  )
  console.log(JSON.stringify({ result: "PASS", cases: checks.length, errors }))
} finally {
  releaseMutation?.()
  await browser?.close()
  await new Promise((done) => server.close(done))
}
