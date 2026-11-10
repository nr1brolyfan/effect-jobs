// Read-only SDK study. Pass the directory of an isolated alchemy@2.0.0-beta.81 install.
// This imports a callback declaration module, never a stack, resource or deployment.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

assert(process.argv[2], "Pass an isolated SDK package directory")
const directory = resolve(process.argv[2])
const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))
assert.equal(manifest.name, "alchemy")
assert.equal(manifest.version, "2.0.0-beta.81")
const callback = await import(pathToFileURL(join(directory, "lib/Callback.js")).href)
assert.equal(typeof callback.makeCallback, "function")
const files = ["src/Callback.ts", "src/Cloudflare/Workers/DurableObject.ts"]
const snapshots = Object.fromEntries(
  files.map((file) => [
    file,
    createHash("sha256")
      .update(readFileSync(join(directory, file)))
      .digest("hex")
  ])
)
console.log(
  JSON.stringify(
    {
      sdk: manifest.version,
      callbackExport: "PASS",
      snapshots,
      deployment: "NotTested",
      alarmOwnership:
        "Alchemy owns native alarm when callbacks are used; native PoC is a separate host"
    },
    null,
    2
  )
)
