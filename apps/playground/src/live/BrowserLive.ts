import { Clock, Deferred, Effect, Exit, Queue, Schema, Scope } from "effect"
import type { Fiber } from "effect"
import { limits } from "@effect-jobs/playground-contracts/Sandbox"
import type { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import type { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import {
  Signal,
  liveLimits,
  sameSandbox
} from "@effect-jobs/playground-contracts/LiveProtocol"

export interface BrowserOptions<A> {
  readonly sandbox: SandboxView
  readonly url: string
  readonly snapshot: () => Effect.Effect<A, PlaygroundError>
  readonly render: (snapshot: A) => void
  readonly unavailable: () => void
  readonly expired?: () => void
  readonly connection?: (status: "connected" | "reconnecting") => void
  // Browser FFI only. Effect owns deadlines, retries, reads and cancellation.
  readonly connect?: (url: string) => WebSocket
}

const decodeSignal = Schema.decodeUnknownSync(Signal, { onExcessProperty: "error" })

// Each visible lifetime has its own queue, socket and child fibers. Hiding or
// replacing the view fences that lifetime before another one can publish.
export const scoped = <A>(options: BrowserOptions<A>) =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const context = yield* Effect.context<never>()
    const runSync = Effect.runSyncWith(context)
    let visible = false
    let disposed = false
    let terminal = false
    let authorityRevoked = false
    let lifetime: Fiber.Fiber<void> | undefined
    let deactivate: (() => void) | undefined

    const stop = () => {
      deactivate?.()
      deactivate = undefined
      lifetime?.interruptUnsafe()
    }
    const revoke = () => {
      if (authorityRevoked) {
        return
      }
      authorityRevoked = true
      options.expired?.()
    }
    const expire = () => {
      if (terminal || disposed) {
        return
      }
      terminal = true
      stop()
      revoke()
      options.unavailable()
    }
    const session = Effect.scoped(
      Effect.gen(function* () {
        let active = true
        deactivate = () => {
          active = false
        }
        const demand = yield* Queue.sliding<void>(1)
        let revision = 0
        let lastReadAt = -Infinity
        const request = (invalidate = false) => {
          if (!active) {
            return
          }
          if (invalidate) {
            revision++
          }
          Queue.offerUnsafe(demand, undefined)
        }
        const reads = Effect.gen(function* () {
          while (true) {
            yield* Queue.take(demand)
            const now = yield* Clock.currentTimeMillis
            yield* Effect.sleep(Math.max(0, 250 - (now - lastReadAt)))
            // Drain the bounded burst received during the coalescing window.
            while (Queue.takeUnsafe(demand) !== undefined) {
              /* bounded queue */
            }
            if (!active) {
              return
            }
            lastReadAt = yield* Clock.currentTimeMillis
            if (lastReadAt >= options.sandbox.expiresAt) {
              expire()
              return
            }
            const captured = revision
            yield* Effect.suspend(options.snapshot).pipe(
              Effect.timeout("4 seconds"),
              Effect.match({
                onFailure: (error) => {
                  if (!active) {
                    return
                  }
                  if (
                    "code" in error &&
                    (error.code === "sandbox-expired" ||
                      error.code === "stale-generation")
                  ) {
                    expire()
                  } else {
                    options.unavailable()
                  }
                },
                onSuccess: (value) => {
                  if (active && captured === revision) {
                    options.render(value)
                  }
                }
              }),
              Effect.catchDefect(() =>
                Effect.sync(() => {
                  if (active) {
                    options.unavailable()
                  }
                })
              )
            )
          }
        })
        const socketAttempt = Effect.scoped(
          Effect.gen(function* () {
            const admitted = Deferred.makeUnsafe<void>()
            const ended = Deferred.makeUnsafe<void>()
            let listening = true
            let sequence = 0
            const finish = () => {
              if (!active || !listening) {
                return
              }
              listening = false
              options.connection?.("reconnecting")
              request(true)
              Deferred.doneUnsafe(ended, Effect.void)
            }
            function closed(event: CloseEvent) {
              if (!active || !listening) {
                return
              }
              if (event.code === 4003) {
                expire()
              } else {
                finish()
              }
            }
            const admissionClosed = (event: CloseEvent) => {
              if (active && listening && event.code === 4003) {
                revoke()
              }
            }
            options.connection?.("reconnecting")
            const socket = yield* Effect.acquireRelease(
              Effect.try(() =>
                (options.connect ?? ((url) => new WebSocket(url)))(options.url)
              ),
              (socket) =>
                Effect.sync(() => {
                  listening = false
                  socket.onmessage = null
                  socket.onclose = null
                  socket.onerror = null
                  socket.removeEventListener("close", admissionClosed)
                  socket.close()
                })
            )
            socket.addEventListener("close", admissionClosed)
            socket.onclose = closed
            socket.onerror = finish
            socket.onmessage = (event) => {
              if (!active || !listening) {
                return
              }
              try {
                if (
                  typeof event.data !== "string" ||
                  event.data.length > liveLimits.messageBytes
                ) {
                  throw new Error("invalid signal")
                }
                const signal = decodeSignal(JSON.parse(event.data))
                if (!sameSandbox(signal.sandbox, options.sandbox.ref)) {
                  throw new Error("foreign signal")
                }
                socket.send(JSON.stringify({ kind: "ack", sequence: signal.sequence }))
                Deferred.doneUnsafe(admitted, Effect.void)
                if (signal.sequence <= sequence) {
                  return
                }
                sequence = signal.sequence
                options.connection?.("connected")
                request(signal.kind === "ready" || signal.reason === "jobs-changed")
              } catch {
                finish()
              }
            }
            yield* Effect.sleep("3 seconds").pipe(
              Effect.andThen(
                Effect.sync(() => {
                  if (!Deferred.isDoneUnsafe(admitted)) {
                    finish()
                  }
                })
              ),
              Effect.andThen(Effect.never),
              Effect.raceFirst(Deferred.await(ended))
            )
          })
        )
        const sockets = Effect.gen(function* () {
          // Initial connection plus five bounded reconnects; polling remains alive.
          for (let attempt = 0; attempt <= 5; attempt++) {
            if (attempt > 0) {
              yield* Effect.sleep(Math.min(8000, 500 * 2 ** (attempt - 1)))
            }
            if (!active) {
              return
            }
            yield* socketAttempt.pipe(Effect.catch(() => Effect.void))
          }
        })
        const periodic = Effect.sleep(limits.reconciliationMillis).pipe(
          Effect.andThen(Effect.sync(() => request())),
          Effect.forever
        )
        const now = yield* Clock.currentTimeMillis
        if (now >= options.sandbox.expiresAt) {
          expire()
          return
        }
        yield* Effect.forkScoped(reads)
        yield* Effect.forkScoped(sockets, { startImmediately: true })
        yield* Effect.forkScoped(periodic)
        yield* Effect.forkScoped(
          Effect.sleep(options.sandbox.expiresAt - now).pipe(
            Effect.andThen(Effect.sync(expire))
          )
        )
        request(true)
        return yield* Effect.never
      })
    )
    const setVisible = (value: boolean) => {
      if (visible === value || disposed || terminal) {
        return
      }
      visible = value
      stop()
      if (value) {
        lifetime = runSync(Effect.forkIn(session, scope, { startImmediately: true }))
      }
    }
    const dispose = () => {
      disposed = true
      stop()
    }
    yield* Effect.addFinalizer(() => Effect.sync(dispose))
    return { setVisible, dispose }
  })

// Compatibility bridge for direct DOM consumers. Scoped hosts use scoped above.
export const start = <A>(options: BrowserOptions<A>) => {
  const scope = Scope.makeUnsafe()
  const client = Effect.runSync(scoped(options).pipe(Scope.provide(scope)))
  return {
    setVisible: client.setVisible,
    dispose: () => {
      client.dispose()
      return Effect.runPromise(Scope.close(scope, Exit.void))
    }
  }
}
