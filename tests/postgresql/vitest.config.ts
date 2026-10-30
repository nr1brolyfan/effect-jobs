import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      pg: fileURLToPath(new URL("../../node_modules/pg/lib/index.js", import.meta.url)),
      "drizzle-orm/pg-core": fileURLToPath(import.meta.resolve("drizzle-orm/pg-core")),
      "drizzle-orm": fileURLToPath(import.meta.resolve("drizzle-orm"))
    }
  },
  test: { include: ["tests/postgresql/**/*.test.ts"] }
})
