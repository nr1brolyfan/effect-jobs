// Local workerd FFI. All inputs are fresh synthetic configuration; no .env access.
import { Miniflare, convertV4MiniflareOptions } from "miniflare"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createServer } from "node:net"
const root = resolve(import.meta.dirname, "../../../..")
export const reservePort = () =>
  new Promise((done, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port
      server.close(() => done(port))
    })
  })
export const createLocal = async (
  cfg,
  { instrument = false, https = true, demoRotationMillis = 86400000 } = {}
) => {
  const port = await reservePort()
  const origin = `${https ? "https" : "http"}://127.0.0.1:${port}`
  const page =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Effect Jobs Playground</title><link rel="stylesheet" href="/Jobs.css"></head><body><main id="jobs"></main><script type="module" src="/Client.js"></script></body></html>'
  const assets = {
    "/": [page, "text/html"],
    "/jobs": [page, "text/html"],
    "/demo": [page, "text/html"],
    "/Client.js": [
      readFileSync(`${root}/apps/website/dist/Client.js`),
      "text/javascript"
    ],
    "/Jobs.css": [readFileSync(`${root}/apps/website/src/styles/Jobs.css`), "text/css"],
    "/docs/jobs": [
      readFileSync(`${root}/apps/website/content/docs/Jobs.html`),
      "text/html"
    ]
  }
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      host: "127.0.0.1",
      port,
      https,
      modules: true,
      script: readFileSync(
        instrument
          ? `${root}/.multica/integration/TestWorker.js`
          : `${root}/apps/playground-worker/dist/Worker.js`,
        "utf8"
      ),
      compatibilityDate: "2026-10-01",
      compatibilityFlags: ["nodejs_compat"],
      durableObjects: Object.fromEntries(
        [
          "Gateway",
          "Communications",
          "Media",
          "Commerce",
          "Private",
          "SandboxLive",
          "DemoGenerator"
        ].map((className, index) => [
          ["GATEWAY", "COMMUNICATIONS", "MEDIA", "COMMERCE", "PRIVATE", "LIVE", "DEMO"][
            index
          ],
          {
            className:
              instrument && index > 0 && index < 5 ? className + "Probe" : className,
            useSQLite: true
          }
        ])
      ),
      durableObjectsPersist: false,
      hyperdrives: { PG: cfg.connectionString },
      bindings: {
        ORIGIN: origin,
        DEMO_ROTATION_MS: String(demoRotationMillis),
        SCHEMA: cfg.schema,
        ENCRYPTION_KEY: cfg.encryptionKey,
        FINGERPRINT_KEY: cfg.fingerprintKey,
        CURSOR_KEY: cfg.cursorKey
      },
      serviceBindings: {
        ASSETS: (request) => {
          const entry = assets[new URL(request.url).pathname]
          return entry
            ? new Response(entry[0], {
                headers: {
                  "Content-Type": entry[1],
                  "Cache-Control": "no-store",
                  "Content-Security-Policy":
                    "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'",
                  "X-Content-Type-Options": "nosniff"
                }
              })
            : new Response("Not found", { status: 404 })
        }
      },
      outboundService: () => new Response("Outbound HTTP denied", { status: 403 })
    })
  )
  await mf.ready
  return { mf, origin }
}
