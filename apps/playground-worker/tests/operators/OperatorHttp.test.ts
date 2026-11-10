import { describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { Operators } from "@effect-jobs/playground-contracts/Operators"
import { Scenarios } from "@effect-jobs/playground-contracts/Services"
import * as Http from "../../../website/src/server/commands/HttpCommands.js"

const origin = "https://playground.example"
const command = {
  sandbox: Fixtures.sandbox.ref,
  requestId: "operator-a",
  jobId: Fixtures.detail.job.jobId,
  expectedState: "Completed",
  expectedLifecycleVersion: 2,
  action: "cancel"
}
const setup = () => {
  const calls: unknown[] = []
  const layer = Layer.mergeAll(
    Layer.mock(Scenarios, {}),
    Layer.succeed(Operators, {
      execute: (_, input) =>
        Effect.sync(() => {
          calls.push(input)
          return {
            _tag: "Rejected" as const,
            sandbox: input.sandbox,
            requestId: input.requestId,
            action: input.action,
            jobId: input.jobId,
            reason: "terminal-state" as const
          }
        }),
      receipt: (_, request) =>
        Effect.sync(() => {
          calls.push(request)
          return {
            _tag: "OutcomeUnknown" as const,
            sandbox: request.sandbox,
            requestId: request.requestId
          }
        })
    })
  )
  const request = (
    body: unknown,
    headers: Record<string, string> = {},
    url = origin + "/api/jobs/operator"
  ) =>
    new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, ...headers },
      body: JSON.stringify(body)
    })
  const run = (req: Request, operation: Http.Operation = "operator") =>
    Effect.runPromise(
      Http.handle({ sandbox: Fixtures.sandbox }, req, operation, origin).pipe(
        Effect.provide(layer)
      )
    )
  return { calls, request, run }
}
describe("private operator transport after credential/CSRF admission", () => {
  it("preserves a definitive refusal and an unknown exact receipt without new mutation", async () => {
    const { calls, request, run } = setup()
    const rejected = await run(request(command))
    expect(rejected.status).toBe(200)
    expect(await rejected.json()).toMatchObject({
      _tag: "Rejected",
      reason: "terminal-state"
    })
    const unknown = await run(
      request({ sandbox: command.sandbox, requestId: command.requestId }),
      "operatorReceipt"
    )
    expect(unknown.status).toBe(202)
    expect(await unknown.json()).toMatchObject({
      _tag: "OutcomeUnknown",
      requestId: command.requestId
    })
    expect(calls).toHaveLength(2)
    expect(unknown.headers.get("Cache-Control")).toBe("no-store")
    expect(unknown.headers.get("X-Content-Type-Options")).toBe("nosniff")
  })
  it("refuses foreign origin, cross-site metadata, query commands and injected fields before service dispatch", async () => {
    const { calls, request, run } = setup()
    for (const req of [
      request(command, { Origin: "https://foreign.example" }),
      request(command, { "Sec-Fetch-Site": "cross-site" }),
      request(command, {}, origin + "/api/jobs/operator?requestId=a"),
      request({ ...command, producer: { operation: "injected" } }),
      request({ ...command, action: "redrive" }),
      request({ ...command, action: "redrive", confirmDuplicateEffects: false })
    ]) {
      expect((await run(req)).status).toBe(400)
    }
    expect(calls).toHaveLength(0)
  })
  it("bounds actual bytes even without a trustworthy content length", async () => {
    const { calls, request, run } = setup()
    expect((await run(request({ ...command, requestId: "x".repeat(5000) }))).status).toBe(
      400
    )
    expect(calls).toHaveLength(0)
  })
})
