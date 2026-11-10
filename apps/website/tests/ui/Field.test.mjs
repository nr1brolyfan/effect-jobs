// Compatibility for the root script. The real Field assertions run in Chromium.
import { execFileSync } from "node:child_process"
execFileSync(
  "node",
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--project",
    "website-browser",
    "apps/website/tests/modernization/Field.browser.tsx"
  ],
  { stdio: "inherit", timeout: 120_000 }
)
