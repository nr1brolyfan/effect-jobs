import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const require = createRequire(import.meta.url)

export default defineConfig({
  resolve: {
    alias: {
      pg: fileURLToPath(new URL("../../node_modules/pg/lib/index.js", import.meta.url)),
      "drizzle-orm/pg-core": require.resolve("drizzle-orm/pg-core"),
      "drizzle-orm": require.resolve("drizzle-orm")
    }
  },
  test: { include: ["tests/postgresql/**/*.test.ts"] }
})
