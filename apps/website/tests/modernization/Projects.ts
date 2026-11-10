import { createRequire } from "node:module"
import { resolve } from "node:path"
import { defineProject } from "vitest/config"
import type { BrowserProviderOption } from "vitest/node"
import { unplugin as stylex } from "@stylexjs/unplugin"

const repository = resolve(import.meta.dirname, "../../../..")
const requireWorker = createRequire(
  resolve(repository, "apps/playground-worker/package.json")
)
const testDirectory = "apps/website/tests/modernization"

// Foundation registers these disjoint projects in the shared Vitest config.
// Library/benchmark/PG/native projects retain their existing owners and gates.
export const websiteProjects = (provider: BrowserProviderOption) => [
  defineProject({
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
    plugins: [
      stylex.vite({
        dev: false,
        runtimeInjection: false,
        treeshakeCompensation: true,
        unstable_moduleResolution: { type: "commonJS", rootDir: repository }
      })
    ],
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
