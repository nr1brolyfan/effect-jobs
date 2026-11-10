import { describe, expect, it } from "vitest"
import { Cause, Effect, Exit } from "effect"
import { Repairs } from "@effect-jobs/playground-contracts/Repairs"
import * as Http from "../../../src/server/commands/HttpRepairs.js"
import { LiveNotifications } from "../../../src/server/live/PostCommit.js"
import * as Fixture from "../../../../playground-worker/tests/repairs/Fixtures.js"

const origin = "http://localhost:8799"
const access = {
  sandbox: {
    ref: Fixture.ref,
    expiresAt: 100000,
    capabilities: {
      runScenario: true,
      resetSandbox: true,
      retryJob: true,
      cancelJob: true,
      redriveJob: true
    }
  }
}
const request = (
  value: unknown = Fixture.command,
  headers: Record<string, string> = {}
) =>
  new Request(`${origin}/api/jobs/repair`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(value)
  })
const setup = () => {
  const calls: string[] = []
  let hints = 0
  const result = {
    _tag: "Rejected" as const,
    sandbox: Fixture.ref,
    requestId: Fixture.command.requestId,
    jobId: Fixture.sourceId,
    reason: "not-eligible" as const
  }
  const service = Repairs.of({
    execute: () =>
      Effect.sync(() => {
        calls.push("execute")
        return result
      }),
    receipt: () =>
      Effect.sync(() => {
        calls.push("receipt")
        return {
          _tag: "OutcomeUnknown" as const,
          sandbox: Fixture.ref,
          requestId: Fixture.command.requestId
        }
      }),
    resolve: () => Effect.die("Unexpected resolution"),
    resolutionReceipt: () => Effect.die("Unexpected resolution receipt")
  })
  const handle = (req: Request, operation: Http.Operation = "repair") =>
    Http.handle(access, req, operation, origin).pipe(
      Effect.provideService(Repairs, service),
      Effect.provideService(LiveNotifications, {
        committed: () =>
          Effect.sync(() => {
            hints++
          })
      })
    )
  return { calls, handle, hints: () => hints }
}

describe("repair HTTP authority boundary", () => {
  it("returns safe refusal as 200 and unknown receipt as 202 without mutation hints", async () => {
    const http = setup()
    const rejected = await Effect.runPromise(http.handle(request()))
    expect(rejected.status).toBe(200)
    expect(rejected.headers.get("Cache-Control")).toBe("no-store")
    const pending = await Effect.runPromise(
      http.handle(
        request({ sandbox: Fixture.ref, requestId: Fixture.command.requestId }),
        "repairReceipt"
      )
    )
    expect(pending.status).toBe(202)
    expect(http.calls).toEqual(["execute", "receipt"])
    expect(http.hints()).toBe(0)
  })
  it.each(["producer", "trusted", "actorCategory", "generationOverride"])(
    "rejects extra %s before the service is called",
    async (key) => {
      const http = setup()
      const response = await Effect.runPromise(
        http.handle(request({ ...Fixture.command, [key]: true }))
      )
      expect(response.status).toBe(400)
      expect(http.calls).toEqual([])
    }
  )
  it.each([
    { Origin: "https://foreign.test" },
    { "Sec-Fetch-Site": "cross-site" },
    { "Content-Type": "text/plain" }
  ])("rejects untrusted request metadata %j", async (headers) => {
    const http = setup()
    expect(
      (await Effect.runPromise(http.handle(request(Fixture.command, headers)))).status
    ).toBe(400)
    expect(http.calls).toEqual([])
  })
  it("bounds actual body bytes, ignores dishonest Content-Length and cancels the reader", async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(Http.maximumBodyBytes + 1))
      },
      cancel() {
        cancelled = true
      }
    })
    const req = new Request(`${origin}/api/jobs/repair`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Content-Length": "1"
      },
      body: stream,
      duplex: "half"
    } as RequestInit)
    const http = setup()
    expect((await Effect.runPromise(http.handle(req))).status).toBe(400)
    expect(cancelled).toBe(true)
    expect(http.calls).toEqual([])
  })
  it("rejects invalid UTF-8 and duplicate-effects confirmation before mutation", async () => {
    const badUtf8 = new Request(`${origin}/api/jobs/repair`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: new Uint8Array([0xff])
    })
    const http = setup()
    expect((await Effect.runPromise(http.handle(badUtf8))).status).toBe(400)
    expect(
      (
        await Effect.runPromise(
          http.handle(request({ ...Fixture.command, confirmDuplicateEffects: false }))
        )
      ).status
    ).toBe(400)
    expect(http.calls).toEqual([])
  })
  it("keeps interruption as interruption", async () => {
    const service = Repairs.of({
      execute: () => Effect.interrupt,
      receipt: () => Effect.interrupt,
      resolve: () => Effect.interrupt,
      resolutionReceipt: () => Effect.interrupt
    })
    const exit = await Effect.runPromiseExit(
      Http.handle(access, request(), "repair", origin).pipe(
        Effect.provideService(Repairs, service)
      )
    )
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
  })
})
