import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

const root = fileURLToPath(new URL("../", import.meta.url))

// Only these proven untracked runtime artifacts are excluded. If one becomes
// project-owned, remove its exclusion rather than silently waiving its check.
const runtimeArtifacts = [
  ".multica/daemon_task_context.json",
  ".multica/project/resources.json",
  ".opencode/skills/multica-platform/SKILL.md",
  ".opencode/skills/multica-platform/references/agents.md",
  ".opencode/skills/multica-platform/references/issues.md",
  ".opencode/skills/multica-platform/references/mentions.md",
  ".opencode/skills/multica-platform/references/skill-import.md",
  "AGENTS.md"
]

it("keeps runtime formatter exclusions exact and disjoint from tracked files", () => {
  const config: { readonly ignorePatterns: ReadonlyArray<string> } = JSON.parse(
    readFileSync(new URL("../.oxfmtrc.json", import.meta.url), "utf8")
  )
  expect(config.ignorePatterns).toEqual([
    "**/node_modules/**",
    "**/dist/**",
    "**/coverage/**",
    "**/.toolchain/**",
    "**/bun.lock",
    ...runtimeArtifacts.map((path) => `/${path}`)
  ])

  // Git is an intentional test-tool FFI boundary, not application logic.
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000
  })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
  const tracked = new Set(result.stdout.split("\0"))
  for (const path of runtimeArtifacts) {
    expect(tracked.has(path), `tracked file must not be excluded: ${path}`).toBe(false)
  }
})
