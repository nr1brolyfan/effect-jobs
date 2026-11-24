import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

export const effectVersion = "4.1.3"
export const drizzleVersion = "1.0.0-rc.6-effect-jobs.1"
export const drizzleSource =
  "https://raw.githubusercontent.com/nr1brolyfan/drizzle-orm/3f651f2bce7edf64f1217a1cfb6ed3d2e6e9c54b/fork-artifacts/drizzle-orm-1.0.0-rc.6-effect-jobs.1.tgz"
export const drizzleIntegrity =
  "sha512-rP3Z9XbX0I3d7AuiIUQXcseQSOIanjCWHrRfh54AE3Ltyw9TUdPcuHosK2pT1vt+pAoHawFiBbOhz71yYza8og=="

export const checkPeer = (manifest) => {
  assert.equal(manifest.peerDependencies.effect, effectVersion)
  assert.equal(manifest.peerDependencies["drizzle-orm"], drizzleVersion)
  assert.equal(manifest.peerDependenciesMeta["drizzle-orm"].optional, true)
}

export const checkDevelopmentPin = (manifest) => {
  checkPeer(manifest)
  assert.equal(manifest.devDependencies["drizzle-orm"], drizzleSource)
}

export const checkInstalledGraph = (directory, peers = {}) => {
  const lock = JSON.parse(readFileSync(join(directory, "package-lock.json"), "utf8"))
  const expected = { effect: effectVersion, "drizzle-orm": drizzleVersion, ...peers }
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
    if (name === "drizzle-orm") {
      assert.equal(lock.packages[paths[0]].resolved, drizzleSource)
      assert.equal(lock.packages[paths[0]].integrity, drizzleIntegrity)
    }
    resolved[name] = {
      version: installed.version,
      resolved: lock.packages[paths[0]].resolved,
      integrity: lock.packages[paths[0]].integrity
    }
  }
  return resolved
}
