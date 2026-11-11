import { randomBytes } from "node:crypto"
import { spawn } from "node:child_process"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { resolve } from "node:path"
import * as Assets from "./Assets.js"

const root = resolve(import.meta.dirname, "../../..")
const output = resolve(root, "apps/playground-worker/dist")
await mkdir(output, { recursive: true })
// An isolated cwd prevents Alchemy's dotenv loader from reading owner settings.
const cwd = await mkdtemp(resolve(output, "native-build-"))
const assets = resolve(cwd, "assets")
await mkdir(assets)
const assetManifest = await Assets.stage(root, assets)
await writeFile(resolve(cwd, "assets.json"), JSON.stringify(assetManifest, null, 2))
const port = await new Promise<number>((done, reject) => {
  const server = createServer()
  server.once("error", reject)
  server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    if (address === null || typeof address === "string") {
      server.close()
      reject(new Error("Expected a loopback TCP address"))
      return
    }
    server.close(() => done(address.port))
  })
})
// Only synthetic local configuration reaches the finite native build host.
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  PG_connectionString: "postgres://build:build@127.0.0.1:1/build",
  SCHEMA: "native_build",
  ORIGIN: `http://127.0.0.1:${port}`,
  LOCAL_PREVIEW: "true",
  LOCAL_PRIVATE: "true",
  ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  FINGERPRINT_KEY: randomBytes(32).toString("hex"),
  CURSOR_KEY: randomBytes(32).toString("hex"),
  ASSET_DIRECTORY: assets,
  NATIVE_BUILD_DIRECTORY: cwd
}
await new Promise<void>((done, reject) => {
  const child = spawn(
    process.execPath,
    [resolve(import.meta.dirname, "NativeBuild.ts")],
    {
      cwd,
      env,
      stdio: "inherit"
    }
  )
  child.once("error", reject)
  child.once("exit", (code) =>
    code === 0 ? done() : reject(new Error(`Native build exited ${code}`))
  )
})
await writeFile(
  resolve(output, "native.json"),
  JSON.stringify({ directory: cwd }, null, 2)
)
