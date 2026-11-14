import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { extname, resolve } from "node:path"
import * as StaticAssets from "../src/assets/StaticAssets.js"

// An exact index alias needs no second identical header declaration when its
// canonical wildcard already covers it. Never remove a conflicting override.
export const compactHeaderPolicies = (policies: ReadonlySet<string>) => {
  const rules = [...policies].map((policy) => {
    const newline = policy.indexOf("\n")
    return { policy, route: policy.slice(0, newline), headers: policy.slice(newline) }
  })
  return rules
    .filter((rule) => {
      if (rule.route === "/index.html" || !rule.route.endsWith("/index.html")) {
        return true
      }
      const canonical = rule.route.slice(0, -11) + "*"
      const covering = rules.find(
        (other) => other.route === canonical && other.headers === rule.headers
      )
      if (!covering) {
        return true
      }
      return rules.some((other) => {
        // Output is sorted: broader rules before the canonical rule are already
        // overridden. A later conflicting match still needs the exact alias rule.
        if (other.headers === rule.headers || other.policy < covering.policy) {
          return false
        }
        const wildcard = other.route.indexOf("*")
        return wildcard === -1
          ? other.route === rule.route
          : rule.route.startsWith(other.route.slice(0, wildcard)) &&
              rule.route.endsWith(other.route.slice(wildcard + 1))
      })
    })
    .map((rule) => rule.policy)
}

// Preserve the test-owned dashboard bytes until its owner moves the source.
// Refuse a changed declaration instead of silently staging a second template.
export const stage = async (root: string, directory: string) => {
  const source = await readFile(
    resolve(root, "apps/playground-worker/tests/integration/Local.ts"),
    "utf8"
  )
  const page = source.match(/const page =\s*'([^'\n]+)'\s*const assets:/)?.[1]
  if (!page?.startsWith("<!doctype html>")) {
    throw new Error("Expected the existing dashboard HTML declaration in Local.ts")
  }
  const siteDirectory = resolve(root, "apps/website/dist/site")
  const dashboard: Parameters<typeof StaticAssets.createAssets>[0]["dashboard"] = {
    "/jobs": [page, "text/html"],
    "/demo": [page, "text/html"],
    "/Client.js": [
      await readFile(resolve(root, "apps/playground/dist/Client.js")),
      "text/javascript"
    ],
    "/Jobs.css": [
      await readFile(resolve(root, "apps/playground/dist/Jobs.css")),
      "text/css"
    ]
  }
  const serve = StaticAssets.createAssets({ siteDirectory, dashboard })
  const paths = new Set([
    ...StaticAssets.loadSite(siteDirectory).keys(),
    ...Object.keys(dashboard)
  ])
  const headers: string[] = [
    "/*",
    "  cache-control: no-store",
    "  x-content-type-options: nosniff",
    ""
  ]
  const redirects: string[] = []
  const manifest = []
  const policies = new Set<string>()
  for (const path of [...paths].sort()) {
    // Native platform configuration is generated below, not a public payload.
    if (path === "/_headers" || path === "/_redirects") {
      continue
    }
    const response = serve(new Request("http://localhost" + path))
    if (response.status !== 200) {
      continue
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    const html = response.headers.get("content-type")!.startsWith("text/html")
    const digest = createHash("sha256").update(bytes).digest("hex")
    const file = html ? `_pages/${digest}.html` : path.slice(1)
    const target = resolve(directory, file)
    await mkdir(resolve(target, ".."), { recursive: true })
    await writeFile(target, bytes)
    const routes = html ? [path, `/_pages/${digest}*`] : [path]
    if (html) {
      redirects.push(`${path} /_pages/${digest} 200`)
      if (path !== "/" && !path.endsWith(".html")) {
        redirects.push(`${path}/ /_pages/${digest} 200`)
        routes[0] = path + "*"
      }
    }
    // Native _headers has a 100-rule bound. Non-HTML site files share policy
    // and MIME by extension; HTML keeps its exact final-byte inline hashes.
    if (!html && dashboard[path] === undefined) {
      // Extensionless control/asset names must stay exact: slicing at -1 would
      // turn /_headers into /*s and overwrite JavaScript's MIME policy.
      const extension = extname(path)
      routes[0] = extension ? "/*" + extension : path
    }
    for (const route of routes) {
      const policy = [
        route,
        "  ! content-security-policy",
        "  ! content-type",
        ...Array.from(response.headers)
          .filter(
            (entry) =>
              entry[0] !== "cache-control" && entry[0] !== "x-content-type-options"
          )
          .map((entry) => `  ${entry[0]}: ${entry[1]}`),
        ""
      ].join("\n")
      if (!policies.has(policy)) {
        policies.add(policy)
      }
    }
    manifest.push({
      path,
      file,
      sha256: digest,
      headers: Object.fromEntries(response.headers)
    })
  }
  const compactPolicies = compactHeaderPolicies(policies)
  if (compactPolicies.length + 1 > 100) {
    throw new Error("Staged assets exceed the native 100-rule header bound")
  }
  headers.push(...compactPolicies.sort())
  await writeFile(resolve(directory, "_headers"), headers.join("\n"))
  await writeFile(resolve(directory, "_redirects"), redirects.join("\n") + "\n")
  return manifest
}
