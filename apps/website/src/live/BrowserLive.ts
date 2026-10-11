import { Effect, Schema } from "effect"
import { limits } from "@effect-jobs/playground-contracts/Sandbox"
import type { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import type { PlaygroundError } from "@effect-jobs/playground-contracts/Services"
import { Signal, liveLimits, sameSandbox } from "./Protocol.js"

export interface BrowserOptions<A> {
  readonly sandbox: SandboxView
  readonly url: string
  readonly snapshot: () => Effect.Effect<A, PlaygroundError>
  readonly render: (snapshot: A) => void
  readonly unavailable: () => void
  // Injectable browser FFI for deterministic tests; production uses WebSocket.
  readonly connect?: (url: string) => WebSocket
}

// Own one instance per mounted view. Disposal closes sockets, timers and HTTP reads.
export const start = <A>(options: BrowserOptions<A>) => {
  let visible = false
  let disposed = false
  let terminal = false
  let socket: WebSocket | undefined
  let revision = 0
  let refreshDemand = 0
  let retries = 0
  let lastSequence = 0
  let reading = false
  let controller: AbortController | undefined
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let connectionTimer: ReturnType<typeof setTimeout> | undefined
  let expiresTimer: ReturnType<typeof setTimeout> | undefined
  let lastReadAt = -Infinity

  const active = () => visible && !disposed && !terminal
  const clearTimers = () => {
    clearTimeout(refreshTimer)
    clearTimeout(pollTimer)
    clearTimeout(retryTimer)
    clearTimeout(expiresTimer)
    clearTimeout(connectionTimer)
    refreshTimer = undefined
    pollTimer = undefined
    retryTimer = undefined
    expiresTimer = undefined
    connectionTimer = undefined
  }
  const disconnect = () => {
    clearTimeout(connectionTimer)
    connectionTimer = undefined
    const previous = socket
    socket = undefined
    if (previous) {
      previous.onmessage = null
      previous.onclose = null
      previous.onerror = null
      previous.close()
    }
  }
  const expire = () => {
    if (terminal || disposed) {
      return
    }
    terminal = true
    clearTimers()
    disconnect()
    controller?.abort()
    options.unavailable()
  }

  const refresh = () => {
    refreshTimer = undefined
    if (!active() || reading) {
      return
    }
    if (Date.now() >= options.sandbox.expiresAt) {
      expire()
      return
    }
    reading = true
    lastReadAt = Date.now()
    const captured = revision
    const capturedDemand = refreshDemand
    const readController = new AbortController()
    controller = readController
    // Promise bridge belongs to browser callbacks. Effect owns timeout and cancellation.
    void Effect.runPromise(
      options.snapshot().pipe(
        Effect.timeout("4 seconds"),
        Effect.match({
          onFailure: (error) => ({
            ok: false as const,
            expired:
              "code" in error &&
              (error.code === "sandbox-expired" || error.code === "stale-generation")
          }),
          onSuccess: (value) => ({ ok: true as const, value })
        })
      ),
      { signal: readController.signal }
    )
      .then(
        (result) => {
          if (!active() || readController.signal.aborted) {
            return
          }
          if (result.ok) {
            // Admission, changed jobs and lifetime transitions supersede a read;
            // periodic reconciliation only requests another authoritative snapshot.
            if (captured === revision) {
              options.render(result.value)
            }
          } else if (result.expired) {
            expire()
          } else {
            options.unavailable()
          }
        },
        () => {
          if (active() && !readController.signal.aborted) {
            options.unavailable()
          }
        }
      )
      .finally(() => {
        reading = false
        if (controller === readController) {
          controller = undefined
        }
        if (active() && capturedDemand !== refreshDemand) {
          scheduleRefresh()
        }
      })
  }
  const scheduleRefresh = () => {
    if (!active() || reading || refreshTimer !== undefined) {
      return
    }
    refreshTimer = setTimeout(refresh, Math.max(0, 250 - (Date.now() - lastReadAt)))
  }
  const requestRefresh = () => {
    refreshDemand++
    scheduleRefresh()
  }
  const invalidate = () => {
    revision++
    requestRefresh()
  }
  const poll = () => {
    if (!active()) {
      return
    }
    requestRefresh()
    pollTimer = setTimeout(poll, limits.reconciliationMillis)
  }
  const reconnect = () => {
    if (!active() || retryTimer !== undefined || retries >= 5) {
      return
    }
    const delay = Math.min(8000, 500 * 2 ** retries++)
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      connect()
    }, delay)
  }
  const connect = () => {
    if (!active()) {
      return
    }
    disconnect()
    lastSequence = 0
    try {
      socket = (options.connect ?? ((url) => new WebSocket(url)))(options.url)
    } catch {
      reconnect()
      return
    }
    const connection = socket
    connectionTimer = setTimeout(() => {
      if (socket === connection) {
        disconnect()
        invalidate()
        reconnect()
      }
    }, 3000)
    connection.onmessage = (event) => {
      if (!active() || socket !== connection) {
        return
      }
      try {
        if (
          typeof event.data !== "string" ||
          event.data.length > liveLimits.messageBytes
        ) {
          throw new Error("invalid signal")
        }
        const signal = Schema.decodeUnknownSync(Signal, { onExcessProperty: "error" })(
          JSON.parse(event.data)
        )
        if (!sameSandbox(signal.sandbox, options.sandbox.ref)) {
          throw new Error("foreign signal")
        }
        clearTimeout(connectionTimer)
        connectionTimer = undefined
        connection.send(JSON.stringify({ kind: "ack", sequence: signal.sequence }))
        if (signal.sequence <= lastSequence) {
          return
        }
        lastSequence = signal.sequence
        // Ready comes after server admission. Read again even if an early HTTP read won.
        if (signal.kind === "ready" || signal.reason === "jobs-changed") {
          invalidate()
        } else {
          requestRefresh()
        }
      } catch {
        disconnect()
        reconnect()
      }
    }
    connection.onclose = (event) => {
      if (socket !== connection) {
        return
      }
      socket = undefined
      if (event.code === 4003) {
        expire()
      } else {
        invalidate()
        reconnect()
      }
    }
    connection.onerror = () => {
      if (socket === connection) {
        disconnect()
        invalidate()
        reconnect()
      }
    }
  }
  const setVisible = (value: boolean) => {
    if (visible === value || disposed || terminal) {
      return
    }
    visible = value
    revision++
    if (!visible) {
      clearTimers()
      disconnect()
      controller?.abort()
      return
    }
    if (Date.now() >= options.sandbox.expiresAt) {
      expire()
      return
    }
    retries = 0
    connect()
    invalidate()
    pollTimer = setTimeout(poll, limits.reconciliationMillis)
    expiresTimer = setTimeout(expire, options.sandbox.expiresAt - Date.now())
  }
  const dispose = () => {
    setVisible(false)
    disposed = true
    clearTimers()
    disconnect()
    controller?.abort()
  }
  return { setVisible, dispose }
}

// Effect composition can bind the browser lifetime to its owning view Scope.
export const scoped = <A>(options: BrowserOptions<A>) =>
  Effect.acquireRelease(
    Effect.sync(() => start(options)),
    (client) => Effect.sync(client.dispose)
  )
