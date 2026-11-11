import assert from "node:assert/strict"

// Repository tooling only: the build preserves src-relative module paths in dist.
export const publicModules = (manifest) => {
  assert(manifest !== null && typeof manifest === "object")
  assert(manifest.exports !== null && typeof manifest.exports === "object")
  assert(!Array.isArray(manifest.exports))
  return Object.entries(manifest.exports).map(([subpath, target]) => {
    assert(subpath === "." || /^\.\/[A-Za-z][A-Za-z0-9]*$/.test(subpath))
    assert(target !== null && typeof target === "object" && !Array.isArray(target))
    assert.deepEqual(Object.keys(target).sort(), ["import", "types"])
    assert.equal(typeof target.import, "string")
    assert.match(target.import, /^\.\/dist\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.js$/)
    const stem = target.import.slice("./dist/".length, -".js".length)
    assert.equal(target.types, `./dist/${stem}.d.ts`)
    return {
      subpath,
      name: subpath === "." ? "index" : subpath.slice(2),
      source: `src/${stem}.ts`,
      import: target.import.slice(2),
      types: target.types.slice(2)
    }
  })
}
