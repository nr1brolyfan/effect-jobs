import { describe, expect, it } from "vitest"
import { Deferred, Effect } from "effect"
import { TestClock } from "effect/testing"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import * as Live from "../../src/live/BrowserLive.js"

class Socket extends EventTarget {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: (() => void) | null = null
  closes = 0
  sent: string[] = []
  send(value: string) {
    this.sent.push(value)
  }
  close() {
    this.closes++
  }
  signal(sequence: number, reason: "jobs-changed" | "reconcile" = "jobs-changed") {
    this.onmessage?.({
      data: JSON.stringify({
        kind: sequence === 1 ? "ready" : "invalidate",
        sandbox: Fixtures.sandbox.ref,
        reason,
        sequence
      })
    })
  }
  revoked() {
    const event = Object.assign(new Event("close"), { code: 4003 }) as CloseEvent
    this.dispatchEvent(event)
    this.onclose?.(event)
  }
}
const sandbox = { ...Fixtures.sandbox, expiresAt: 100_000 }
const run = (program: Effect.Effect<void, never, import("effect").Scope.Scope>) =>
  Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(TestClock.layer())))

// TestClock drives the real pinned Effect scheduler/sleeps. WebSocket is the
// only synthetic platform boundary; HTTP interruption uses real Effect fibers.
describe("scoped browser live resources", () => {
  it("coalesces bursts and fences an invalidated in-flight snapshot", () =>
    run(
      Effect.gen(function* () {
        const sockets: Socket[] = []
        const release = Deferred.makeUnsafe<void>()
        const entered = Deferred.makeUnsafe<void>()
        const rendered: number[] = []
        let reads = 0
        const client = yield* Live.scoped({
          sandbox,
          url: "ws://synthetic.test/changes",
          connect: () => {
            const socket = new Socket()
            sockets.push(socket)
            return socket as unknown as WebSocket
          },
          snapshot: () =>
            Effect.gen(function* () {
              const value = ++reads
              if (value === 1) {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(release)
              }
              return value
            }),
          render: (value) => rendered.push(value),
          unavailable: () => {
            throw new Error("unexpected unavailable")
          }
        })
        client.setVisible(true)
        yield* Deferred.await(entered)
        const socket = sockets[0]!
        socket.signal(1)
        for (let sequence = 2; sequence <= 80; sequence++) {
          socket.signal(sequence)
        }
        yield* Deferred.succeed(release, undefined)
        yield* TestClock.adjust(249)
        expect(rendered).toEqual([])
        expect(reads).toBe(1)
        yield* TestClock.adjust(1)
        expect(reads).toBe(2)
        expect(rendered).toEqual([2])
        expect(socket.sent).toHaveLength(80)
        client.dispose()
        yield* TestClock.adjust(100_000)
        expect(reads).toBe(2)
        expect(socket.closes).toBe(1)
      })
    ))

  it("cancels hidden reads and ignores callbacks from an old socket after resuming", () =>
    run(
      Effect.gen(function* () {
        const sockets: Socket[] = []
        let reads = 0
        let interrupted = 0
        let revoked = 0
        const entered = Deferred.makeUnsafe<void>()
        const client = yield* Live.scoped({
          sandbox,
          url: "ws://synthetic.test/changes",
          connect: () => {
            const socket = new Socket()
            sockets.push(socket)
            return socket as unknown as WebSocket
          },
          snapshot: () =>
            Effect.gen(function* () {
              reads++
              yield* Deferred.succeed(entered, undefined)
              return yield* Effect.never
            }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  interrupted++
                })
              )
            ),
          render: () => {
            throw new Error("cancelled read rendered")
          },
          unavailable: () => {},
          expired: () => {
            revoked++
          }
        })
        client.setVisible(true)
        yield* Deferred.await(entered)
        const oldCallback = sockets[0]!.onmessage!
        client.setVisible(false)
        yield* TestClock.adjust(30_000)
        expect(interrupted).toBe(1)
        expect(reads).toBe(1)
        expect(sockets[0]!.closes).toBe(1)
        client.setVisible(true)
        yield* TestClock.adjust(0)
        expect(sockets).toHaveLength(2)
        oldCallback({ data: "broken" })
        sockets[0]!.revoked()
        expect(revoked).toBe(0)
        client.dispose()
        yield* TestClock.adjust(0)
        expect(interrupted).toBe(2)
      })
    ))

  it("limits admission retries to five while retaining periodic reconciliation", () =>
    run(
      Effect.gen(function* () {
        let attempts = 0
        let reads = 0
        const client = yield* Live.scoped({
          sandbox: { ...sandbox, expiresAt: 1_000_000 },
          url: "ws://synthetic.test/changes",
          connect: () => {
            attempts++
            throw new Error("offline")
          },
          snapshot: () => Effect.sync(() => ++reads),
          render: () => {},
          unavailable: () => {}
        })
        client.setVisible(true)
        yield* TestClock.adjust(60_000)
        expect(attempts).toBe(6)
        expect(reads).toBeGreaterThan(1)
        const previous = reads
        yield* TestClock.adjust(60_000)
        expect(attempts).toBe(6)
        expect(reads).toBeGreaterThan(previous)
        client.dispose()
      })
    ))

  it("revokes once at the expiry boundary and on admission rejection", () =>
    run(
      Effect.gen(function* () {
        const socket = new Socket()
        let expired = 0
        let unavailable = 0
        const client = yield* Live.scoped({
          sandbox: { ...sandbox, expiresAt: 1_000 },
          url: "ws://synthetic.test/changes",
          connect: () => socket as unknown as WebSocket,
          snapshot: () => Effect.succeed(1),
          render: () => {},
          expired: () => {
            expired++
          },
          unavailable: () => {
            unavailable++
          }
        })
        client.setVisible(true)
        yield* TestClock.adjust(999)
        expect(expired).toBe(0)
        yield* TestClock.adjust(1)
        expect(expired).toBe(1)
        expect(unavailable).toBe(1)
        socket.revoked()
        client.setVisible(false)
        client.setVisible(true)
        yield* TestClock.adjust(5_000)
        expect(expired).toBe(1)
        expect(socket.closes).toBe(1)
      })
    ))
})
