import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

// Shared root/app registrars remain owned by foundation. These temporary CLI
// aliases retain existing invocations, including the website workspace cwd.
export const runProjectTests = (project: string, files: string[]) => {
  const root = resolve(import.meta.dirname, "../../../..")
  execFileSync(
    process.execPath,
    [
      resolve(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "--project",
      project,
      ...files
    ],
    { cwd: root, stdio: "inherit" }
  )
}
