import { Schema } from "effect"
import { readFileSync, createWriteStream } from "node:fs"
import { mkdtemp, mkdir, writeFile, readdir, readFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { createHash, randomBytes } from "node:crypto"
import { resolve } from "node:path"
import { createServer } from "node:net"
// Local workerd FFI. All inputs are fresh synthetic configuration; no .env access.

const { createAssets } = (await import(
  new URL("../../src/assets/StaticAssets.ts", import.meta.url).href
)) as typeof import("../../src/assets/StaticAssets.js")

export const QualificationConfiguration = Schema.Struct({
  user: Schema.String,
  database: Schema.String,
  password: Schema.String,
  port: Schema.Int,
  schema: Schema.String,
  encryptionKey: Schema.String,
  fingerprintKey: Schema.String,
  cursorKey: Schema.String
})
export const readQualificationConfiguration = () => {
  const path = process.env.PLAYGROUND_PRIVATE_CONFIG
  if (!path) {
    throw new Error("Expected an owned qualification config path")
  }
  return {
    ...Schema.decodeUnknownSync(QualificationConfiguration)(
      JSON.parse(readFileSync(path, "utf8"))
    ),
    connectionString: ""
  }
}
export interface LocalConfiguration {
  readonly connectionString: string
  readonly schema: string
  readonly encryptionKey: string
  readonly fingerprintKey: string
  readonly cursorKey: string
}
export interface LocalOptions {
  readonly instrument?: boolean
  readonly https?: boolean
  readonly demoRotationMillis?: number
  readonly localPrivate?: boolean
  readonly port?: number
}
const root = resolve(import.meta.dirname, "../../../..")
const evidence = resolve(
  root,
  process.env.PLAYGROUND_EVIDENCE_DIRECTORY ?? ".multica/integration"
)
export const reservePort = () =>
  new Promise<number>((done, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address === null || typeof address === "string") {
        server.close()
        reject(new Error("Expected local TCP address"))
        return
      }
      const port = address.port
      server.close(() => done(port))
    })
  })
// Foundation's asset stager consumes this unchanged dashboard declaration.
export const dashboardAssets = () => {
  const page =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Effect Jobs Playground</title><link rel="stylesheet" href="/Jobs.css"></head><body><main id="jobs"></main><script type="module" src="/Client.js"></script></body></html>'
  const assets: Parameters<typeof createAssets>[0]["dashboard"] = {
    "/jobs": [page, "text/html"],
    "/demo": [page, "text/html"],
    "/Client.js": [
      readFileSync(`${root}/apps/playground/dist/Client.js`),
      "text/javascript"
    ],
    "/Jobs.css": [readFileSync(`${root}/apps/playground/dist/Jobs.css`), "text/css"]
  }
  return assets
}
export const createLocal = async (
  cfg: LocalConfiguration,
  options: LocalOptions = {}
) => {
  if (options.instrument) {
    throw new Error(
      "Native queue diagnostics are not wired; legacy Promise probes cannot run"
    )
  }
  if (options.https === true) {
    throw new Error(
      "Native local providers require explicit HTTP preview; hosted HTTPS remains a separate contract"
    )
  }
  const requestedPort = options.port ?? 0
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new Error("Invalid local preview port")
  }
  const port = requestedPort || (await reservePort())
  const origin = `http://127.0.0.1:${port}`
  const pointer = JSON.parse(
    readFileSync(resolve(root, "apps/playground-worker/dist/native.json"), "utf8")
  ) as { directory: string }
  const manifest = JSON.parse(
    readFileSync(resolve(pointer.directory, "manifest.json"), "utf8")
  ) as { assets: string }
  await mkdir(evidence, { recursive: true })
  const directory = await mkdtemp(resolve(evidence, "native-host-"))
  // Whitelist environment before Bun imports Core or any dotenv-aware library.
  const env = {
    PATH: process.env.PATH,
    HOME: directory,
    PG_connectionString: cfg.connectionString,
    SCHEMA: cfg.schema,
    ORIGIN: origin,
    LOCAL_PREVIEW: "true",
    LOCAL_PRIVATE: options.localPrivate ? "true" : "false",
    ENCRYPTION_KEY: cfg.encryptionKey,
    FINGERPRINT_KEY: cfg.fingerprintKey,
    CURSOR_KEY: cfg.cursorKey,
    DEMO_ROTATION_MS: String(options.demoRotationMillis ?? 86400000),
    ASSET_DIRECTORY: manifest.assets,
    NATIVE_HOST_STAGE: "host_" + randomBytes(8).toString("hex")
  }
  const log = createWriteStream(resolve(directory, "host.log"))
  const child = spawn("bun", [resolve(import.meta.dirname, "TestWorker.ts")], {
    cwd: directory,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  })
  child.stderr.pipe(log, { end: false })
  child.stdout.pipe(log, { end: false })
  const lines = createInterface({ input: child.stdout })
  const exited = new Promise<number | null>((done, reject) => {
    child.once("error", reject)
    child.once("exit", done)
  })
  // Register rejection handling immediately, including acquisition failure.
  void exited.catch(() => undefined)
  let disposal: Promise<void> | undefined
  const dispose = () =>
    (disposal ??= (async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.stdin.end("stop\n")
      }
      const code = await exited
      lines.close()
      await new Promise<void>((done) => log.end(done))
      const probe = await new Promise<boolean>((done) => {
        const socket = createServer()
        socket.once("error", () => done(false))
        socket.listen(port, "127.0.0.1", () => socket.close(() => done(true)))
      })
      const modules = await readdir(resolve(directory, ".alchemy/bundles"), {
        recursive: true,
        withFileTypes: true
      })
      const artifactHashes: Record<string, string> = {}
      for (const module of modules.filter((entry) => entry.isFile())) {
        const path = resolve(module.parentPath, module.name)
        artifactHashes[path.slice(directory.length + 1)] = createHash("sha256")
          .update(await readFile(path))
          .digest("hex")
      }
      await writeFile(
        resolve(directory, "cleanup.json"),
        JSON.stringify({ code, httpClosed: probe, artifactHashes })
      )
      if (code !== 0 || !probe) {
        throw new Error("Native host teardown failed; see owned host receipt")
      }
    })())
  try {
    await new Promise<void>((done, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Native host readiness deadline")),
        120000
      )
      const finish = (error?: Error) => {
        clearTimeout(timeout)
        if (error) {
          reject(error)
        } else {
          done()
        }
      }
      lines.on("line", (line) => {
        if (line === "NATIVE_HOST_READY " + origin) {
          finish()
        }
      })
      void exited.then(
        () => finish(new Error("Native host exited before readiness")),
        () => finish(new Error("Native host spawn failed"))
      )
    })
    // Compatibility spelling for existing process-command consumers. Transport
    // is real HTTP; no Miniflare instance or hand-maintained binding map exists.
    return { origin, mf: { dispatchFetch: fetch, dispose }, directory }
  } catch (error) {
    await dispose()
    throw error
  }
}
