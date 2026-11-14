import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const { test } = await import(process.env.VITEST ? "vitest" : "node:test")
const assets = new URL("../../public/", import.meta.url)

test("vector favicon uses the header badge geometry, colours and font", async () => {
  const svg = await readFile(new URL("favicon.svg", assets), "utf8")
  const styles = await readFile(
    new URL("../../src/components/docs/ShellStyles.ts", import.meta.url),
    "utf8"
  )
  for (const color of ["#2c2933", "#edecea", "#c9b7f5"]) {
    assert(svg.includes(color))
    assert(styles.includes(color))
  }
  assert(svg.includes('viewBox="0 0 34 34"'))
  assert(svg.includes('rx="9"'))
  assert(svg.includes('font-family="Georgia, serif"'))
  assert(svg.includes('>e<tspan fill="#c9b7f5">j</tspan>'))
  assert(!/<(?:script|foreignObject|image)\b|(?:href|src)=/.test(svg))
})

test("ICO contains complete legacy-compatible 32-bit frames at 16, 32 and 48 pixels", async () => {
  const ico = await readFile(new URL("favicon.ico", assets))
  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 3)
  let end = 54
  for (const [index, size] of [16, 32, 48].entries()) {
    const entry = 6 + index * 16
    const bytes = 40 + size * size * 4 + Math.ceil(size / 32) * 4 * size
    assert.equal(ico[entry], size)
    assert.equal(ico[entry + 1], size)
    assert.equal(ico.readUInt16LE(entry + 4), 1)
    assert.equal(ico.readUInt16LE(entry + 6), 32)
    assert.equal(ico.readUInt32LE(entry + 8), bytes)
    assert.equal(ico.readUInt32LE(entry + 12), end)
    assert.equal(ico.readUInt32LE(end), 40)
    assert.equal(ico.readInt32LE(end + 4), size)
    assert.equal(ico.readInt32LE(end + 8), size * 2)
    assert.equal(ico.readUInt16LE(end + 14), 32)
    end += bytes
  }
  assert.equal(end, ico.length)
})

test("Apple touch icon is a standard 180-pixel PNG", async () => {
  const png = await readFile(new URL("apple-touch-icon.png", assets))
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a")
  assert.equal(png.subarray(12, 16).toString(), "IHDR")
  assert.equal(png.readUInt32BE(16), 180)
  assert.equal(png.readUInt32BE(20), 180)
  assert.equal(png[24], 8)
  assert([2, 6].includes(png[25]))
})

test("landing and docs advertise SVG, ICO and Apple touch variants", async () => {
  const landing = await readFile(
    new URL("../../src/pages/index.astro", import.meta.url),
    "utf8"
  )
  const config = await readFile(new URL("../../astro.config.ts", import.meta.url), "utf8")
  for (const name of ["favicon.svg", "favicon.ico", "apple-touch-icon.png"]) {
    assert(landing.includes(`/${name}`))
    assert(config.includes(`/${name}`))
  }
})

test("local assets serve the same icon bytes with image MIME types", async () => {
  const { createAssets } = await import(
    new URL("../../../playground-worker/src/assets/StaticAssets.ts", import.meta.url).href
  )
  const serve = createAssets({
    siteDirectory: new URL("../../public/", import.meta.url).pathname,
    dashboard: {}
  })
  for (const [name, type] of [
    ["favicon.svg", "image/svg+xml"],
    ["favicon.ico", "image/vnd.microsoft.icon"],
    ["apple-touch-icon.png", "image/png"]
  ]) {
    const response = serve(new Request("http://localhost/" + name))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), type)
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      await readFile(new URL(name, assets))
    )
  }
})
