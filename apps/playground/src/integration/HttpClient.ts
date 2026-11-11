import {
  JobRepairResult,
  JobResolutionResult
} from "@effect-jobs/playground-contracts/Repairs"
import {
  JobProblemPage,
  JobHistory,
  JobRelatedPage
} from "@effect-jobs/playground-contracts/Jobs"
import * as Cookies from "@effect-jobs/playground-contracts/Cookies"
import { JobOperatorResult } from "@effect-jobs/playground-contracts/Operators"
import { Effect, Schema } from "effect"
import { JobDetail, JobPage } from "@effect-jobs/playground-contracts/Jobs"
import { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import { ScenarioResult, ResetResult } from "@effect-jobs/playground-contracts/Scenarios"
import { PlaygroundError, PublicError } from "@effect-jobs/playground-contracts/Services"
import type { Client } from "../features/jobs/Adapter.js"

export const csrfCookieName = Cookies.names(location.origin, true).csrf
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
  repair: (input) => request("/api/jobs/repair", JobRepairResult, "POST", input),
  repairReceipt: (input) =>
    request("/api/jobs/repair/receipt", JobRepairResult, "POST", input),
  resolve: (input) => request("/api/jobs/resolution", JobResolutionResult, "POST", input),
  resolutionReceipt: (input) =>
    request("/api/jobs/resolution/receipt", JobResolutionResult, "POST", input),
  problems: (input) =>
    request(
      `/api/jobs/problems?${params(input, { state: input.filters.state, name: input.filters.name, resolution: input.filters.resolution, needsAttention: input.filters.needsAttention ? "true" : undefined, limit: String(input.limit), cursor: input.cursor })}`,
      JobProblemPage
    ),
  history: (input) =>
    request(
      `/api/jobs/history?${params(input, { jobId: input.jobId, limit: String(input.limit), cursor: input.cursor })}`,
      JobHistory
    ),
  related: (input) =>
    request(
      `/api/jobs/related?${params(input, { jobId: input.jobId, limit: String(input.limit), cursor: input.cursor })}`,
      JobRelatedPage
    ),
  operate: (input) => request("/api/jobs/operator", JobOperatorResult, "POST", input),
  operatorReceipt: (input) =>
    request("/api/jobs/operator/receipt", JobOperatorResult, "POST", input),
  describe: () => request("/api/sandbox", SandboxView, "POST"),
  list: (input) =>
    request(
      `/api/jobs?${params(input, { state: input.filters.state, name: input.filters.name, limit: String(input.limit), cursor: input.cursor })}`,
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
  repair: () => Effect.fail(new PlaygroundError({ code: "capability-unavailable" })),
  repairReceipt: () =>
    Effect.fail(new PlaygroundError({ code: "capability-unavailable" })),
  resolve: () => Effect.fail(new PlaygroundError({ code: "capability-unavailable" })),
  resolutionReceipt: () =>
    Effect.fail(new PlaygroundError({ code: "capability-unavailable" })),
  problems: (input) =>
    request(
      `/api/demo/jobs/problems?${params(input, { state: input.filters.state, name: input.filters.name, resolution: input.filters.resolution, needsAttention: input.filters.needsAttention ? "true" : undefined, limit: String(input.limit), cursor: input.cursor })}`,
      JobProblemPage
    ),
  history: (input) =>
    request(
      `/api/demo/jobs/history?${params(input, { jobId: input.jobId, limit: String(input.limit), cursor: input.cursor })}`,
      JobHistory
    ),
  related: (input) =>
    request(
      `/api/demo/jobs/related?${params(input, { jobId: input.jobId, limit: String(input.limit), cursor: input.cursor })}`,
      JobRelatedPage
    ),
  operate: () => Effect.fail(new PlaygroundError({ code: "capability-unavailable" })),
  operatorReceipt: () =>
    Effect.fail(new PlaygroundError({ code: "capability-unavailable" })),
  describe: () => request("/api/demo", SandboxView),
  list: (input) =>
    request(
      `/api/demo/jobs?${params(input, { state: input.filters.state, name: input.filters.name, limit: String(input.limit), cursor: input.cursor })}`,
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
