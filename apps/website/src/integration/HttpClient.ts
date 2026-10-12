import { JobOperatorResult } from "@effect-jobs/playground-contracts/Operators"
import { Effect, Schema } from "effect"
import { JobDetail, JobPage } from "@effect-jobs/playground-contracts/Jobs"
import { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import { ScenarioResult, ResetResult } from "@effect-jobs/playground-contracts/Scenarios"
import { PlaygroundError, PublicError } from "@effect-jobs/playground-contracts/Services"
import type { Client } from "../features/jobs/Adapter.js"

export const csrfCookieName =
  location.protocol === "http:" &&
  ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)
    ? `playground-local-csrf-${location.port}`
    : "__Host-playground-csrf"
const csrf = () =>
  document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${csrfCookieName}=`))
    ?.split("=")[1] ?? ""
const request = <S extends Schema.Top & { readonly DecodingServices: never }>(
  path: string,
  schema: S,
  method = "GET",
  body?: unknown
) =>
  Effect.tryPromise({
    try: (signal) =>
      fetch(path, {
        method,
        credentials: "same-origin",
        signal,
        headers:
          method === "POST"
            ? { "Content-Type": "application/json", "X-Playground-CSRF": csrf() }
            : {},
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      }),
    catch: () => new PlaygroundError({ code: "unavailable" })
  }).pipe(
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: () => new PlaygroundError({ code: "unavailable" })
      }).pipe(
        Effect.flatMap((raw) =>
          response.ok
            ? Schema.decodeUnknownEffect(schema)(raw, { onExcessProperty: "error" }).pipe(
                Effect.mapError(() => new PlaygroundError({ code: "unavailable" }))
              )
            : Schema.decodeUnknownEffect(PublicError)(raw).pipe(
                Effect.mapError(() => new PlaygroundError({ code: "unavailable" })),
                Effect.flatMap((error) => Effect.fail(new PlaygroundError(error)))
              )
        )
      )
    ),
    Effect.timeoutOrElse({
      duration: "8 seconds",
      orElse: () => Effect.fail(new PlaygroundError({ code: "unavailable" }))
    })
  )
const params = (
  input: { sandbox: { sandboxId: string; generation: number } },
  extra: Record<string, string | undefined> = {}
) =>
  new URLSearchParams({
    sandboxId: input.sandbox.sandboxId,
    generation: String(input.sandbox.generation),
    ...Object.fromEntries(
      Object.entries(extra).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    )
  }).toString()
export const issue = () => request("/api/sandbox/issue", SandboxView, "POST")
export const client: Client = {
  source: "workerd",
  operate: (input) => request("/api/jobs/operator", JobOperatorResult, "POST", input),
  operatorReceipt: (input) =>
    request("/api/jobs/operator/receipt", JobOperatorResult, "POST", input),
  describe: () => request("/api/sandbox", SandboxView, "POST"),
  list: (input) =>
    request(
      `/api/jobs?${params(input, { state: input.filters.state, kind: input.filters.kind, limit: String(input.limit), cursor: input.cursor })}`,
      JobPage
    ),
  detail: (input) =>
    request(`/api/jobs/detail?${params(input, { jobId: input.jobId })}`, JobDetail),
  run: (input) => request("/api/scenarios", ScenarioResult, "POST", input),
  reset: (input) => request("/api/sandbox/reset", ResetResult, "POST", input),
  scenarioReceipt: (input) =>
    request("/api/scenarios/receipt", ScenarioResult, "POST", input),
  resetReceipt: (input) =>
    request("/api/sandbox/reset/receipt", ResetResult, "POST", input)
}
export const demoClient: Client = {
  ...client,
  operate: () => Effect.fail(new PlaygroundError({ code: "capability-unavailable" })),
  operatorReceipt: () =>
    Effect.fail(new PlaygroundError({ code: "capability-unavailable" })),
  describe: () => request("/api/demo", SandboxView),
  list: (input) =>
    request(
      `/api/demo/jobs?${params(input, { state: input.filters.state, kind: input.filters.kind, limit: String(input.limit), cursor: input.cursor })}`,
      JobPage
    ),
  detail: (input) =>
    request(`/api/demo/jobs/detail?${params(input, { jobId: input.jobId })}`, JobDetail),
  run: () => Effect.fail(new PlaygroundError({ code: "capability-unavailable" })),
  reset: () => Effect.fail(new PlaygroundError({ code: "capability-unavailable" })),
  scenarioReceipt: () =>
    Effect.fail(new PlaygroundError({ code: "capability-unavailable" })),
  resetReceipt: () => Effect.fail(new PlaygroundError({ code: "capability-unavailable" }))
}
