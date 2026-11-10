// Finite host/resource qualification. Run with the pinned Node release.
import assert from "node:assert/strict"
import { createHook } from "node:async_hooks"
import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { promisify } from "node:util"
import { resolve } from "node:path"

const evidence = resolve(".multica/test-continuation")
await mkdir(evidence, { recursive: true })
if (!process.argv.includes("--child")) {
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    [import.meta.filename, "--child"],
    {
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024
    }
  )
  await writeFile(resolve(evidence, "provider-lifecycle.log"), stdout + stderr)
  assert.match(stdout, /PROVIDER_RESOURCES_RELEASED/)
  assert.doesNotMatch(stdout + stderr, /close timed out|error during close/)
  console.log(
    "Provider tests, explicit close, resource absence and natural child exit PASS"
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
  try {
    const result = await host.start()
    assert(result.testModules.length > 0)
    assert.deepEqual(result.unhandledErrors, [])
    for (const module of result.testModules) {
      assert.equal(module.state(), "passed", module.moduleId)
    }
    assert.equal(process.exitCode ?? 0, 0)
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
    resolve(evidence, "provider-resources.json"),
    JSON.stringify({ resources, referencedTimers: 0, node: process.version }, null, 2) +
      "\n"
  )
  console.log("PROVIDER_RESOURCES_RELEASED")
}
