// Finite build/Workers asset FFI. Synthetic fixtures and current built bytes only.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { test } from "vitest"
import { Miniflare } from "miniflare"
import { compactHeaderPolicies, stage } from "../../build/Assets.js"

const policy = (route: string, value = "one") =>
  `${route}\n  ! content-security-policy\n  ! content-type\n  content-security-policy: script-src '${value}'\n  content-type: text/html\n`

test("compact only equivalent index alias headers, never root, prefix collisions or overrides", () => {
  const same = new Set([policy("/docs/a*"), policy("/docs/a/index.html")])
  assert.deepEqual(compactHeaderPolicies(same), [policy("/docs/a*")])
  for (const rules of [
    [policy("/"), policy("/index.html")],
    [policy("/docs/a*"), policy("/docs/ab/index.html")],
    [policy("/docs/a*"), policy("/docs/a/index.html", "different")],
    [policy("/docs/a*"), policy("/docs/a/i*", "different"), policy("/docs/a/index.html")],
    [policy("/docs/a*"), policy("/docs/a/index.html").replace("text/html", "text/plain")]
  ]) {
    assert.deepEqual(compactHeaderPolicies(new Set(rules)), rules)
  }
  assert.deepEqual(
    compactHeaderPolicies(new Set([policy("/docs*", "parent"), ...same])),
    [policy("/docs*", "parent"), policy("/docs/a*")]
  )
})

const fixture = async (directory: string, pages: number) => {
  const files: Record<string, string> = {
    "apps/playground-worker/tests/integration/Local.ts": `const page = '<!doctype html><script>dashboard()</script>'\nconst assets: unknown = {}`,
    "apps/playground/dist/Client.js": "// dashboard client",
    "apps/playground/dist/Jobs.css": "/* dashboard css */",
    "apps/website/dist/site/index.html": "<!doctype html><script>root()</script>",
    "apps/website/dist/site/404.html": "<!doctype html><script>missing()</script>"
  }
  for (let index = 0; index < pages; index++) {
    files[`apps/website/dist/site/docs/page-${index}/index.html`] =
      `<!doctype html><script>page${index}()</script>`
  }
  for (const [path, value] of Object.entries(files)) {
    const target = resolve(directory, path)
    await mkdir(resolve(target, ".."), { recursive: true })
    await writeFile(target, value)
  }
}

test("genuinely nonredundant rules still fail the native100 bound", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-bound-"))
  try {
    await fixture(directory, 50)
    await assert.rejects(
      stage(directory, resolve(directory, "staged")),
      /native 100-rule header bound/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("classify only exact root platform controls, retaining arbitrary real assets", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-controls-"))
  try {
    await fixture(directory, 1)
    const site = resolve(directory, "apps/website/dist/site")
    await mkdir(resolve(site, "nested"))
    for (const path of [
      "_headers",
      "_redirects",
      "_public",
      "nested/_headers",
      "status"
    ]) {
      await writeFile(resolve(site, path), `source payload ${path}`)
    }
    const assets = resolve(directory, "staged")
    const manifest = await stage(directory, assets)
    assert(!manifest.some((entry) => ["/_headers", "/_redirects"].includes(entry.path)))
    for (const path of ["/_public", "/nested/_headers", "/status"]) {
      const entry = manifest.find((entry) => entry.path === path)!
      assert(entry, path)
      assert.equal(
        await readFile(resolve(assets, entry.file), "utf8"),
        `source payload ${path.slice(1)}`
      )
    }
    assert(
      !(await readFile(resolve(assets, "_headers"), "utf8")).includes("source payload")
    )
    assert((await readFile(resolve(assets, "_redirects"), "utf8")).includes(" 200"))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const nativeAssets = (directory: string) =>
  new Miniflare({
    workers: [
      {
        config: {
          name: "staged-assets",
          compatibilityDate: "2026-10-13",
          manifest: {
            mainModule: "trap.js",
            modules: {
              "trap.js": {
                type: "esm",
                contents:
                  'export default {fetch(){throw Error("Unexpected user Worker execution")}}'
              }
            }
          },
          assets: {
            directory,
            hasUserWorker: false,
            htmlHandling: "drop-trailing-slash",
            notFoundHandling: "404-page"
          }
        }
      }
    ]
  })

test("native matching keeps identical alias headers and conflicting prefix overrides equivalent", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-equivalence-"))
  try {
    for (const conflict of [false, true]) {
      const rules = new Set([
        policy("/docs*", "parent"),
        policy("/docs/a*"),
        ...(conflict ? [policy("/docs/a/i*", "conflict")] : []),
        policy("/docs/a/index.html"),
        policy("/_pages/one*")
      ])
      const observations = []
      for (const [name, selected] of [
        ["original", [...rules]],
        ["compact", compactHeaderPolicies(rules)]
      ] as const) {
        const assets = resolve(directory, `${conflict}-${name}`)
        await mkdir(resolve(assets, "_pages"), { recursive: true })
        await writeFile(resolve(assets, "_pages/one.html"), "<!doctype html>same bytes")
        await writeFile(resolve(assets, "_headers"), [...selected].sort().join("\n"))
        await writeFile(
          resolve(assets, "_redirects"),
          "/docs/a /_pages/one 200\n/docs/a/index.html /_pages/one 200\n"
        )
        const native = nativeAssets(assets)
        try {
          const origin = String(await native.ready).replace(/\/$/, "")
          const responses = []
          for (const path of ["/docs/a", "/docs/a/index.html", "/_pages/one"]) {
            const response = await native.dispatchFetch(origin + path)
            responses.push({
              path,
              status: response.status,
              bytes: await response.text(),
              csp: response.headers.get("content-security-policy"),
              mime: response.headers.get("content-type")
            })
          }
          observations.push(responses)
        } finally {
          await native.dispose()
        }
      }
      assert.deepEqual(observations[1], observations[0])
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("real staged public/canonical/alias/internal/dashboard bytes and full owned headers survive native parsing", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "asset-native-"))
  let native: Miniflare | undefined
  try {
    const manifest = await stage(process.cwd(), directory)
    assert(!manifest.some((entry) => ["/_headers", "/_redirects"].includes(entry.path)))
    const headers = await readFile(resolve(directory, "_headers"), "utf8")
    const redirects = await readFile(resolve(directory, "_redirects"), "utf8")
    assert(
      redirects
        .trim()
        .split("\n")
        .every((line) => /^\S+ \/_pages\/[a-f0-9]{64} 200$/.test(line))
    )
    assert(
      !headers.includes("\n/*s\n"),
      "extensionless names must not replace JavaScript MIME"
    )
    assert(headers.split("\n").filter((line) => line.startsWith("/")).length <= 100)
    assert(headers.split("\n").every((line) => line.length <= 2000))
    native = nativeAssets(directory)
    const origin = String(await native.ready).replace(/\/$/, "")
    for (const path of ["/_headers", "/_redirects"]) {
      assert.equal((await native.dispatchFetch(origin + path)).status, 404)
    }
    for (const entry of manifest) {
      const routes = [entry.path]
      if (entry.headers["content-type"]!.startsWith("text/html")) {
        routes.push("/" + entry.file.replace(/\.html$/, ""))
        if (entry.path !== "/" && !entry.path.endsWith(".html")) {
          routes.push(entry.path + "/")
        }
      }
      for (const route of routes) {
        const response = await native.dispatchFetch(origin + route, {
          redirect: "manual"
        })
        assert.equal(response.status, 200, route)
        const bytes = new Uint8Array(await response.arrayBuffer())
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          entry.sha256,
          route
        )
        for (const [name, value] of Object.entries(entry.headers)) {
          assert.equal(response.headers.get(name), value, `${route} ${name}`)
        }
      }
    }
    const dashboard = manifest.find((entry) => entry.path === "/jobs")!
    const docs = manifest.find((entry) => entry.path === "/docs")!
    assert.notEqual(
      dashboard.headers["content-security-policy"],
      docs.headers["content-security-policy"]
    )
  } finally {
    await native?.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})
