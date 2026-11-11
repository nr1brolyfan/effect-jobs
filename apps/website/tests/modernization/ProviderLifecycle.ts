// Finite host/resource qualification. Run with the pinned Node release.
import assert from "node:assert/strict"
import { createHook } from "node:async_hooks"
import { execFile } from "node:child_process"
import { mkdir, writeFile, readdir } from "node:fs/promises"
import { promisify } from "node:util"
import { resolve } from "node:path"

const evidence = resolve(".multica/test-continuation")
await mkdir(evidence, { recursive: true })
if (!process.argv.includes("--child")) {
  const directory = "apps/website/tests/modernization"
  const files = (await readdir(directory)).sort()
  // Preserve the original complete 24-test, three-project host qualification.
  // New adapter waves receive their own complete finite host lifetimes.
  const originalE2e = new Set([
    "Browser.e2e.ts",
    "Dashboard.e2e.ts",
    "Details.e2e.ts",
    "Installed.e2e.ts"
  ])
  const partitions = [
    files.filter(
      (file) =>
        file.endsWith(".unit.ts") ||
        file.endsWith(".browser.tsx") ||
        originalE2e.has(file)
    ),
    ...files
      .filter((file) => file.endsWith(".e2e.ts") && !originalE2e.has(file))
      .map((file) => [file])
  ].map((group) => group.map((file) => `${directory}/${file}`))
  const results = []
  for (const [index, partition] of partitions.entries()) {
    let stdout = "",
      stderr = "",
      exitCode = 0
    try {
      const result = await promisify(execFile)(
        process.execPath,
        [import.meta.filename, "--child", ...partition],
        {
          timeout: 120_000,
          maxBuffer: 16 * 1024 * 1024
        }
      )
      stdout = result.stdout
      stderr = result.stderr
    } catch (caught) {
      const error = caught as Error & { stdout?: string; stderr?: string; code?: number }
      stdout = error.stdout ?? ""
      stderr = error.stderr ?? ""
      exitCode = error.code ?? -1
    }
    await writeFile(resolve(evidence, `provider-partition-${index}.log`), stdout + stderr)
    results.push({
      partition,
      exitCode,
      resourcesReleased: stdout.includes("PROVIDER_RESOURCES_RELEASED"),
      closeWarning: /close timed out|error during close/.test(stdout + stderr)
    })
  }
  await writeFile(
    resolve(evidence, "provider-partitions.json"),
    JSON.stringify(results, null, 2) + "\n"
  )
  assert(
    results.every((result) => result.resourcesReleased && !result.closeWarning),
    "Every complete partition must close resources and exit naturally within the unchanged bound"
  )
  console.log(
    "All three projects, every test file: explicit close, resource absence and natural child exit PASS"
  )
  assert(
    results.every((result) => result.exitCode === 0),
    "Test failures remain failures; inspect provider-partitions.json"
  )
} else {
  const timers = new Map<number, { readonly hasRef: () => boolean }>()
  const hook = createHook({
    init(id, type, _trigger, resource: unknown) {
      if (type === "Timeout") {
        timers.set(id, resource as { readonly hasRef: () => boolean })
      }
    },
    destroy(id) {
      timers.delete(id)
    }
  }).enable()
  const { createVitest } = await import("vitest/node")
  const host = await createVitest("test", {
    run: true,
    project: ["website-unit", "website-browser", "website-e2e"],
    reporters: ["default"]
  })
  let failure: unknown
  const selectedFiles = process.argv.slice(process.argv.indexOf("--child") + 1)
  assert(selectedFiles.length > 0)
  try {
    const result = await host.start(selectedFiles)
    assert.deepEqual(
      result.testModules.map((module) => module.moduleId).sort(),
      selectedFiles.map((file) => resolve(file)).sort(),
      "Every selected test module must execute"
    )
    assert.deepEqual(result.unhandledErrors, [])
    for (const module of result.testModules) {
      assert.equal(module.state(), "passed", module.moduleId)
    }
    assert.equal(process.exitCode ?? 0, 0)
  } catch (error) {
    failure = error
  } finally {
    await host.close()
  }
  // Two event-loop turns let native close/destroy callbacks complete. No timeout,
  // force-exit, GC, unref or framework warning suppression participates.
  await new Promise<void>((done) => setImmediate(done))
  await new Promise<void>((done) => setImmediate(done))
  const resources = process.getActiveResourcesInfo().filter((type) => type !== "PipeWrap")
  assert.deepEqual(resources, [])
  assert.equal([...timers.values()].filter((timer) => timer.hasRef()).length, 0)
  hook.disable()
  await writeFile(
    resolve(evidence, `provider-resources-${process.pid}.json`),
    JSON.stringify({ resources, referencedTimers: 0, node: process.version }, null, 2) +
      "\n"
  )
  console.log("PROVIDER_RESOURCES_RELEASED")
  if (failure !== undefined) {
    throw failure
  }
}
