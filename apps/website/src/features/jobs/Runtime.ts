import * as Atom from "effect/reactivity/Atom"
import * as Navigation from "./details/Navigation.js"
/* oxlint-disable effecttsgo/unstable-api-usage -- Owner-selected Atom API is pinned to Effect 4.0.0. */
import { Effect, Exit, Fiber, Scope } from "effect"
import type { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import { JobsClient, type Client } from "./Adapter.js"
import * as Atoms from "./Atoms.js"
import * as Live from "../../live/BrowserLive.js"

export interface Options {
  readonly poll?: boolean
  readonly demo?: boolean
  readonly liveUrl?: string
}

// Browser callbacks are the FFI boundary. One Scope owns every operation,
// subscription, socket, event listener and timer for this mounted dashboard.
export const make = (client: Client, sandbox: SandboxView, options: Options = {}) => {
  const state = Atoms.make(sandbox, options.demo === true)
  state.registry.set(now, Date.now())
  const scope = Scope.makeUnsafe()
  let closed = false
  let closing: Promise<void> | undefined
  const run = (operation: Effect.Effect<void, never, JobsClient>) => {
    if (closed) {
      return Promise.resolve()
    }
    return Effect.runPromiseExit(
      operation.pipe(
        Effect.provideService(JobsClient, client),
        Effect.catchCause(() =>
          Effect.sync(() => {
            if (closed) {
              return
            }
            state.connection("error")
            state.registry.set(
              state.atoms.notice,
              "Request not confirmed. Refresh reads; never replay an uncertain command."
            )
          })
        ),
        Effect.forkIn(scope),
        Effect.flatMap(Fiber.join)
      )
    ).then(() => undefined)
  }
  let viewportPending = false
  let returnSelection: import("effect-jobs/JobId").JobId | null = null
  const navigation = Effect.runSync(
    Navigation.make(state.registry, window, {
      mode: options.demo ? "demo" : "private",
      sandbox: () => state.snapshot().sandbox.ref,
      capture: () => {
        const current = state.snapshot()
        return {
          sandbox: current.sandbox.ref,
          filters: current.filters,
          view:
            current.filters.resolution || current.filters.needsAttention
              ? "problems"
              : "jobs",
          pageSize: current.pageSize,
          pageNumber: current.pageNumber,
          cursors: state.registry.get(state.atoms.cursors),
          scrollY: window.scrollY,
          selectedJobId: current.selected ?? returnSelection
        }
      },
      relock: () => {
        returnSelection = state.snapshot().selected ?? returnSelection
        state.closeDetail()
      },
      restore: (context, notice) => {
        state.restore(context, notice)
        if (context === null) {
          state.registry.set(
            state.atoms.filters,
            Navigation.listStateFilters(new URL(window.location.href))
          )
        }
        viewportPending = true
        void run(state.refresh)
      }
    }).pipe(Scope.provide(scope))
  )
  const followRoute = () => {
    const route = state.registry.get(navigation.route)
    if (route._tag === "Detail") {
      void run(state.select(route.jobId))
    }
  }
  const unsubscribeRoute = state.registry.subscribe(navigation.route, followRoute)
  const unsubscribeError = state.registry.subscribe(state.atoms.error, (error) => {
    if (
      error === "sandbox-expired" ||
      error === "stale-generation" ||
      error === "not-found"
    ) {
      navigation.scopeChanged()
    }
  })
  let live: ReturnType<typeof Live.start> | undefined
  let liveScope: Scope.Closeable | undefined
  const connect = () => {
    if (liveScope) {
      Effect.runSync(Scope.close(liveScope, Exit.void))
    }
    live = undefined
    if (!options.liveUrl || closed) {
      return
    }
    liveScope = Scope.makeUnsafe()
    const connectionScope = liveScope
    const identity = state.snapshot().sandbox.ref
    let admissionSocket: WebSocket | undefined
    live = Effect.runSync(
      Live.scoped({
        sandbox: state.snapshot().sandbox,
        url: options.liveUrl,
        connect: (url) => {
          const socket = new WebSocket(url)
          admissionSocket = socket
          const admissionClosed = (event: CloseEvent) => {
            if (closed || admissionSocket !== socket || event.code !== 4003) {
              return
            }
            const current = state.snapshot().sandbox.ref
            if (
              current.sandboxId === identity.sandboxId &&
              current.generation === identity.generation
            ) {
              state.revokeAuthority("sandbox-expired")
            }
          }
          socket.addEventListener("close", admissionClosed)
          Effect.runSync(
            Scope.addFinalizer(
              connectionScope,
              Effect.sync(() => socket.removeEventListener("close", admissionClosed))
            )
          )
          return socket
        },
        snapshot: () =>
          state.backgroundRefresh.pipe(Effect.provideService(JobsClient, client)),
        render: () => undefined,
        connection: (connection) => state.connection(connection),
        unavailable: () => {
          if (Date.now() >= state.snapshot().sandbox.expiresAt) {
            state.revokeAuthority("sandbox-expired")
          } else if (state.snapshot().error !== "sandbox-expired") {
            state.connection("stale")
          }
          if (!state.reading()) {
            void run(state.backgroundRefresh)
          }
        }
      }).pipe(Scope.provide(liveScope))
    )
    live.setVisible(document.visibilityState !== "hidden")
  }
  const unsubscribe = state.registry.subscribe(state.atoms.sandbox, (next) => {
    const current = liveIdentity
    const identity = `${next.ref.sandboxId}:${next.ref.generation}`
    if (identity !== current) {
      liveIdentity = identity
      navigation.scopeChanged()
      connect()
    }
  })
  let liveIdentity = `${sandbox.ref.sandboxId}:${sandbox.ref.generation}`
  const reconcile = () => {
    live?.setVisible(document.visibilityState !== "hidden")
    if (document.visibilityState !== "hidden" && !state.reading()) {
      void run(state.backgroundRefresh)
    }
  }
  const offline = () => state.connection(options.liveUrl ? "reconnecting" : "stale")
  const online = () => {
    if (options.liveUrl) {
      state.connection("reconnecting")
    }
    reconcile()
  }
  Effect.runSync(
    Effect.acquireRelease(
      Effect.sync(() =>
        setInterval(() => {
          if (document.visibilityState !== "hidden") {
            state.registry.set(now, Date.now())
          }
        }, 1000)
      ),
      (timer) => Effect.sync(() => clearInterval(timer))
    ).pipe(Scope.provide(scope))
  )
  const timer =
    !options.liveUrl && options.poll !== false ? setInterval(reconcile, 5000) : undefined
  document.addEventListener("visibilitychange", reconcile)
  window.addEventListener("online", online)
  window.addEventListener("offline", offline)
  Effect.runSync(
    Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        unsubscribeRoute()
        unsubscribeError()
        unsubscribe()
        if (liveScope) {
          Effect.runSync(Scope.close(liveScope, Exit.void))
        }
        clearInterval(timer)
        document.removeEventListener("visibilitychange", reconcile)
        window.removeEventListener("online", online)
        window.removeEventListener("offline", offline)
      })
    )
  )
  if (state.registry.get(navigation.route)._tag === "List") {
    state.registry.set(
      state.atoms.filters,
      Navigation.listStateFilters(new URL(window.location.href))
    )
  }
  connect()
  void run(state.refresh).then(followRoute)
  const dispose = () => {
    if (closing) {
      return closing
    }
    closed = true
    closing = Effect.runPromise(Scope.close(scope, Exit.void)).then(() => state.dispose())
    return closing
  }
  return {
    ...state,
    filter: (filters: import("@effect-jobs/playground-contracts/Jobs").JobFilters) =>
      state.filter(filters).pipe(Effect.tap(() => Effect.sync(navigation.syncList))),
    run,
    dispose,
    now,
    source: client.source,
    navigation,
    restoreViewport: () => {
      if (!viewportPending || !state.snapshot().resultsCurrent) {
        return
      }
      viewportPending = false
      Navigation.restoreViewport(
        state.registry.get(navigation.returnContext),
        document,
        window
      )
    }
  }
}

// Shared atom definition, independent values in each dashboard registry.
export const now = Atom.make(Date.now()).pipe(Atom.keepAlive)
export type Runtime = ReturnType<typeof make>
