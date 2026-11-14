import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises"
import { resolve, extname } from "node:path"
import { chromium, expect } from "@playwright/test"

const directory = resolve("apps/website/dist/site")
const evidence = resolve(".multica/website-favicon/browser")
await mkdir(evidence, { recursive: true })
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".ico": "image/vnd.microsoft.icon",
  ".png": "image/png",
  ".json": "application/json"
}
const assets = new Map()
for (const file of await readdir(directory, { recursive: true })) {
  if (file === "_headers") {
    continue
  }
  try {
    const entry = {
      bytes: await readFile(resolve(directory, file)),
      type: types[extname(file)] ?? "application/octet-stream"
    }
    assets.set("/" + file, entry)
    if (file.endsWith("/index.html")) {
      assets.set("/" + file.slice(0, -11), entry)
    }
    if (file === "index.html") {
      assets.set("/", entry)
    }
  } catch (error) {
    if (error.code !== "EISDIR") {
      throw error
    }
  }
}
const server = createServer((request, response) => {
  const entry = assets.get(new URL(request.url, "http://localhost").pathname)
  response.writeHead(entry ? 200 : 404, { "content-type": entry?.type ?? "text/plain" })
  response.end(entry?.bytes ?? "Not found")
})
await new Promise((done) => server.listen(0, "127.0.0.1", done))
const origin = `http://127.0.0.1:${server.address().port}`
const results = { status: "INCOMPLETE", routes: [], images: [], errors: [] }
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
    reducedMotion: "reduce"
  })
  page.on("pageerror", (error) => results.errors.push(error.message))
  for (const route of ["/", "/docs", "/docs/start/tutorial"]) {
    await page.goto(origin + route)
    await expect(page.locator('link[rel~="icon"][href="/favicon.svg"]')).toHaveCount(1)
    await expect(page.locator('link[rel~="icon"][href="/favicon.ico"]')).toHaveCount(1)
    await expect(
      page.locator('link[rel="apple-touch-icon"][href="/apple-touch-icon.png"]')
    ).toHaveCount(1)
    results.routes.push({ route, svg: true, ico: true, apple: true })
  }
  for (const [name, dimensions] of [
    ["favicon.svg", [34]],
    ["favicon.ico", [16, 32, 48]],
    ["apple-touch-icon.png", [180]]
  ]) {
    const result = await page.evaluate(
      async (input) => {
        const image = new Image()
        image.src = input.url
        await image.decode()
        const canvas = document.createElement("canvas")
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext("2d")
        context.drawImage(image, 0, 0)
        const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data
        let transparent = 0
        let minimumAlpha = 255
        for (let i = 3; i < rgba.length; i += 4) {
          if (rgba[i] === 0) {
            transparent++
          }
          minimumAlpha = Math.min(minimumAlpha, rgba[i])
        }
        return {
          name: input.name,
          width: canvas.width,
          height: canvas.height,
          transparent,
          minimumAlpha
        }
      },
      { name, url: origin + "/" + name }
    )
    assert(dimensions.includes(result.width))
    assert.equal(result.width, result.height)
    if (name === "apple-touch-icon.png") {
      assert.equal(result.minimumAlpha, 255)
    } else {
      assert(result.transparent > 0, "Transparent rounded corners")
    }
    results.images.push(result)
  }
  await page.goto(origin + "/docs")
  await page.evaluate(() => document.fonts.ready)
  await page
    .locator(".ej-mark")
    .screenshot({ path: resolve(evidence, "header-badge.png") })
  await page.evaluate(() => {
    const preview = document.createElement("div")
    preview.style.cssText =
      "position:fixed;inset:0;background:#171719;display:flex;align-items:center;justify-content:center;gap:32px;z-index:9999"
    for (const name of ["favicon.svg", "favicon.ico", "apple-touch-icon.png"]) {
      const image = document.createElement("img")
      image.src = "/" + name
      image.alt = name
      image.style.cssText = "width:128px;height:128px;object-fit:contain"
      preview.append(image)
    }
    document.body.append(preview)
  })
  await page.locator('img[alt="favicon.svg"]').evaluate((image) => image.decode())
  await page.screenshot({ path: resolve(evidence, "icon-formats.png") })
  assert.deepEqual(results.errors, [])
  results.status = "PASS"
} finally {
  await browser?.close()
  await new Promise((done) => server.close(done))
  results.serverStopped = !server.listening
  await writeFile(
    resolve(evidence, "results.json"),
    JSON.stringify(results, null, 2) + "\n"
  )
  console.log(JSON.stringify(results))
}
