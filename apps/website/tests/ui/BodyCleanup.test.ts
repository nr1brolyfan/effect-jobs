import { describe, expect, it } from "vitest"
import { Cause, Effect, Exit, Layer } from "effect"
import * as HttpApplication from "../../src/server/HttpApplication.js"
import * as HttpCommands from "../../src/server/commands/HttpCommands.js"
import * as HttpRepairs from "../../src/server/commands/HttpRepairs.js"
import { Repairs } from "@effect-jobs/playground-contracts/Repairs"
import { Operators } from "@effect-jobs/playground-contracts/Operators"
import { Scenarios } from "@effect-jobs/playground-contracts/Services"
import { Application } from "../../src/server/Services.js"
import { LocalPrivate } from "../../../playground-worker/src/persistence/authority/PrivateMode.js"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"

const origin = "http://localhost:8799"
const request = (stream: ReadableStream<Uint8Array>, path: string) =>
  new Request(`${origin}${path}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: stream,
    duplex: "half"
  } as RequestInit)

const routes = [
  {
    name: "empty issuance",
    budget: 0,
    run: (stream: ReadableStream<Uint8Array>) =>
      HttpApplication.handle(
        request(stream, "/api/sandbox/issue"),
        origin,
        () => true,
        true
      ).pipe(
        Effect.provideService(LocalPrivate, true),
        Effect.provide(
          Layer.mock(Application, {
            repairs: Effect.runSync(
              Effect.service(Repairs).pipe(Effect.provide(Layer.mock(Repairs, {})))
            )
          })
        ),
        Effect.asVoid
      )
  },
  {
    name: "command",
    budget: 4096,
    run: (stream: ReadableStream<Uint8Array>) =>
      HttpCommands.handle(
        { sandbox: Fixtures.sandbox },
        request(stream, "/api/scenarios"),
        "run",
        origin
      ).pipe(
        Effect.provide(Layer.merge(Layer.mock(Operators, {}), Layer.mock(Scenarios, {}))),
        Effect.asVoid
      )
  },
  {
    kind: "repair",
    budget: HttpRepairs.maximumBodyBytes,
    run: (stream: ReadableStream<Uint8Array>) =>
      HttpRepairs.body(request(stream, "/api/jobs/repair")).pipe(Effect.asVoid)
  }
]

describe.each(routes)("$name stream ownership", (route) => {
  it.each(["resolve", "reject", "never"] as const)(
    "releases the lock after %s cancellation on overflow",
    async (outcome) => {
      const events: string[] = []
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(route.budget + 1))
        },
        cancel() {
          events.push("cancel")
          expect(stream.locked).toBe(true)
          if (outcome === "reject") {
            return Promise.reject(new Error("cancel failed"))
          }
          if (outcome === "never") {
            return new Promise<void>(() => {})
          }
        }
      })
      await Effect.runPromiseExit(route.run(stream))
      events.push("finished")
      expect(events).toEqual(["cancel", "finished"])
      expect(stream.locked).toBe(false)
    }
  )
  it("cleans up a pending read on interruption even when cancel never settles", async () => {
    let entered!: () => void
    const reading = new Promise<void>((resolve) => {
      entered = resolve
    })
    let cancels = 0
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        entered()
        return new Promise<void>(() => {})
      },
      cancel() {
        cancels++
        return new Promise<void>(() => {})
      }
    })
    const controller = new AbortController()
    const result = Effect.runPromiseExit(route.run(stream), { signal: controller.signal })
    await reading
    controller.abort()
    const exit = await result
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
    expect(cancels).toBe(1)
    expect(stream.locked).toBe(false)
  })
  it("bounds pending reads at two seconds and releases after bounded cancellation", async () => {
    let cancels = 0
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => {})
      },
      cancel() {
        cancels++
        return new Promise<void>(() => {})
      }
    })
    await Effect.runPromiseExit(route.run(stream))
    expect(cancels).toBe(1)
    expect(stream.locked).toBe(false)
  })
})
