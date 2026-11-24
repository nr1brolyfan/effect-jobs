// Run the same independent state oracle against the package installed in a
// fresh consumer. Only this qualification intentionally bypasses the exports
// map for the internal adapter via a relative installed-file import.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

assert.equal(process.argv.length, 3, "Pass the immutable local npm archive")
const archive = resolve(process.argv[2])
const fixture = import.meta.dirname
const consumer = await mkdtemp(join(tmpdir(), "jobs-do-sqlite-consumer-"))
try {
  await mkdir(join(consumer, "home"))
  const env = {
    PATH: process.env.PATH,
    HOME: join(consumer, "home"),
    CI: "true"
  }
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { "effect-jobs": `file:${archive}`, effect: "4.1.3" }
    })
  )
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--omit=optional",
      "--strict-peer-deps",
      "--no-audit",
      "--no-fund"
    ],
    {
      cwd: consumer,
      env,
      stdio: "inherit",
      timeout: 60_000
    }
  )
  const pkg = join(consumer, "node_modules/effect-jobs")
  const manifest = JSON.parse(await readFile(join(pkg, "package.json"), "utf8"))
  assert.equal(manifest.version, "0.1.0-alpha.4")
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict"
    for (const module of [
      "effect-jobs/dist/internal/do-sqlite/Transaction.js",
      "effect-jobs/dist/internal/do-sqlite/Store.js"
    ]) {
      await assert.rejects(import(module), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" })
    }
  `
    ],
    { cwd: consumer, env, timeout: 10_000 }
  )
  const source = await readFile(join(fixture, "Worker.mts"), "utf8")
  await writeFile(
    join(consumer, "Worker.mts"),
    source.replaceAll('"../../../src/', '"./node_modules/effect-jobs/dist/')
  )
  console.log(
    JSON.stringify({
      archiveSha256: createHash("sha256")
        .update(await readFile(archive))
        .digest("hex"),
      packedVersion: manifest.version
    })
  )
  execFileSync(
    process.execPath,
    [
      "--test",
      "--test-force-exit",
      "--test-timeout=20000",
      join(fixture, "Atomicity.mjs")
    ],
    {
      cwd: consumer,
      env: { ...env, JOBS_DO_SQLITE_PACKED_CONSUMER: consumer },
      stdio: "inherit",
      timeout: 90_000
    }
  )
} finally {
  await rm(consumer, { recursive: true, force: true })
}
