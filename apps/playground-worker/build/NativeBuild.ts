// @effect-diagnostics anyUnknownInErrorContext:off
// Standalone tooling FFI: Alchemy Test/Core exposes an upstream any error channel.
import * as Cloudflare from "@alchemy.run/cloudflare"
import * as Core from "alchemy/Test/Core"
import { State } from "alchemy/State"
import { Effect, Exit, Scope } from "effect"
import { createHash } from "node:crypto"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { connect } from "node:net"
import Stack from "../alchemy.run.js"

const directory = process.env.NATIVE_BUILD_DIRECTORY!
const scope = Scope.makeUnsafe("sequential")
const options = {
  providers: Cloudflare.providers(),
  dev: true,
  stage: "build",
  sidecar: { omitEnv: ["CLOUDFLARE_"] }
}
const sidecar = Core.makeSidecarHandle(options)
const run = <A>(effect: Core.TestEffect<A>) => Core.run(effect, options, scope, sidecar)
const deploy = Core.makeDeploy(options, scope)
const verifyClosed = async () => {
  const closed = await new Promise<boolean>((done) => {
    const socket = connect({
      host: "127.0.0.1",
      port: Number(new URL(process.env.ORIGIN!).port)
    })
    socket.once("connect", () => {
      socket.destroy()
      done(false)
    })
    socket.once("error", () => done(true))
  })
  await writeFile(
    resolve(directory, "cleanup.json"),
    JSON.stringify({ awaitedDestroy: true, httpClosed: closed })
  )
  if (!closed) {
    throw new Error("Native HTTP survived destroy")
  }
}
try {
  const output = await run(deploy(Stack))
  if (!output.url) {
    throw new Error("Native Worker did not return a URL")
  }
  const url = new URL(process.env.ORIGIN!)
  if (new URL(output.url).port !== url.port) {
    throw new Error("Native Worker port mismatch")
  }
  let ready = false
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (response.status === 200) {
        ready = true
        break
      }
    } catch {
      /* Workerd has not started listening yet. */
    }
    await new Promise((done) => setTimeout(done, 100))
  }
  if (!ready) {
    throw new Error("Native Worker readiness failed")
  }
  const receipts = []
  const assetManifest: ReadonlyArray<{
    readonly path: string
    readonly sha256: string
    readonly headers: Readonly<Record<string, string>>
  }> = JSON.parse(await readFile(resolve(directory, "assets.json"), "utf8"))
  for (const entry of assetManifest) {
    const path = entry.path
    // /demo starts the real durable generator; its DB-backed runtime is
    // qualified by the separate owned-PG native gate, not by this build host.
    if (path === "/demo") {
      continue
    }
    const response = await fetch(new URL(path, url), { redirect: "manual" })
    if (response.status !== 200) {
      throw new Error(`Native asset ${path}: ${response.status}`)
    }
    for (const header of [
      "content-type",
      "content-security-policy",
      "cache-control",
      "x-content-type-options"
    ]) {
      if (response.headers.get(header) !== entry.headers[header]) {
        throw new Error(
          `Native asset ${path}: mismatched ${header}: ${response.headers.get(header)}`
        )
      }
    }
    const digest = createHash("sha256")
      .update(await response.bytes())
      .digest("hex")
    if (digest !== entry.sha256) {
      throw new Error(`Native asset ${path}: mismatched body`)
    }
    receipts.push({
      path,
      status: response.status,
      headers: Object.fromEntries(response.headers),
      sha256: digest
    })
  }
  for (const path of ["/docs/", "/docs/jobs/"]) {
    const response = await fetch(new URL(path, url), { redirect: "manual" })
    const canonical = receipts.find((entry) => entry.path === path.slice(0, -1))!
    if (
      response.status !== 200 ||
      response.headers.get("content-security-policy") !==
        canonical.headers["content-security-policy"]
    ) {
      throw new Error(`Native trailing-slash alias ${path} changed its policy`)
    }
  }
  for (const path of ["/jobs.html", "/api", "/api.html", "/demo.html", "/demo/foreign"]) {
    const response = await fetch(new URL(path, url), { redirect: "manual" })
    if (response.status !== 404) {
      throw new Error(`Reserved asset ${path} was exposed`)
    }
  }
  const head = await fetch(new URL("/docs", url), { method: "HEAD" })
  const post = await fetch(new URL("/docs", url), { method: "POST" })
  if (head.status !== 200 || (await head.text()) !== "" || post.status !== 405) {
    throw new Error("Native asset method admission changed")
  }
  // Observe the actual provider state; never maintain a parallel binding forest.
  // Names/shapes only: captured configuration values and secrets are excluded.
  const bindings = await run(
    Effect.gen(function* () {
      const store = yield* yield* State
      const names = yield* store.list({ stack: "effect-jobs-playground", stage: "build" })
      return yield* Effect.forEach(names, (fqn) =>
        Effect.gen(function* () {
          const resource = yield* store.get({
            stack: "effect-jobs-playground",
            stage: "build",
            fqn
          })
          if (resource === undefined || resource.kind === "action") {
            return { fqn }
          }
          return {
            fqn,
            resourceType: resource.resourceType,
            providerMode: resource.providerMode,
            bindings: resource.bindings.map((binding) => ({
              sid: binding.sid,
              dataKeys: Object.keys(binding.data)
            }))
          }
        })
      )
    })
  )
  const bundles = resolve(directory, ".alchemy/bundles")
  const modules = []
  for (const bundle of await readdir(bundles)) {
    for (const file of await readdir(resolve(bundles, bundle))) {
      const path = resolve(bundles, bundle, file)
      modules.push({
        path,
        sha256: createHash("sha256")
          .update(await readFile(path))
          .digest("hex")
      })
    }
  }
  await writeFile(
    resolve(directory, "manifest.json"),
    JSON.stringify(
      { output, bindings, modules, assets: process.env.ASSET_DIRECTORY, receipts },
      null,
      2
    )
  )
} finally {
  try {
    await run(Core.destroy(options, Stack, { scope }))
  } finally {
    try {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    } finally {
      if (sidecar) {
        await Effect.runPromise(sidecar.close)
      }
    }
  }
  await verifyClosed()
}
