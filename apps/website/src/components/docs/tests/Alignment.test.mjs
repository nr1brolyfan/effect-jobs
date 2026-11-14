import assert from "node:assert/strict"
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readOwnerPreservation } from "./Preservation.mjs"

// Retain the standalone oracle and register it with the workspace runner too.
const { test } = await import(process.env.VITEST ? "vitest" : "node:test")

test("Defining jobs has its dedicated reference, separate from Getting started", async () => {
  const sidebar = await readFile("apps/website/src/components/docs/Sidebar.astro", "utf8")
  assert(sidebar.includes('["Defining jobs", "/docs/reference/definitions"]'))
  assert(sidebar.includes('["Getting started", "/docs/start/tutorial"]'))
  assert(!sidebar.includes("#1-place-an-order-without-waiting-for-email"))
  assert(!sidebar.includes("Durable by design"))
  assert(!sidebar.includes("Effect-native. PostgreSQL-backed."))
  assert(!sidebar.includes("ej-nav-intro"))
  assert(!sidebar.includes("ej-nav-footer"))
  const reference = await readFile(
    "apps/website/src/content/docs/reference/definitions.mdx",
    "utf8"
  )
  assert(reference.includes("title: Definitions and production"))
  for (const heading of [
    "## Job\n",
    "## JobQueue",
    "## JobProducer",
    "## JobGroup",
    "## JobApi"
  ]) {
    assert(reference.includes(heading))
  }
})

test("docs use a supported Github Dark theme without painting token spans", async () => {
  const config = await readFile("apps/website/astro.config.ts", "utf8")
  assert(config.includes('themes: ["github-dark"]'))
  assert(config.includes('codeFontSize: "14px"'))
  assert(config.includes('codeLineHeight: "1.7"'))
  const css = await readFile("apps/website/src/styles/site/docs.css", "utf8")
  assert(!css.includes("Walkthrough.css"))
  assert(!/\.expressive-code[^{}]*\bspan\b/.test(css))
  assert(css.includes("--sl-color-bg: #171719"))
  assert(css.includes("--sl-color-accent: #b5a4d1"))
})

test("explicit owner references fail actionably instead of becoming a skipped PASS", async () => {
  const directory = await mkdtemp(join(tmpdir(), "docs-preservation-input-"))
  try {
    const path = join(directory, "approved.json")
    await assert.rejects(
      readOwnerPreservation(path),
      /Requested owner preservation: cannot read reference manifest/
    )
    await writeFile(path, "not JSON")
    await assert.rejects(readOwnerPreservation(path), /must be valid JSON/)
    await writeFile(
      path,
      JSON.stringify({
        baseTree: "0".repeat(40),
        provenance: "Interface negative test, not owner approval",
        landingReadOnlyManifest: {}
      })
    )
    await assert.rejects(readOwnerPreservation(path), /original complete 21-file/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
