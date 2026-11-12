import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

export const snapshots = ["1.0.0-rc.5"]
export const selectSnapshot = (manifest) => {
  assert.equal(manifest.peerDependencies["drizzle-orm"], snapshots.join(" || "))
  assert.equal(manifest.devDependencies["drizzle-orm"], snapshots[0])
  const version = process.env.DRIZZLE_ORM_VERSION ?? snapshots[0]
  assert(
    snapshots.includes(version),
    "Only the configured exact Drizzle version is allowed"
  )
  return version
}

export const checkInstalledGraph = (directory, version, peers = {}) => {
  const lock = JSON.parse(readFileSync(join(directory, "package-lock.json"), "utf8"))
  const expected = { effect: "4.1.0", "drizzle-orm": version, ...peers }
  const resolved = {}
  for (const [name, pin] of Object.entries(expected)) {
    const paths = Object.keys(lock.packages).filter((p) =>
      p.endsWith(`node_modules/${name}`)
    )
    assert.deepEqual(paths, [`node_modules/${name}`], `single physical ${name}`)
    const installed = JSON.parse(
      readFileSync(join(directory, "node_modules", name, "package.json"), "utf8")
    )
    assert.equal(installed.version, pin, `actual resolved ${name}`)
    assert.equal(lock.packages[paths[0]].version, pin)
    resolved[name] = {
      version: installed.version,
      resolved: lock.packages[paths[0]].resolved,
      integrity: lock.packages[paths[0]].integrity
    }
  }
  return resolved
}
