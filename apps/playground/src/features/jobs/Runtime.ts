import * as Atom from "effect/reactivity/Atom"
import * as Navigation from "./details/Navigation.js"
/* oxlint-disable effecttsgo/unstable-api-usage -- Owner-selected Atom API is pinned to Effect 4.0.0. */
import { Clock, Effect, Exit, Fiber, Scope } from "effect"
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
export const scoped = (client: Client, sandbox: SandboxView, options: Options = {}) =>
  Effect.gen(function* () {
    const parent = yield* Effect.scope
    const scope = Scope.forkUnsafe(parent)
    const context = yield* Effect.context<never>()
    const runSync = Effect.runSyncWith(context)
    const state = Atoms.make(sandbox, options.demo === true)
    state.registry.set(now, yield* Clock.currentTimeMillis)
    let closed = false
    let closing: Promise<void> | undefined
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        closed = true
        state.dispose()
      })
    )
    const run = (operation: Effect.Effect<void, never, JobsClient>) => {
      if (closed) {
        return Promise.resolve()
      }
      return Effect.runPromiseExitWith(context)(
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
    const navigation = runSync(
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
    let live: Effect.Success<ReturnType<typeof Live.scoped>> | undefined
    let liveScope: Scope.Closeable | undefined
    const connect = () => {
      if (liveScope) {
        live?.dispose()
        runSync(
          Effect.forkIn(Scope.close(liveScope, Exit.void), scope, {
            startImmediately: true
          })
        )
      }
      live = undefined
      if (!options.liveUrl || closed) {
        return
      }
      liveScope = Scope.forkUnsafe(scope)
      const identity = state.snapshot().sandbox.ref
      live = runSync(
        Live.scoped({
          sandbox: state.snapshot().sandbox,
          url: options.liveUrl,
          expired: () => {
            if (closed) {
              return
            }
            const current = state.registry.get(state.atoms.sandbox).ref
            if (
              current.sandboxId === identity.sandboxId &&
              current.generation === identity.generation
            ) {
              state.revokeAuthority("sandbox-expired")
            }
          },
          snapshot: (current) =>
            state
              .backgroundRefreshWhen(current)
              .pipe(Effect.provideService(JobsClient, client)),
          render: () => undefined,
          connection: (connection) => state.connection(connection),
          unavailable: () => {
            if (!closed && state.registry.get(state.atoms.error) !== "sandbox-expired") {
              state.connection("stale")
            }
          }
        }).pipe(Scope.provide(liveScope))
      )
      live.setVisible(
        document.visibilityState !== "hidden" && window.navigator?.onLine !== false
      )
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
      const active =
        document.visibilityState !== "hidden" && window.navigator?.onLine !== false
      live?.setVisible(active)
      if (active && !options.liveUrl && !state.reading()) {
        void run(state.backgroundRefresh)
      }
    }
    const offline = () => {
      live?.setVisible(false)
      state.connection(options.liveUrl ? "reconnecting" : "stale")
    }
    const online = () => {
      if (options.liveUrl) {
        state.connection("reconnecting")
      }
      reconcile()
    }
    runSync(
      Effect.forkIn(
        Effect.gen(function* () {
          while (true) {
            yield* Effect.sleep("1 second")
            if (document.visibilityState !== "hidden") {
              const value = yield* Clock.currentTimeMillis
              state.registry.set(now, value)
            }
          }
        }),
        scope
      )
    )
    if (!options.liveUrl && options.poll !== false) {
      runSync(
        Effect.forkIn(
          Effect.sleep("5 seconds").pipe(
            Effect.andThen(Effect.sync(reconcile)),
            Effect.forever
          ),
          scope
        )
      )
    }
    document.addEventListener("visibilitychange", reconcile)
    window.addEventListener("online", online)
    window.addEventListener("offline", offline)
    runSync(
      Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          unsubscribeRoute()
          unsubscribeError()
          unsubscribe()
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
    if (options.liveUrl) {
      followRoute()
    } else {
      void run(state.refresh.pipe(Effect.andThen(Effect.sync(followRoute))))
    }
    const dispose = () => {
      if (closing) {
        return closing
      }
      closed = true
      closing = Effect.runPromiseWith(context)(Scope.close(scope, Exit.void))
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
  })

// Synchronous DOM/React acquisition; scoped also supports Effect-native hosts and
// TestClock. Both constructors use the same resources and cancellation paths.
export const make = (client: Client, sandbox: SandboxView, options: Options = {}) => {
  const scope = Scope.makeUnsafe()
  const runtime = Effect.runSync(
    scoped(client, sandbox, options).pipe(Scope.provide(scope))
  )
  return runtime
}

// Shared atom definition, independent values in each dashboard registry.
export const now = Atom.make(Date.now()).pipe(Atom.keepAlive)
export type Runtime = ReturnType<typeof make>
