// Exact rendered source/role/path equality and built local link/anchor inventory.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import {
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  mkdirSync,
  writeFileSync
} from "node:fs"
import { resolve, join, extname } from "node:path"
import { extractRegion } from "../../src/components/docs/ExtractExample.mjs"
const root = resolve(import.meta.dirname, "../../../..")
const require = createRequire(join(root, "apps/playground-worker/package.json"))
const { chromium } = require("@playwright/test")
const built = join(root, "apps/website/dist/site")
const content = join(root, "apps/website/src/content/docs")
const browser = await chromium.launch({ headless: true })
const results = { pages: 0, snippets: 0, roles: 0, links: 0, anchors: 0, errors: [] }
const page = await browser.newPage()
try {
  const documents = new Map()
  for (const file of readdirSync(built, { recursive: true, encoding: "utf8" }).filter(
    (f) => f.endsWith(".html")
  )) {
    await page.setContent(readFileSync(join(built, file), "utf8"))
    documents.set(
      file,
      await page.evaluate(() => ({
        ids: [...document.querySelectorAll("[id]")].map((e) => e.id),
        hrefs: [...document.querySelectorAll("a[href]")].map((e) =>
          e.getAttribute("href")
        )
      }))
    )
  }
  for (const [file, doc] of documents) {
    results.pages++
    for (const href of doc.hrefs) {
      if (!href || /^(https?:|mailto:|tel:|data:)/.test(href)) {
        continue
      }
      const url = new URL(href, `http://local/${file.replace(/index.html$/, "")}`)
      let local = decodeURIComponent(url.pathname).slice(1)
      if (local === "demo" || local === "demo/") {
        continue
      } // application route, separately guarded by Routes.mjs
      if (!extname(local)) {
        local = local.replace(/\/$/, "") + "/index.html"
      }
      if (local === "/index.html") {
        local = "index.html"
      }
      const target = join(built, local)
      results.links++
      if (!existsSync(target) || !statSync(target).isFile()) {
        results.errors.push(`${file}: missing ${href}`)
        continue
      }
      if (url.hash) {
        results.anchors++
        if (!documents.get(local)?.ids.includes(decodeURIComponent(url.hash.slice(1)))) {
          results.errors.push(`${file}: missing anchor ${href}`)
        }
      }
    }
  }
  for (const file of readdirSync(content, { recursive: true, encoding: "utf8" }).filter(
    (f) => f.endsWith(".mdx")
  )) {
    const source = readFileSync(join(content, file), "utf8")
    const embeds = [...source.matchAll(/<CodeExample\b([\s\S]*?)\/>/g)].map((m) =>
      Object.fromEntries(
        [
          ...m[1].matchAll(
            /(sourcePath|region|role|appendRegion|beforeSourcePath)="([^"]+)"/g
          )
        ].map((a) => [a[1], a[2]])
      )
    )
    if (!embeds.length) {
      continue
    }
    const htmlFile = "docs/" + file.replace(/\.mdx$/, "/index.html")
    await page.setContent(readFileSync(join(built, htmlFile), "utf8"))
    const rendered = await page.locator(".expressive-code").evaluateAll((panels) =>
      panels
        .map((panel) => ({
          title: panel.querySelector(".title")?.textContent,
          insertions: panel.querySelectorAll(".ec-line.ins").length,
          role: panel.previousElementSibling?.classList.contains("ej-code-role")
            ? panel.previousElementSibling.textContent
            : null,
          code: [...panel.querySelectorAll(".ec-line .code")]
            .map((e) => e.textContent.replaceAll("\u200b", "").replaceAll("\n", ""))
            .join("\n")
        }))
        .filter((p) => p.title?.endsWith(".ts"))
    )
    assert.equal(rendered.length, embeds.length, `${file}: all source panels rendered`)
    for (let i = 0; i < embeds.length; i++) {
      const embed = embeds[i],
        actual = rendered[i]
      let expected = extractRegion(
        readFileSync(join(root, "apps/website/examples/docs", embed.sourcePath), "utf8"),
        embed.region
      )
      if (embed.appendRegion) {
        expected +=
          "\n\n" +
          extractRegion(
            readFileSync(
              join(root, "apps/website/examples/docs", embed.sourcePath),
              "utf8"
            ),
            embed.appendRegion
          )
      }
      assert.equal(
        actual.code,
        expected.replace(/\n$/, ""),
        `${file}: exact source ${String(embed.sourcePath)}/${String(embed.region ?? "full")}`
      )
      assert.equal(actual.title, embed.sourcePath.replace(/^orders\//, ""))
      if (!embed.beforeSourcePath)
        assert.equal(actual.insertions, 0, "default panels remain plain")
      results.snippets++
      if (embed.role) {
        assert.equal(actual.role, embed.role)
        results.roles++
      }
    }
  }
  assert.deepEqual(results.errors, [])
  console.log(JSON.stringify(results))
} finally {
  mkdirSync(join(root, ".toolchain/order-tutorial"), { recursive: true })
  writeFileSync(
    join(root, ".toolchain/order-tutorial/content.json"),
    JSON.stringify(results, null, 2) + "\n"
  )
  await browser.close()
}
