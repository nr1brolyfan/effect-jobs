import type { AstroIntegration } from "astro"
import { createHash } from "node:crypto"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// Build tooling: hash the final HTML, including Starlight/Expressive Code scripts.
// The assets-only Worker enforces this policy through Cloudflare's _headers file.
export const productionAssets = (): AstroIntegration => ({
  name: "effect-jobs-production-assets",
  hooks: {
    "astro:build:done": async (options) => {
      const directory = fileURLToPath(options.dir)
      const files = await readdir(directory, { recursive: true })
      // The existing extraction target contains shared ShellStyles as well as
      // illustration styles. Pages without an illustration still need it.
      const sharedStyles = files.filter((file) =>
        /^_astro\/Playback\.[^/]+\.css$/.test(file)
      )
      if (sharedStyles.length !== 1) {
        throw new Error("Expected one shared StyleX extraction stylesheet")
      }
      const sharedHref = `/${sharedStyles[0]}`
      const hashes = new Set<string>()
      for (const file of files.filter((file) => file.endsWith(".html"))) {
        let html = await readFile(join(directory, file), "utf8")
        if (!html.includes(`href="${sharedHref}"`)) {
          html = html.replace(
            "</head>",
            `<link rel="stylesheet" href="${sharedHref}"></head>`
          )
          await writeFile(join(directory, file), html)
        }
        for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
          if (!/\bsrc\s*=/.test(script[1]!) && script[2]) {
            hashes.add(
              `'sha256-${createHash("sha256").update(script[2]).digest("base64")}'`
            )
          }
        }
      }
      const policy = [
        "default-src 'self'",
        `script-src 'self' 'wasm-unsafe-eval' ${[...hashes].sort().join(" ")}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'none'"
      ].join("; ")
      // Cloudflare limits a header rule line to 2,000 characters. Fail the build
      // if future inline scripts exceed it rather than silently relaxing CSP.
      if (policy.length + 27 > 2000) {
        throw new Error("Static CSP exceeds header limit")
      }
      await writeFile(
        join(directory, "_headers"),
        `/*\n  Content-Security-Policy: ${policy}\n` +
          "  X-Content-Type-Options: nosniff\n" +
          "  Referrer-Policy: strict-origin-when-cross-origin\n" +
          "  X-Frame-Options: DENY\n" +
          "  Permissions-Policy: camera=(), microphone=(), geolocation=()\n" +
          "  Strict-Transport-Security: max-age=31536000\n" +
          "  Cache-Control: public, max-age=0, must-revalidate\n" +
          "/_astro/*\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable\n"
      )
    }
  }
})
