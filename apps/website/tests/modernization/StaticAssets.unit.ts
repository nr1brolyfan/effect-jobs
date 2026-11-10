import { test } from "vitest"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAssets } from "../../../playground-worker/src/assets/StaticAssets.js"

test("static serving keeps dashboard policy, reserves APIs and serves docs with no database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-jobs-site-"))
  try {
    await mkdir(join(directory, "docs"))
    await mkdir(join(directory, "api"))
    await writeFile(join(directory, "docs/index.html"), "<h1>Static docs</h1>")
    await writeFile(join(directory, "index.html"), "<h1>Landing</h1>")
    await writeFile(join(directory, "api/private.html"), "never served")
    await writeFile(join(directory, "jobs.html"), "never served")
    const fetch = createAssets({
      siteDirectory: directory,
      dashboard: {
        "/demo": ["Read only", "text/html"],
        "/Client.js": ["dashboard", "text/javascript"]
      }
    })
    const request = (path: string, method = "GET") =>
      fetch(new Request("http://localhost" + path, { method }))
    assert.equal(await request("/").text(), "<h1>Landing</h1>")
    assert.equal(await request("/docs").text(), "<h1>Static docs</h1>")
    assert.equal(await request("/docs/").text(), "<h1>Static docs</h1>")
    assert.equal(await request("/docs", "HEAD").text(), "")
    assert.equal(request("/docs", "POST").status, 405)
    assert.equal(request("/api/private").status, 404)
    assert.equal(request("/jobs").status, 404)
    assert.equal(request("/jobs.html").status, 404)
    assert.equal(request("/api").status, 404)
    assert.equal(request("/demo.html").status, 404)
    assert.equal(request("/missing").status, 404)
    assert.equal(await request("/demo").text(), "Read only")
    assert.match(
      request("/Client.js").headers.get("Content-Security-Policy") ?? "",
      /script-src 'self'/
    )
    assert.match(
      request("/docs").headers.get("Content-Security-Policy") ?? "",
      /object-src 'none'/
    )
    assert.equal(request("/.env").status, 404)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
