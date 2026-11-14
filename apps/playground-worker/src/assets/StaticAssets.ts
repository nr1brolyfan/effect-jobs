// Local HTTP asset FFI. Build output only, never source directories or environment.
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { resolve, extname, relative } from "node:path"

type Asset = readonly [string | Uint8Array<ArrayBuffer>, string]
interface AssetsOptions {
  readonly siteDirectory: string
  readonly dashboard: Readonly<Record<string, Asset>>
}

const types: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/vnd.microsoft.icon",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm"
}
const dashboardPolicy =
  "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'"
// Hash the final HTML bytes, including Starlight's inline initialization scripts.
// The dashboard retains its separate existing policy. Site content is trusted build input.
const sitePolicy = (entry: Asset) => {
  const hashes = entry[1].startsWith("text/html")
    ? Array.from(
        entry[0].toString().matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi),
        (match) =>
          "'sha256-" + createHash("sha256").update(match[1]!).digest("base64") + "'"
      )
    : []
  return (
    "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; script-src 'self' 'wasm-unsafe-eval' " +
    hashes.join(" ") +
    "; style-src 'self' 'unsafe-inline'"
  )
}
export const loadSite = (directory: string) => {
  const entries = new Map<string, Asset>()
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = resolve(current, entry.name)
      if (entry.isDirectory()) {
        walk(file)
      } else if (entry.isFile()) {
        const path = "/" + relative(directory, file).split("\\").join("/")
        const value: Asset = [
          readFileSync(file),
          types[extname(file)] ?? "application/octet-stream"
        ]
        entries.set(path, value)
        if (path.endsWith("/index.html")) {
          entries.set(path.slice(0, -11) || "/", value)
        } else if (path.endsWith(".html") && path !== "/404.html") {
          entries.set(path.slice(0, -5), value)
        }
      }
    }
  }
  walk(resolve(directory))
  return entries
}
export const createAssets = (options: AssetsOptions) => {
  const site = loadSite(resolve(options.siteDirectory))
  return (request: Request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405 })
    }
    const path = new URL(request.url).pathname.replace(/\/$/, "") || "/"
    // Dashboard and API routes can never fall through to a site asset.
    const reservedPath = ["/jobs", "/api", "/demo"].some(
      (prefix) =>
        path === prefix || path === prefix + ".html" || path.startsWith(prefix + "/")
    )
    const dashboard = options.dashboard[path]
    const entry = dashboard ?? (reservedPath ? undefined : site.get(path))
    if (!entry) {
      return new Response("Not found", { status: 404 })
    }
    return new Response(request.method === "HEAD" ? null : entry[0], {
      headers: {
        "Content-Type": entry[1],
        "Cache-Control": "no-store",
        "Content-Security-Policy": dashboard ? dashboardPolicy : sitePolicy(entry),
        "X-Content-Type-Options": "nosniff"
      }
    })
  }
}
