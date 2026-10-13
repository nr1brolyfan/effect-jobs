/* oxlint-disable effecttsgo/unstable-api-usage -- Owner-selected Atom API is pinned to Effect 4.0.0. */
import { describe, expect, it } from "vitest"
import { Effect, Exit, Schema, Scope } from "effect"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import { JobId } from "effect-jobs/JobId"
import * as Navigation from "../../../src/features/jobs/details/Navigation.js"

const sandbox = Schema.decodeSync(SandboxRef)({ sandboxId: "synthetic", generation: 2 })
const jobId = Schema.decodeSync(JobId)("job a/#%")
const context: Navigation.JobReturnContext = {
  sandbox,
  filters: { state: "Dead", kind: "synthetic.kind" },
  view: "jobs",
  pageSize: 20,
  pageNumber: 3,
  cursors: [undefined, "cursor-two", "cursor-three"],
  scrollY: 650,
  selectedJobId: jobId
}

function browser(initial = "https://example.test/jobs") {
  const location = { href: initial }
  const listeners = new Map<string, Set<() => void>>()
  const entries = [initial]
  const states: unknown[] = []
  let index = 0
  const emit = (type: string) => listeners.get(type)?.forEach((fn) => fn())
  return {
    location,
    states,
    listeners,
    emit,
    history: {
      pushState: (state: unknown, _unused: string, url?: string | URL | null) => {
        states.push(state)
        entries.splice(index + 1)
        entries.push(new URL(String(url), location.href).href)
        index++
        location.href = entries[index]!
      },
      replaceState: (state: unknown, _unused: string, url?: string | URL | null) => {
        states.push(state)
        entries[index] = new URL(String(url), location.href).href
        location.href = entries[index]!
      },
      back: () => {
        if (index > 0) {
          index--
          location.href = entries[index]!
          emit("popstate")
        }
      }
    },
    addEventListener: (type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener)
    }
  }
}

describe("detail navigation in the existing Atom registry", () => {
  it("parses encoded identities and refuses missing, repeated, foreign-mode or stale generations", () => {
    expect(
      Navigation.readRoute(
        new URL(Navigation.detailPath("private", jobId, 2), "https://example.test"),
        "private",
        sandbox
      )
    ).toEqual({ _tag: "Detail", mode: "private", jobId, generation: 2 })
    for (const path of [
      "/jobs/x",
      "/jobs/%zz?generation=2",
      "/jobs/x/y?generation=2",
      "/jobs/x?generation=2&generation=2",
      "/jobs/x?generation=2e0",
      "/demo/jobs/x?generation=2",
      "/jobs/x?generation=9007199254740992"
    ]) {
      expect(
        Navigation.readRoute(new URL(path, "https://example.test"), "private", sandbox)
          ._tag
      ).toBe("Invalid")
    }
    expect(
      Navigation.readRoute(
        new URL("https://example.test/jobs/x?generation=1"),
        "private",
        sandbox
      )._tag
    ).toBe("Stale")
  })

  it("preserves filters/cursors/page/scroll in memory and restores them after related navigation and Back", () => {
    const port = browser()
    const registry = AtomRegistry.make()
    const scope = Scope.makeUnsafe()
    const restored: Array<Navigation.JobReturnContext | null> = []
    let relocks = 0
    const nav = Effect.runSync(
      Navigation.make(registry, port, {
        mode: "private",
        sandbox: () => sandbox,
        capture: () => context,
        relock: () => {
          relocks++
        },
        restore: (saved) => restored.push(saved)
      }).pipe(Scope.provide(scope))
    )
    try {
      nav.openFull(jobId)
      expect(registry.get(nav.returnContext)).toEqual(context)
      expect(port.location.href).toContain("/jobs/job%20a%2F%23%25?generation=2")
      nav.related(Schema.decodeSync(JobId)("successor"))
      expect(port.location.href).toContain("/jobs/successor?generation=2")
      nav.close()
      expect(restored).toEqual([context])
      expect(new URL(port.location.href).searchParams.get("state")).toBe("Dead")
      expect(registry.get(nav.route)._tag).toBe("List")
      expect(port.states.every((state) => state === null)).toBe(true)
      expect(port.location.href).not.toContain("cursor")
      expect(relocks).toBeGreaterThanOrEqual(4)
    } finally {
      Effect.runSync(Scope.close(scope, Exit.void))
      registry.dispose()
    }
    expect(port.listeners.get("popstate")?.size).toBe(0)
    expect(port.listeners.get("pagehide")?.size).toBe(0)
  })

  it("direct demo links return to demo and stale scopes clear anchors without retargeting jobs", () => {
    const port = browser("https://example.test/demo/jobs/source?generation=2")
    const registry = AtomRegistry.make()
    const scope = Scope.makeUnsafe()
    let current = sandbox
    let restored: Navigation.JobReturnContext | null | undefined
    const nav = Effect.runSync(
      Navigation.make(registry, port, {
        mode: "demo",
        sandbox: () => current,
        capture: () => context,
        relock: () => undefined,
        restore: (value) => {
          restored = value
        }
      }).pipe(Scope.provide(scope))
    )
    try {
      nav.close()
      expect(port.location.href).toBe("https://example.test/demo")
      expect(restored).toBeNull()
      nav.openFull(jobId)
      current = { ...sandbox, generation: 3 }
      nav.scopeChanged()
      expect(registry.get(nav.returnContext)).toBeNull()
      expect(registry.get(nav.route)._tag).toBe("Stale")
      nav.related(jobId)
      expect(port.location.href).toContain("generation=2")
      nav.close()
      expect(port.location.href).toBe("https://example.test/demo")
      port.emit("pagehide")
      expect(registry.get(nav.returnContext)).toBeNull()
    } finally {
      Effect.runSync(Scope.close(scope, Exit.void))
      registry.dispose()
    }
  })

  it("projects return state and bounds stale deep-page recovery without retaining payloads", () => {
    const wide = {
      ...context,
      payload: "sensitive",
      filters: { ...context.filters, plaintext: "sensitive" },
      cursors: Array.from({ length: 101 }, () => "cursor"),
      pageNumber: 101
    }
    const saved = Navigation.captureReturnContext(wide)
    expect(saved).not.toHaveProperty("payload")
    expect(saved.filters).not.toHaveProperty("plaintext")
    expect(saved.pageNumber).toBe(1)
    expect(saved.cursors).toEqual([undefined])
    wide.cursors[0] = "changed"
    expect(saved.cursors).toEqual([undefined])
  })

  it("revokes same-generation sandbox replacements and pagehide without exposing detail slots", () => {
    const port = browser("https://example.test/jobs/source?generation=2")
    const registry = AtomRegistry.make()
    const scope = Scope.makeUnsafe()
    let current = sandbox
    const nav = Effect.runSync(
      Navigation.make(registry, port, {
        mode: "private",
        sandbox: () => current,
        capture: () => context,
        relock: () => undefined,
        restore: () => undefined
      }).pipe(Scope.provide(scope))
    )
    try {
      current = Schema.decodeSync(SandboxRef)({
        sandboxId: "another-sandbox",
        generation: 2
      })
      nav.scopeChanged()
      expect(registry.get(nav.route)._tag).toBe("Stale")
      nav.openFull(jobId)
      expect(port.location.href).toBe("https://example.test/jobs/source?generation=2")
      port.emit("popstate")
      expect(registry.get(nav.route)._tag).toBe("Stale")
      nav.close()
      current = sandbox
      nav.openFull(jobId)
      port.emit("pagehide")
      expect(registry.get(nav.route)._tag).toBe("Stale")
      expect(registry.get(nav.returnContext)).toBeNull()
    } finally {
      Effect.runSync(Scope.close(scope, Exit.void))
      registry.dispose()
    }
    const before = port.location.href
    nav.openFull(jobId)
    nav.close()
    expect(port.location.href).toBe(before)
  })
})
