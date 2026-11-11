import { expect, test } from "vitest"
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { runInNewContext } from "node:vm"
import assert from "node:assert/strict"

test("both historical receipt branches use the pinned baseline build contract", () => {
  // a5e7522e54a323c4342cd790c744ad89d7917c19 emits website/dist/Client.js.
  // The handoff verifies that Git build contract separately; CI may be shallow.
  const source = readFileSync(new URL("./DemoUnlock.mjs", import.meta.url), "utf8")
  const reads = [
    ...source.matchAll(/hash\(readFileSync\(`\$\{baselineRoot\}\/[^`]+\/Client\.js`\)\)/g)
  ]
  expect(reads).toHaveLength(2)
  const cachedAssertion = source.match(
    /assert\.equal\(\s*prior\.baseline\.clientSha256,\s*hash\(readFileSync\(`\$\{baselineRoot\}\/[^`]+\/Client\.js`\)\)\s*\)/
  )[0]
  const root = mkdtempSync(resolve(tmpdir(), "historical-client-path-"))
  try {
    // A bounded path/hash fixture, never a historical runtime qualification receipt.
    const client = resolve(root, "apps/website/dist/Client.js")
    mkdirSync(resolve(root, "apps/website/dist"), { recursive: true })
    writeFileSync(client, "historical client fixture")
    const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
    const expected = hash(readFileSync(client))
    const context = {
      assert,
      hash,
      readFileSync,
      baselineRoot: root,
      prior: { baseline: { clientSha256: expected } }
    }
    expect(() => runInNewContext(cachedAssertion, context)).not.toThrow()
    for (const read of reads) {
      expect(runInNewContext(read[0], context)).toBe(expected)
    }
    writeFileSync(client, "tampered historical fixture")
    expect(() => runInNewContext(cachedAssertion, context)).toThrow()
    for (const read of reads) {
      expect(runInNewContext(read[0], context)).not.toBe(expected)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
