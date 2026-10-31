// Finite browser qualification of the live, immutable corrected preview.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { extractRegion, addedLines } from "../../src/components/docs/ExtractExample.mjs"

const root = resolve(import.meta.dirname, "../../../..")
const require = createRequire(join(root, "apps/playground-worker/package.json"))
const { chromium, expect } = require("@playwright/test")
const origin = process.env.DOCS_CORRECTIONS_URL
assert(origin, "DOCS_CORRECTIONS_URL must identify the served candidate")
const output = resolve(
  root,
  process.env.DOCS_CORRECTIONS_EVIDENCE ?? ".toolchain/corrections-browser"
)
mkdirSync(output, { recursive: true })
const built = join(root, "apps/website/dist/site")
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const receipt = { origin, served: {}, views: [], details: [], aliases: [] }
// Verify every asset, including search index and styles, rather than only the H1.
for (const file of readdirSync(built, { recursive: true }).filter(
  (file) => !file.endsWith("/") && /\.[^/]+$/.test(file)
)) {
  const local = readFileSync(join(built, file))
  const response = await fetch(origin + "/" + file)
  assert.equal(response.status, 200, file)
  const served = Buffer.from(await response.arrayBuffer())
  assert.equal(hash(served), hash(local), file + ": exact served bytes")
  receipt.served[file] = hash(served)
}
const inspectIntro = async (page) => {
  const list = page.locator(".sl-markdown-content > ol").first()
  assert.equal(await list.locator(":scope > li").count(), 3)
  const names = [
    "Dual-write problem",
    "A slow provider means a long loading screen",
    "The confirmation email does not need to arrive immediately"
  ]
  for (const [index, name] of names.entries()) {
    const item = list.locator(":scope > li").nth(index)
    await expect(item.getByRole("heading", { name, exact: true, level: 2 })).toBeVisible()
    assert.equal(await item.locator("xpath=ancestor::details").count(), 0)
  }
  const text = (await list.innerText()).replace(/\s+/g, " ")
  for (const phrase of [
    "dual-write problem",
    "not one atomic operation",
    "application crashes between them",
    "provider rejects the send",
    "Even a healthy provider can be slow",
    "already saved",
    "does not mean the order failed",
    "loading screen for many seconds",
    "poor checkout experience",
    "a small delay is acceptable",
    "does not need to arrive at that exact moment",
    "detached in-process task"
  ])
    assert(text.includes(phrase), phrase)
  const geometry = await list.evaluate((element) => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    items: [...element.children].map((item) => {
      const heading = item.querySelector("h2")
      const paragraph = item.querySelector("p")
      const h = heading.getBoundingClientRect(),
        p = paragraph.getBoundingClientRect()
      const style = getComputedStyle(paragraph)
      return {
        top: h.top,
        headingBottom: h.bottom,
        proseTop: p.top,
        bottom: p.bottom,
        whiteSpace: style.whiteSpace,
        textWrap: style.textWrap,
        breaks: paragraph.querySelectorAll("br").length
      }
    }),
    followsCode: element.previousElementSibling.matches(".expressive-code")
  }))
  assert.equal(geometry.overflow, false)
  assert.equal(geometry.followsCode, true, "problems immediately follow checked example")
  for (const [index, item] of geometry.items.entries()) {
    assert(item.proseTop >= item.headingBottom)
    if (index) assert(item.top > geometry.items[index - 1].bottom, "separated problems")
    assert.equal(item.whiteSpace, "normal")
    assert.equal(item.textWrap, "wrap")
    assert.equal(item.breaks, 0)
  }
  const article = (await page.locator(".sl-markdown-content").innerText()).replace(
    /\s+/g,
    " "
  )
  for (const phrase of [
    "one PostgreSQL transaction on the same client",
    "acknowledged commit",
    "worker makes the external call separately",
    "not the database and external email",
    "not exactly-once",
    "external idempotency and uncertain outcomes"
  ])
    assert(article.includes(phrase), phrase)
  return geometry
}
const browser = await chromium.launch({ headless: true })
try {
  const navigation = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await navigation.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await navigation.goto(origin + "/docs")
  await navigation.getByRole("link", { name: "Getting started", exact: true }).click()
  assert.equal(
    new URL(navigation.url()).pathname.replace(/\/$/, ""),
    "/docs/start/tutorial"
  )
  await expect(navigation.getByRole("heading", { level: 1 })).toHaveText(
    "Getting started"
  )
  const headings = await navigation.locator(".sl-markdown-content h2").allTextContents()
  assert.equal(headings[0], "Dual-write problem")
  assert.deepEqual(
    headings.filter((h) => /^\d\./.test(h)).map((h) => Number(h[0])),
    [1, 2, 3, 4, 5, 6]
  )
  const firstCode = navigation.locator(".expressive-code").first()
  await expect(firstCode).toContainText("apps/api/src/orders/Orders.ts")
  await expect(firstCode).toContainText("export const placeOrder")
  await expect(firstCode).toContainText("emails.sendOrderConfirmation(input.orderId)")
  await expect(firstCode).not.toContainText("WithoutJobs")
  const panels = navigation.locator(".expressive-code")
  await expect(
    navigation.getByRole("table").filter({
      has: navigation.getByRole("columnheader", { name: "Owner", exact: true })
    })
  ).toHaveCount(0)
  const invoiceHandler = panels
    .filter({ hasText: "export const InvoiceDeliveryHandlerLayer" })
    .first()
  const invoiceCode = (await invoiceHandler.locator(".ec-line .code").allTextContents())
    .map((line) => line.replaceAll("\u200b", "").replaceAll("\n", ""))
    .join("\n")
  assert(invoiceCode.includes("const emails = yield* TransactionalEmails\n\n"))
  assert(invoiceCode.includes("\n\n    if (!invoice)"))
  assert(invoiceCode.includes("}\n\n    yield* emails"))
  assert(!invoiceCode.includes("yield* Mail"))
  const publicText = await navigation.locator(".sl-markdown-content").innerText()
  assert.equal(await navigation.locator(".ej-code-stage").count(), 0)
  assert(!publicText.includes("compares their checked request regions"))
  assert(!publicText.includes("Green lines with a + gutter"))
  assert(!publicText.includes("orders/application/"))
  assert(!publicText.includes("../../../../../packages/"))
  const contractPanel = panels.filter({ hasText: "export const OrdersQueue" }).first()
  assert.equal(
    await contractPanel.locator(".ec-line.ins").count(),
    0,
    "new contract is plain"
  )
  const stages = JSON.parse(
    readFileSync(join(root, "apps/website/tests/order-tutorial/CodeStages.json"))
  )
  const canonical = (path, region) =>
    extractRegion(
      readFileSync(join(root, "apps/website/examples/docs", path), "utf8"),
      region
    )
  const markedPanels = panels.filter({ has: navigation.locator(".ec-line.ins") })
  assert.equal(await markedPanels.count(), stages.length)
  for (const [index, stage] of stages.entries()) {
    const before = canonical(stage.beforeSourcePath, stage.beforeRegion)
    const after =
      canonical(stage.sourcePath, stage.region) +
      (stage.appendRegion ? "\n\n" + canonical(stage.sourcePath, stage.appendRegion) : "")
    assert.equal(hash(before), stage.beforeSha256)
    assert.equal(hash(after), stage.afterSha256)
    assert.deepEqual(
      addedLines(before, after),
      stage.added,
      "independently frozen line inventory"
    )
    const panel = markedPanels.nth(index)
    const rendered = await panel.locator(".ec-line").evaluateAll((lines) =>
      lines.map((line, i) => ({
        number: i + 1,
        inserted: line.classList.contains("ins"),
        text: line
          .querySelector(".code")
          .textContent.replaceAll("\u200b", "")
          .replaceAll("\n", "")
      }))
    )
    assert.equal(rendered.map((line) => line.text).join("\n"), after)
    assert.deepEqual(
      rendered.filter((line) => line.inserted).map((line) => line.number),
      stage.added
    )
    await panel.getByRole("button", { name: "Copy to clipboard" }).click()
    assert.equal(await navigation.evaluate(() => navigator.clipboard.readText()), after)
  }
  for (const name of ["SendConfirmation.ts", "CreateInvoice.ts", "SendInvoice.ts"]) {
    assert.equal(
      await panels.filter({ hasText: name }).locator(".ec-line.ins").count(),
      0,
      "new worker files plain"
    )
  }
  receipt.codeStages = stages
  const initialContract = await contractPanel.innerText()
  const article = await navigation.locator(".sl-markdown-content").innerText()
  assert(
    article.indexOf("emails.sendOrderConfirmation(input.orderId)") <
      article.indexOf("detached in-process")
  )
  assert(
    article.indexOf("detached in-process") < article.indexOf("export const OrdersQueue")
  )
  const createPanel = panels
    .filter({ hasText: 'PlaceOrder.enqueue("send-confirmation"' })
    .first()
  const createCode = await createPanel.innerText()
  assert(createCode.includes("invoiceRequested: false"))
  assert(createCode.includes('PlaceOrder.enqueue("send-confirmation"'))
  assert(
    !/onConflictDoNothing|matchesSubmission|OrderConflict|\.select\(/.test(createCode)
  )
  assert(article.includes("duplicate rejection, not idempotent response replay"))
  assert(
    initialContract.indexOf("JobQueue.make") <
      initialContract.indexOf("queue: OrdersQueue")
  )
  assert(
    initialContract.indexOf("export const OrderPolicy") <
      initialContract.indexOf("defaultPolicy: OrderPolicy")
  )
  assert(initialContract.includes('"effect-jobs/JobQueue"'))
  assert.equal(await contractPanel.locator("xpath=ancestor::details").count(), 0)
  // Flat navigation, native accordions only inside the article.
  assert.equal(await navigation.locator(".ej-nav-group details").count(), 0)
  const panelText = () => navigation.locator(".expressive-code pre").allTextContents()
  const canonicalPanels = await panelText()
  for (const path of [
    "/docs/start/first-job",
    "/docs/start/first-job/",
    "/docs/start/tutorial/"
  ]) {
    await navigation.goto(origin + path + "#2-handle-the-job-in-the-worker")
    await expect(navigation.locator('[id="2-handle-the-job-in-the-worker"]')).toHaveCount(
      1
    )
    assert.deepEqual(await panelText(), canonicalPanels)
    receipt.aliases.push(path)
  }
  await navigation.close()
  for (const width of [1920, 1440, 1024, 390]) {
    for (const route of ["start/tutorial", "persistence/transactions"]) {
      const page = await browser.newPage({
        viewport: { width, height: width < 500 ? 844 : 1000 },
        reducedMotion: "reduce"
      })
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      const response = await page.goto(origin + "/docs/" + route)
      assert.equal(response.status(), 200)
      await page.evaluate(() => document.fonts.ready)
      const title = route.replaceAll("/", "-") + "-" + width
      if (route === "start/tutorial") {
        const changed = page
          .locator(".expressive-code")
          .filter({ hasText: 'PlaceOrder.enqueue("send-confirmation"' })
          .first()
        await changed.screenshot({ path: join(output, title + "-diff.png") })
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true
        )
        const marker = changed.locator(".ec-line.ins").first()
        const markerStyle = await marker.evaluate((line) => ({
          background: getComputedStyle(line).backgroundColor,
          indicator: getComputedStyle(line.querySelector(".code"), "::before").content
        }))
        assert.notEqual(markerStyle.indicator, "none", "non-color addition indicator")
        const intro = await inspectIntro(page)
        const problems = page.locator(".sl-markdown-content > ol").first()
        const viewport = page.viewportSize()
        // Fit the complete list so fixed mobile chrome cannot cover its final lines.
        const bounds = await problems.boundingBox()
        await page.setViewportSize({
          width,
          height: Math.max(viewport.height, Math.ceil(bounds.height) + 300)
        })
        await problems.screenshot({ path: join(output, title + "-problems.png") })
        await page.setViewportSize(viewport)
        receipt.intro ??= []
        receipt.intro.push({ width, javaScript: true, ...intro })
        await page.evaluate(() => scrollTo(0, 0))
      }
      await page.screenshot({ path: join(output, title + "-top.png") })
      const middle = page
        .locator(".sl-markdown-content h2")
        .filter({ hasText: route === "start/tutorial" ? "3. Add" : "Try replay" })
      await middle.evaluate((element) => {
        element.scrollIntoView()
        scrollBy(0, -145)
      })
      await page.screenshot({ path: join(output, title + "-mid.png") })
      const summaries = page.locator(".sl-markdown-content details > summary")
      for (let i = 0; i < (await summaries.count()); i++) {
        const summary = summaries.nth(i)
        const details = summary.locator("..")
        assert.equal(await details.getAttribute("open"), null)
        await summary.focus()
        await expect(summary).toBeFocused()
        await page.keyboard.press("Enter")
        await expect(details).toHaveAttribute("open", "")
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true
        )
        await page.keyboard.press("Space")
        assert.equal(await details.getAttribute("open"), null)
        receipt.details.push({
          route,
          width,
          title: await summary.textContent(),
          keyboard: "Enter opens; Space closes"
        })
      }
      const replay = summaries.filter({ hasText: "Matching replay returns" })
      await replay.focus()
      await page.keyboard.press("Enter")
      const replayPanel = replay.locator("..").locator(".expressive-code")
      await replayPanel.evaluate((element) => {
        element.scrollIntoView()
        scrollBy(0, -145)
      })
      await expect(replayPanel).toContainText("AlreadyPresent")
      assert(
        (await replayPanel.locator(".code span[style]").count()) > 0,
        "syntax highlighting remains"
      )
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
      await replayPanel.getByRole("button", { name: "Copy to clipboard" }).click()
      const copied = await page.evaluate(() => navigator.clipboard.readText())
      assert(copied.includes("replay.confirmation.jobId, first.confirmation.jobId"))
      await page.screenshot({ path: join(output, title + "-code.png") })
      assert.deepEqual(errors, [])
      receipt.views.push({
        route,
        width,
        screenshots: ["top", "mid", "code"],
        copy: true,
        highlight: true
      })
      await page.close()
      const noJs = await browser.newPage({
        javaScriptEnabled: false,
        viewport: { width, height: 1000 }
      })
      await noJs.goto(origin + "/docs/" + route)
      if (route === "start/tutorial") {
        receipt.intro.push({ width, javaScript: false, ...(await inspectIntro(noJs)) })
        assert.equal(await noJs.locator(".ej-code-stage").count(), 0)
        assert.equal(
          await noJs
            .locator(".expressive-code")
            .filter({ hasText: "export const OrdersQueue" })
            .first()
            .locator(".ec-line.ins")
            .count(),
          0
        )
        assert((await noJs.locator(".ec-line.ins").count()) > 0)
      }
      const summary = noJs
        .locator("summary")
        .filter({ hasText: "Matching replay returns" })
      await summary.focus()
      await noJs.keyboard.press("Enter")
      await expect(summary.locator("..")).toHaveAttribute("open", "")
      await expect(summary.locator("..").locator(".expressive-code")).toBeVisible()
      await noJs.keyboard.press("Space")
      assert.equal(await summary.locator("..").getAttribute("open"), null)
      await noJs.close()
    }
  }
  console.log(
    "PASS: actual sidebar step 1, defined queue/policy, heading order, legacy aliases, exact served assets, keyboard/noJS details, copy/highlight, 24 screenshots"
  )
} finally {
  await browser.close()
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n")
}
