import { createRequire } from "node:module"
import { resolve } from "node:path"
import { defineProject } from "vitest/config"
import type { BrowserProviderOption } from "vitest/node"
import { unplugin as stylex } from "@stylexjs/unplugin"
import type { Plugin } from "vite"

const repository = resolve(import.meta.dirname, "../../../..")
const requireWorker = createRequire(
  resolve(repository, "apps/playground-worker/package.json")
)
const testDirectory = "apps/website/tests/modernization"

// StyleX 0.19.1 installs its CSS-update interval in configureServer and
// finalizes it only on httpServer.close. Vitest also creates a middleware-only
// transform server (httpServer === null). It has no HTTP/CSS endpoint to poll.
// Keep the original hook on the real browser server and its real close event.
const fixtureStyles = (): Plugin => {
  const plugin = stylex.vite({
    dev: false,
    runtimeInjection: false,
    treeshakeCompensation: true,
    unstable_moduleResolution: { type: "commonJS", rootDir: repository }
  }) as Plugin
  const configure = plugin.configureServer
  return {
    ...plugin,
    configureServer(server) {
      if (server.httpServer === null || configure === undefined) {
        return
      }
      const handler = typeof configure === "function" ? configure : configure.handler
      return handler.call(this, server)
    }
  }
}

// Foundation registers these disjoint projects in the shared Vitest config.
// Library/benchmark/PG/native projects retain their existing owners and gates.
export const websiteProjects = (provider: BrowserProviderOption) => [
  defineProject({
    plugins: [fixtureStyles()],
    resolve: { dedupe: ["react", "react-dom"] },
    test: {
      name: "website-unit",
      environment: "node",
      include: [`${testDirectory}/*.unit.ts`]
    }
  }),
  defineProject({
    resolve: { alias: { "@playwright/test": requireWorker.resolve("@playwright/test") } },
    test: {
      name: "website-e2e",
      environment: "node",
      include: [`${testDirectory}/*.e2e.ts`],
      fileParallelism: false,
      hookTimeout: 120_000,
      testTimeout: 90_000
    }
  }),
  defineProject({
    resolve: { dedupe: ["react", "react-dom"] },
    plugins: [fixtureStyles()],
    test: {
      name: "website-browser",
      include: [`${testDirectory}/*.browser.tsx`],
      browser: {
        enabled: true,
        headless: true,
        provider,
        instances: [{ browser: "chromium" }]
      }
    }
  })
]
