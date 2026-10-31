/* oxlint-disable effecttsgo/unstable-api-usage -- Owner-selected Atom API is pinned to Effect 4.0.0. */
import { Effect, Schema } from "effect"
import * as Atom from "effect/reactivity/Atom"
import type * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { JobState } from "effect-jobs/JobLifecycle"
import { JobId } from "effect-jobs/JobId"
import { Generation, type SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import type { Cursor, JobFilters } from "@effect-jobs/playground-contracts/Jobs"

export type JobMode = "private" | "demo"
export interface JobReturnContext {
  readonly sandbox: SandboxRef
  readonly filters: JobFilters
  readonly view: "jobs" | "problems"
  readonly pageSize: number
  readonly pageNumber: number
  readonly cursors: ReadonlyArray<Cursor | undefined>
  readonly scrollY: number
  readonly selectedJobId: JobId | null
}
export type JobRoute =
  | { readonly _tag: "List"; readonly mode: JobMode }
  | {
      readonly _tag: "Detail"
      readonly mode: JobMode
      readonly jobId: JobId
      readonly generation: number
    }
  | { readonly _tag: "Stale"; readonly mode: JobMode }
  | { readonly _tag: "Invalid"; readonly mode: JobMode }

const listPath = (mode: JobMode) => (mode === "demo" ? "/demo" : "/jobs")
const detailPrefix = (mode: JobMode) => (mode === "demo" ? "/demo/jobs/" : "/jobs/")
const sameScope = (a: SandboxRef, b: SandboxRef) =>
  a.sandboxId === b.sandboxId && a.generation === b.generation
const shareableFilterKeys = new Set(["state", "resolution", "needsAttention"])

export function listStateFilters(url: URL): JobFilters {
  const values = url.searchParams.getAll("state")
  const state = values[0]
  return values.length === 1 && Schema.is(JobState)(state) ? { state } : {}
}

export function detailPath(mode: JobMode, jobId: JobId, generation: number) {
  return `${detailPrefix(mode)}${encodeURIComponent(jobId)}?generation=${generation}`
}

export function readRoute(url: URL, mode: JobMode, sandbox: SandboxRef): JobRoute {
  if (url.pathname === listPath(mode)) {
    return { _tag: "List", mode }
  }
  const prefix = detailPrefix(mode)
  if (!url.pathname.startsWith(prefix)) {
    return { _tag: "Invalid", mode }
  }
  const segment = url.pathname.slice(prefix.length)
  if (segment.length === 0 || segment.includes("/")) {
    return { _tag: "Invalid", mode }
  }
  const decoded = Effect.runSync(
    Effect.try({
      try: () => decodeURIComponent(segment),
      catch: () => "invalid" as const
    }).pipe(Effect.option)
  )
  if (decoded._tag === "None" || !Schema.is(JobId)(decoded.value)) {
    return { _tag: "Invalid", mode }
  }
  const generations = url.searchParams.getAll("generation")
  const raw = generations[0]
  if (
    generations.length !== 1 ||
    !raw ||
    !/^[1-9][0-9]*$/.test(raw) ||
    !Schema.is(Generation)(Number(raw))
  ) {
    return { _tag: "Invalid", mode }
  }
  const generation = Number(raw)
  if (generation !== sandbox.generation) {
    return { _tag: "Stale", mode }
  }
  return { _tag: "Detail", mode, jobId: decoded.value, generation }
}

// Explicit projection prevents extra runtime fields (including payloads) from
// being retained even when a caller passes a wider object. One bounded anchor.
export function captureReturnContext(context: JobReturnContext): JobReturnContext {
  const filters = Object.fromEntries(
    Object.entries(context.filters).filter(([key]) => shareableFilterKeys.has(key))
  ) as JobFilters
  const bounded =
    context.filters.name === undefined &&
    context.cursors.length <= 100 &&
    Number.isInteger(context.pageNumber) &&
    context.pageNumber >= 1 &&
    context.pageNumber <= context.cursors.length
  return {
    sandbox: {
      sandboxId: context.sandbox.sandboxId,
      generation: context.sandbox.generation
    },
    filters,
    view: context.view,
    pageSize: context.pageSize,
    pageNumber: bounded ? context.pageNumber : 1,
    cursors: bounded ? [...context.cursors] : [undefined],
    scrollY:
      bounded && Number.isFinite(context.scrollY) ? Math.max(0, context.scrollY) : 0,
    selectedJobId: bounded ? context.selectedJobId : null
  }
}

const returnPath = (mode: JobMode, context: JobReturnContext) => {
  const params = new URLSearchParams({
    generation: String(context.sandbox.generation),
    view: context.view
  })
  for (const [key, value] of Object.entries(context.filters)) {
    if (shareableFilterKeys.has(key) && value !== undefined) {
      params.set(key, String(value))
    }
  }
  return `${listPath(mode)}?${params}`
}

export interface NavigationBrowser {
  readonly location: { readonly href: string }
  readonly history: Pick<History, "pushState" | "replaceState" | "back">
  readonly addEventListener: (type: "popstate" | "pagehide", listener: () => void) => void
  readonly removeEventListener: (
    type: "popstate" | "pagehide",
    listener: () => void
  ) => void
}
export interface NavigationBindings {
  readonly mode: JobMode
  readonly sandbox: () => SandboxRef
  readonly capture: () => JobReturnContext
  // Clear selected detail/payload BEFORE route publication or async reads.
  readonly relock: () => void
  readonly restore: (context: JobReturnContext | null, notice: string) => void
}

// Uses the dashboard's existing registry. No second registry, client or router.
// The host provides its Runtime Scope; finalization removes both DOM listeners.
export const make = (
  registry: AtomRegistry.AtomRegistry,
  browser: NavigationBrowser,
  bindings: NavigationBindings
) =>
  Effect.gen(function* () {
    // Normalize legacy dashboard controls on entry and every history navigation.
    // Keep state tabs and unrelated parameters; backend filtering is unchanged.
    const currentRoute = () => {
      const url = new URL(browser.location.href)
      const parsed = readRoute(url, bindings.mode, bindings.sandbox())
      if (
        parsed._tag === "List" &&
        (url.searchParams.has("name") || url.searchParams.has("due"))
      ) {
        url.searchParams.delete("name")
        url.searchParams.delete("due")
        browser.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
      }
      return parsed
    }
    const route = Atom.make<JobRoute>(currentRoute()).pipe(Atom.keepAlive)
    const returnContext = Atom.make<JobReturnContext | null>(null).pipe(Atom.keepAlive)
    let pushedFromList = false
    let disposed = false
    let detailScope = bindings.sandbox()
    let scopeRevoked = false
    let returnNotice = ""
    const publish = () => {
      if (disposed) {
        return
      }
      bindings.relock()
      const parsed = currentRoute()
      const next =
        parsed._tag === "Detail" &&
        (scopeRevoked || !sameScope(detailScope, bindings.sandbox()))
          ? { _tag: "Stale" as const, mode: bindings.mode }
          : parsed
      registry.set(route, next)
      if (next._tag === "List") {
        detailScope = bindings.sandbox()
        scopeRevoked = false
        const saved = registry.get(returnContext)
        const valid = saved !== null && sameScope(saved.sandbox, bindings.sandbox())
        bindings.restore(
          valid ? captureReturnContext(saved) : null,
          valid
            ? returnNotice
            : "Return context unavailable or stale. Showing the first page in this mode."
        )
        if (!valid) {
          registry.set(returnContext, null)
        }
        pushedFromList = false
      }
    }
    const clear = () => {
      bindings.relock()
      registry.set(returnContext, null)
      pushedFromList = false
      returnNotice = ""
    }
    const pagehide = () => {
      scopeRevoked = true
      clear()
      if (registry.get(route)._tag === "Detail") {
        registry.set(route, { _tag: "Stale", mode: bindings.mode })
      }
    }
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        browser.addEventListener("popstate", publish)
        browser.addEventListener("pagehide", pagehide)
      }),
      () =>
        Effect.sync(() => {
          disposed = true
          browser.removeEventListener("popstate", publish)
          browser.removeEventListener("pagehide", pagehide)
          clear()
        })
    )
    const openFull = (jobId: JobId) => {
      if (disposed) {
        return
      }
      const current = registry.get(route)
      if (
        current._tag !== "List" &&
        (current._tag !== "Detail" ||
          scopeRevoked ||
          !sameScope(detailScope, bindings.sandbox()))
      ) {
        return
      }
      bindings.relock()
      if (current._tag === "List") {
        const captured = bindings.capture()
        const context = captureReturnContext(captured)
        returnNotice =
          context.pageNumber === captured.pageNumber
            ? ""
            : "Saved page anchor no longer matches dashboard filters or bounded return history. Showing the first page."
        if (!sameScope(context.sandbox, bindings.sandbox())) {
          clear()
          return
        }
        registry.set(returnContext, context)
        browser.history.replaceState(null, "", returnPath(bindings.mode, context))
        browser.history.pushState(
          null,
          "",
          detailPath(bindings.mode, jobId, context.sandbox.generation)
        )
        pushedFromList = true
      } else {
        browser.history.replaceState(
          null,
          "",
          detailPath(bindings.mode, jobId, bindings.sandbox().generation)
        )
      }
      publish()
    }
    const related = (jobId: JobId) => {
      if (disposed || registry.get(route)._tag !== "Detail") {
        return
      }
      const current = registry.get(route)
      if (
        current._tag !== "Detail" ||
        current.generation !== bindings.sandbox().generation
      ) {
        clear()
        publish()
        return
      }
      openFull(jobId)
    }
    const close = () => {
      if (disposed) {
        return
      }
      bindings.relock()
      const saved = registry.get(returnContext)
      if (pushedFromList && saved && sameScope(saved.sandbox, bindings.sandbox())) {
        browser.history.back()
      } else {
        browser.history.replaceState(null, "", listPath(bindings.mode))
        publish()
      }
    }
    // Filtering replaces the current list anchor; it must not leave an older
    // status in the URL or in the in-memory target used by a later Back.
    const syncList = () => {
      if (disposed || registry.get(route)._tag !== "List" || scopeRevoked) {
        return
      }
      const context = captureReturnContext(bindings.capture())
      if (!sameScope(context.sandbox, bindings.sandbox())) {
        return
      }
      registry.set(returnContext, context)
      browser.history.replaceState(null, "", returnPath(bindings.mode, context))
    }
    // Call after sandbox replacement/expiry. A stale URL is never retargeted.
    const scopeChanged = () => {
      scopeRevoked = true
      clear()
      publish()
    }
    return { route, returnContext, openFull, related, close, syncList, scopeChanged }
  })

// Host calls this after restored rows commit (useLayoutEffect), once. If cursor
// repair loses the anchor, pass null and focus the list's safe fallback.
export function restoreViewport(
  context: JobReturnContext | null,
  document: Document,
  browser: Pick<Window, "scrollTo">
) {
  const selected = context?.selectedJobId
  const target =
    selected === null || selected === undefined
      ? undefined
      : Array.from(document.querySelectorAll<HTMLElement>("[data-job-id]")).find(
          (node) => node.dataset.jobId === selected
        )
  const focus =
    target ?? document.querySelector<HTMLElement>("[data-jobs-focus-fallback]")
  focus?.focus({ preventScroll: true })
  browser.scrollTo({ top: context?.scrollY ?? 0, behavior: "instant" })
}
