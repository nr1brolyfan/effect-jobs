import { createServer, type RequestListener } from "node:http"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, mkdtemp, rm, mkdir } from "node:fs/promises"
import type { Browser } from "@playwright/test"

const playground = resolve(import.meta.dirname, "../../../playground")
const requireWorker = createRequire(
  resolve(playground, "../playground-worker/package.json")
)

// Vite's compiler runs in an awaited child, so its compiler services cannot
// outlive a Vitest worker. The parent owns output cleanup on every exit path.
const buildFixture = async (entry: string) => {
  await mkdir(resolve(process.cwd(), ".multica"), { recursive: true })
  const directory = await mkdtemp(resolve(process.cwd(), ".multica/typed-fixture-"))
  try {
    await promisify(execFile)(
      process.execPath,
      [resolve(playground, "tests/fixtures/BuildFixture.ts"), entry, directory],
      { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }
    )
    return {
      script: await readFile(resolve(directory, "Fixture.js")),
      css: await readFile(resolve(directory, "Jobs.css"))
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export const serve = async (listener: RequestListener) => {
  const server = createServer(listener)
  await new Promise<void>((done, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", done)
  })
  const address = server.address()
  if (address === null || typeof address === "string") {
    await new Promise<void>((done) => server.close(() => done()))
    throw new Error("Expected an ephemeral TCP fixture listener")
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((done, reject) => {
        server.close((error) => (error ? reject(error) : done()))
        server.closeAllConnections()
      })
  }
}

export const launch = async (): Promise<Browser> => {
  const { chromium } = requireWorker(
    "@playwright/test"
  ) as typeof import("@playwright/test")
  return chromium.launch({
    headless: true,
    ...(process.env.UI_CHROMIUM_PATH === undefined
      ? {}
      : { executablePath: process.env.UI_CHROMIUM_PATH })
  })
}

export const serveFixture = async (
  entry: string,
  mount: "fixture" | "jobs" = "fixture"
) => {
  const { script, css } = await buildFixture(entry)
  return serve((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname
    if (path === "/Fixture.js" || path === "/Jobs.css") {
      response.setHeader(
        "Content-Type",
        path.endsWith(".js") ? "text/javascript" : "text/css"
      )
      response.end(path.endsWith(".js") ? script : css)
    } else {
      response.setHeader("Content-Type", "text/html")
      response.end(
        '<!doctype html><html lang="en"><head><title>Typed component fixture</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/Jobs.css"></head><body>' +
          (mount === "fixture" ? '<div id="fixture"></div>' : '<main id="jobs"></main>') +
          '<script type="module" src="/Fixture.js"></script></body></html>'
      )
    }
  })
}
