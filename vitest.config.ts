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
            "tests/poc/**",
            "apps/website/tests/ui/Field.test.mjs",
            "apps/website/tests/ui/Theme.test.mjs",
            "tests/benchmarks/postgresql/Support.test.mjs"
          ]
        }
      },
      ...websiteProjects(playwright())
    ]
  }
})
