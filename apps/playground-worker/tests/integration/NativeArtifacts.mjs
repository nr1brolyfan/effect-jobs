// Qualification FFI: build output and executed host output have distinct provenance.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")

export const collectNativeBuild = (root) => {
  const pointer = resolve(root, "apps/playground-worker/dist/native.json")
  const directory = JSON.parse(readFileSync(pointer, "utf8")).directory
  const manifest = resolve(directory, "manifest.json")
  const modules = JSON.parse(readFileSync(manifest, "utf8")).modules
  assert.ok(Array.isArray(modules) && modules.length > 0, "Native modules required")
  const moduleHashes = {}
  for (const module of modules) {
    assert.equal(hash(module.path), module.sha256, "Native build module hash mismatch")
    moduleHashes[module.path] = module.sha256
  }
  return {
    pointer,
    pointerSha256: hash(pointer),
    manifest,
    manifestSha256: hash(manifest),
    moduleHashes
  }
}

export const collectNativeHost = (directory) => {
  const cleanup = resolve(directory, "cleanup.json")
  const receipt = JSON.parse(readFileSync(cleanup, "utf8"))
  assert.equal(receipt.code, 0, "Native host must exit successfully")
  assert.equal(receipt.httpClosed, true, "Native host HTTP must close")
  assert.ok(
    Object.keys(receipt.artifactHashes).length > 0,
    "Executed host modules required"
  )
  for (const [path, expected] of Object.entries(receipt.artifactHashes)) {
    assert.equal(
      hash(resolve(directory, path)),
      expected,
      "Executed host module hash mismatch"
    )
  }
  return { directory, cleanupSha256: hash(cleanup), moduleHashes: receipt.artifactHashes }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(
    JSON.stringify(
      process.argv[2] === "--host"
        ? collectNativeHost(process.argv[3])
        : collectNativeBuild(process.cwd())
    )
  )
}
