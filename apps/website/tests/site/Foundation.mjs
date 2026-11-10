import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAssets } from "../../StaticAssets.mjs"
import {
  extractRegion,
  extractExample
} from "../../src/components/docs/ExtractExample.mjs"

test("source regions fail closed for absent, duplicate, reversed or unclosed markers", () => {
  const source =
    "before\n// #region handler\nchecked source\n// #endregion handler\nafter"
  assert.equal(extractRegion(source, "handler"), "checked source")
  assert.equal(extractRegion(source), source)
  for (const input of [
    source + source,
    "// #region handler",
    "// #endregion handler\n// #region handler",
    "unmarked"
  ]) {
    assert.throws(() => extractRegion(input, "handler"))
  }
  assert.throws(() => extractRegion(source, "../private"))
})

test("example boundary rejects non-source and absolute paths before reading", async () => {
  await assert.rejects(extractExample("/private.ts"), /relative TypeScript/)
  await assert.rejects(extractExample("credentials.json"), /relative TypeScript/)
})

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
    const request = (path, method = "GET") =>
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
      request("/Client.js").headers.get("Content-Security-Policy"),
      /script-src 'self'/
    )
    assert.match(
      request("/docs").headers.get("Content-Security-Policy"),
      /object-src 'none'/
    )
    assert.equal(request("/.env").status, 404)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("source extraction uses the configured root after bundling and rejects traversal/symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "effect-jobs-examples-"))
  try {
    await mkdir(join(directory, "examples"))
    await writeFile(
      join(directory, "examples/Checked.ts"),
      "// #region ready\nexport const ready = true\n// #endregion ready"
    )
    await writeFile(join(directory, "Private.ts"), "private")
    await symlink(join(directory, "Private.ts"), join(directory, "examples/Escape.ts"))
    const root = pathToFileURL(join(directory, "examples/"))
    assert.equal(
      await extractExample("Checked.ts", "ready", root),
      "export const ready = true"
    )
    await assert.rejects(extractExample("../Private.ts", undefined, root), /escapes/)
    await assert.rejects(extractExample("Escape.ts", undefined, root), /escapes/)
    await assert.rejects(extractExample("Checked.ts", "missing", root), /marker pair/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("insertions preserve context, repeated lines, deletion-only changes and clean text", async () => {
  const { addedLines } = await import("../../src/components/docs/ExtractExample.mjs")
  assert.deepEqual(addedLines("a\nb\nc", "a\nx\nb\nc"), [2])
  assert.deepEqual(addedLines("a\nb\nc", "a\nc"), [])
  assert.deepEqual(addedLines("a\nb\na", "a\nx\nb\na\ny"), [2, 5])
  assert.deepEqual(addedLines("a\nb", "a\n\nb"), [])
  assert.deepEqual(addedLines("a\nb", "a\nb"), [])
})
