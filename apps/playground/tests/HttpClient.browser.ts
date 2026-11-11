// Finite real Chromium/network qualification; synthetic loopback data only.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { build } from "vite"
import { chromium, type Browser } from "playwright"
import type {} from "./HttpClient.render.js"

const output = resolve(".multica/http-cancellation")
await mkdir(output, { recursive: true })
await build({
  configFile: false,
  build: {
    outDir: output,
    lib: {
      entry: resolve("apps/playground/tests/HttpClient.render.ts"),
      formats: ["es"],
      fileName: "Fixture"
    }
  }
})
const script = await readFile(resolve(output, "Fixture.js"))
const closed = Promise.withResolvers<void>()
let bodyConnectionClosed = false
let requests = 0
const server = createServer((request, response) => {
  if (request.url === "/api/sandbox") {
    requests++
    response.writeHead(200, { "Content-Type": "application/json" })
    response.write('{"ref":')
    response.once("close", () => {
      bodyConnectionClosed = true
      closed.resolve()
    })
  } else if (request.url === "/Fixture.js") {
    response.writeHead(200, { "Content-Type": "text/javascript" })
    response.end(script)
  } else {
    response.writeHead(200, { "Content-Type": "text/html" })
    response.end(
      '<!doctype html><html><body><output id="result">pending</output><script type="module" src="/Fixture.js"></script></body></html>'
    )
  }
})
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
const address = server.address()
assert(address && typeof address === "object")
let browser: Browser | undefined
let watchdog: ReturnType<typeof setTimeout> | undefined
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}`)
  await page.evaluate(() => window.httpProof.start())
  await page.waitForFunction(() => window.httpProof.bodyStarted())
  assert.equal(await page.evaluate(() => window.httpProof.aborted()), false)
  assert.equal(await page.evaluate(() => window.httpProof.cancel()), true)
  assert.equal(await page.evaluate(() => window.httpProof.aborted()), true)
  await Promise.race([
    closed.promise,
    new Promise<never>((_resolve, reject) => {
      watchdog = setTimeout(
        () => reject(new Error("native body connection did not close")),
        5_000
      )
    })
  ])
  clearTimeout(watchdog)
  assert.equal(bodyConnectionClosed, true)
  assert.equal(requests, 1)
  assert.equal(await page.evaluate(() => window.httpProof.renders()), 0)
  assert.equal(await page.locator("#result").textContent(), "pending")
  assert.deepEqual(errors, [])
  await writeFile(
    resolve(output, "receipt.json"),
    JSON.stringify(
      {
        result: "PASS",
        browser: browser.version(),
        bodyStarted: true,
        fetchSignalAborted: true,
        nativeBodyConnectionClosed: bodyConnectionClosed,
        postRequests: requests,
        lateRenders: 0,
        scriptSha256: createHash("sha256").update(script).digest("hex")
      },
      null,
      2
    ) + "\n"
  )
  console.log(
    "PASS: Chromium interruption aborts actual HTTP body, closes network and publishes no result"
  )
} finally {
  clearTimeout(watchdog)
  await browser?.close()
  server.closeAllConnections()
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done()))
  )
}
