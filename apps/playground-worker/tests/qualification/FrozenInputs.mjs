// Qualification provenance describes actual uncommitted bytes, never the index tree.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"

const sha256 = (value) => createHash("sha256").update(value).digest("hex")
export const freezeInputs = (root, paths) => {
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "-co", "--exclude-standard", "--", ...paths],
    {
      cwd: root,
      timeout: 60000,
      encoding: "utf8"
    }
  )
    .split("\0")
    .filter(Boolean)
  const inputs = Object.fromEntries(
    [...new Set(files)]
      .filter((path) => existsSync(join(root, path)))
      .sort()
      .map((path) => [path, sha256(readFileSync(join(root, path)))])
  )
  const baselinePath = process.env.QUALIFICATION_BASELINE_MANIFEST
  const baseline = baselinePath ? JSON.parse(readFileSync(baselinePath, "utf8")) : []
  const baselineFiles = Object.fromEntries(
    baseline.map((file) => [file.path, file.sha256])
  )
  return {
    kind: "frozen-uncommitted-inputs",
    inputs,
    inputsSha256: sha256(JSON.stringify(inputs)),
    baselineManifestSha256: baselinePath ? sha256(readFileSync(baselinePath)) : null,
    delta: Object.entries(inputs)
      .filter(([path, hash]) => baselineFiles[path] !== hash)
      .map(([path, hash]) => ({
        path,
        baselineSha256: baselineFiles[path] ?? null,
        sha256: hash
      }))
  }
}
export const assertFrozen = (before, after) =>
  assert.deepEqual(after.inputs, before.inputs, "qualification input bytes changed")
export const mutationControls = (root) => {
  const directory = mkdtempSync(
    join(root, "apps/playground-worker/tests/qualification/negative-")
  )
  const path = join(directory, "input.txt")
  try {
    writeFileSync(path, "original bytes")
    const before = freezeInputs(root, [directory])
    assert.equal(
      Object.keys(before.inputs).length,
      1,
      "negative control must hash a real input"
    )
    writeFileSync(path, "changed bytes")
    assert.throws(() => assertFrozen(before, freezeInputs(root, [directory])), {
      code: "ERR_ASSERTION"
    })
    writeFileSync(path, "original bytes")
    assertFrozen(before, freezeInputs(root, [directory]))
    writeFileSync(join(directory, "added.txt"), "added input")
    assert.throws(() => assertFrozen(before, freezeInputs(root, [directory])), {
      code: "ERR_ASSERTION"
    })
    rmSync(join(directory, "added.txt"))
    rmSync(path)
    assert.throws(() => assertFrozen(before, freezeInputs(root, [directory])), {
      code: "ERR_ASSERTION"
    })
    return [
      "real file byte mutation rejected",
      "real input deletion rejected",
      "real input addition rejected",
      "restored bytes accepted"
    ]
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
