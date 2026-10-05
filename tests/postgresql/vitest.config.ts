import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "drizzle-orm/pg-core": fileURLToPath(
        new URL("./node_modules/drizzle-orm/pg-core/index.js", import.meta.url)
      ),
      "drizzle-orm": fileURLToPath(
        new URL("./node_modules/drizzle-orm/index.js", import.meta.url)
      )
    }
  },
  test: { include: ["tests/postgresql/*.test.ts"] }
})
