import { defineConfig, configDefaults } from "vitest/config"
import { playwright } from "@vitest/browser-playwright"
import { websiteProjects } from "./apps/website/tests/modernization/Projects.js"

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "workspace",
          exclude: [
            ...configDefaults.exclude,
            ".toolchain/**",
            ".multica/**",
            "apps/playground-worker/tests/native/**",
            "tests/poc/**",
            "tests/benchmarks/postgresql/Support.test.mjs"
          ]
        }
      },
      ...websiteProjects(playwright())
    ]
  }
})
