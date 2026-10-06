import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
assert.equal(manifest.name, "effect-jobs")
assert.match(manifest.version, /^\d+\.\d+\.\d+-alpha\.\d+$/)
assert.equal(manifest.private, false)
assert.equal(manifest.publishConfig.tag, "alpha")
assert.equal(process.version, "v24.15.0")
const directory = resolve(
  process.env.EFFECT_JOBS_ARTIFACT_DIRECTORY ?? join(root, ".toolchain/release/artifact")
)
mkdirSync(directory, { recursive: true })
const archive = join(directory, `${manifest.name}-${manifest.version}.tgz`)
assert(!existsSync(archive), "Immutable archive exists; do not overwrite qualified bytes")
const output = execFileSync(
  "npm",
  ["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
  { cwd: root, timeout: 60000, encoding: "utf8" }
)
const bytes = readFileSync(archive)
const digest = (algorithm, encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding)
writeFileSync(
  join(directory, "artifact.json"),
  JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      filename: archive,
      sha256: digest("sha256"),
      sha512: digest("sha512"),
      integrity: `sha512-${digest("sha512", "base64")}`,
      npmPack: JSON.parse(output)
    },
    null,
    2
  ) + "\n"
)
console.log(archive)
