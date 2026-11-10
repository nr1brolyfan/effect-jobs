import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/integration/worker-crash/*.integration.mjs"],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000
  }
})
