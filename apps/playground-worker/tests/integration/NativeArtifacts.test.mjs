import { afterEach, expect, test } from "vitest"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { collectNativeBuild, collectNativeHost } from "./NativeArtifacts.mjs"

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
const fixture = () => {
  const root = mkdtempSync(resolve(tmpdir(), "native-artifact-regression-"))
  roots.push(root)
  const directory = resolve(root, "apps/playground-worker/dist")
  mkdirSync(directory, { recursive: true })
  const module = resolve(directory, "module.js")
  const sha256 = createHash("sha256").update("actual module").digest("hex")
  writeFileSync(module, "actual module")
  writeFileSync(resolve(directory, "native.json"), JSON.stringify({ directory }))
  writeFileSync(
    resolve(directory, "manifest.json"),
    JSON.stringify({ modules: [{ path: module, sha256 }] })
  )
  return { root, directory, module, sha256 }
}

test("qualifies actual native modules and ignores any retired Worker.js", () => {
  const f = fixture()
  const before = collectNativeBuild(f.root)
  writeFileSync(resolve(f.directory, "Worker.js"), "arbitrary obsolete worker fixture")
  expect(collectNativeBuild(f.root)).toEqual(before)
  expect(before.moduleHashes).toEqual({ [f.module]: f.sha256 })
})

test.each(["missing", "tampered"])(
  "rejects a %s module despite an unchanged manifest and pointer",
  (mode) => {
    const f = fixture()
    if (mode === "missing") {
      rmSync(f.module)
    } else {
      writeFileSync(f.module, "changed module")
    }
    expect(() => collectNativeBuild(f.root)).toThrow()
  }
)

test("records actual executed host bytes separately and rejects changes", () => {
  const f = fixture()
  writeFileSync(
    resolve(f.directory, "cleanup.json"),
    JSON.stringify({
      code: 0,
      httpClosed: true,
      artifactHashes: { "module.js": f.sha256 }
    })
  )
  expect(collectNativeHost(f.directory).moduleHashes).toEqual({ "module.js": f.sha256 })
  writeFileSync(f.module, "changed host module")
  expect(() => collectNativeHost(f.directory)).toThrow(
    "Executed host module hash mismatch"
  )
})

test("requires nonempty native modules", () => {
  const f = fixture()
  writeFileSync(resolve(f.directory, "manifest.json"), JSON.stringify({ modules: [] }))
  expect(() => collectNativeBuild(f.root)).toThrow("Native modules required")
})
