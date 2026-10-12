import { Effect, Schema } from "effect"
import {
  JobDetail,
  JobPage,
  type JobFilters,
  type ListJobs
} from "@effect-jobs/playground-contracts/Jobs"
import { SandboxView, type SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import {
  ResetResult,
  ScenarioCommand,
  ScenarioResult,
  type ReceiptRequest,
  type ScenarioId
} from "@effect-jobs/playground-contracts/Scenarios"
import {
  PlaygroundError,
  type PublicErrorCode
} from "@effect-jobs/playground-contracts/Services"
import { JobsClient } from "./Adapter.js"
import type { JobId } from "effect-jobs/JobId"

export type Connection = "loading" | "connected" | "reconnecting" | "stale" | "error"
export interface State {
  readonly sandbox: SandboxView
  readonly filters: JobFilters
  readonly cursor: string | undefined
  readonly pageNumber: number
  readonly page: JobPage | undefined
  readonly selected: JobId | undefined
  readonly detail: JobDetail | undefined
  readonly connection: Connection
  readonly error: PublicErrorCode | undefined
  readonly detailError: PublicErrorCode | undefined
  readonly pending:
    | { readonly kind: "scenario" | "reset"; readonly request: ReceiptRequest }
    | undefined
  readonly busy: boolean
  readonly notice: string
}

const sameRef = (a: SandboxRef, b: SandboxRef) =>
  a.sandboxId === b.sandboxId && a.generation === b.generation

const decode =
  <S extends Schema.Top>(schema: S) =>
  (value: unknown) =>
    Schema.decodeUnknownEffect(schema)(value, { onExcessProperty: "error" }).pipe(
      Effect.mapError(() => new PlaygroundError({ code: "unavailable" }))
    )

// Reads and command responses are finite. A timed-out command remains uncertain.
const bounded = <A>(operation: Effect.Effect<A, PlaygroundError>) =>
  operation.pipe(
    Effect.timeoutOrElse({
      duration: "10 seconds",
      orElse: () => Effect.fail(new PlaygroundError({ code: "unavailable" }))
    })
  )

export const make = (
  initial: SandboxView,
  changed: (state: State) => void,
  allowDemoRotation = false
) => {
  let state: State = {
    sandbox: initial,
    filters: {},
    cursor: undefined,
    pageNumber: 1,
    page: undefined,
    selected: undefined,
    detail: undefined,
    connection: "loading",
    error: undefined,
    detailError: undefined,
    pending: undefined,
    busy: false,
    notice: ""
  }
  let listRevision = 0
  let detailRevision = 0
  let activeReads = 0
  let activeDetail:
    | { readonly revision: number; readonly sandbox: SandboxRef; readonly jobId: JobId }
    | undefined
  let disposed = false
  const update = (patch: Partial<State>) => {
    if (!disposed) {
      state = { ...state, ...patch }
      changed(state)
    }
  }
  const ensureRef = (ref: SandboxRef, expected: SandboxRef) =>
    sameRef(ref, expected)
      ? Effect.void
      : Effect.fail(new PlaygroundError({ code: "stale-generation" }))

  const select = (jobId: JobId): Effect.Effect<void, never, JobsClient> =>
    Effect.gen(function* () {
      const client = yield* JobsClient
      const sandbox = state.sandbox.ref
      if (
        activeDetail?.revision === detailRevision &&
        activeDetail.jobId === jobId &&
        sameRef(activeDetail.sandbox, sandbox)
      ) {
        return
      }
      const revision = ++detailRevision
      const request = { revision, sandbox, jobId }
      activeDetail = request
      update({
        selected: jobId,
        detail: state.selected === jobId ? state.detail : undefined,
        detailError: undefined
      })
      yield* bounded(client.detail({ sandbox, jobId })).pipe(
        Effect.flatMap(decode(JobDetail)),
        Effect.flatMap((detail) =>
          ensureRef(detail.sandbox, sandbox).pipe(Effect.as(detail))
        ),
        Effect.flatMap((detail) =>
          detail.job.jobId === jobId
            ? Effect.succeed(detail)
            : Effect.fail(new PlaygroundError({ code: "unavailable" }))
        ),
        Effect.match({
          onFailure: (error) => {
            if (revision === detailRevision) {
              update({ detail: undefined, detailError: error.code })
            }
          },
          onSuccess: (detail) => {
            if (revision === detailRevision) {
              update({ detail })
            }
          }
        }),
        Effect.ensuring(
          Effect.sync(() => {
            if (activeDetail === request) {
              activeDetail = undefined
            }
          })
        )
      )
    })

  const refresh: Effect.Effect<void, never, JobsClient> = Effect.gen(function* () {
    const client = yield* JobsClient
    const revision = ++listRevision
    ++activeReads
    yield* Effect.gen(function* () {
      update({
        connection: state.page === undefined ? "loading" : "reconnecting",
        error: undefined
      })
      const described = yield* bounded(client.describe()).pipe(
        Effect.flatMap(decode(SandboxView)),
        Effect.result
      )
      if (revision !== listRevision) {
        return
      }
      if (described._tag === "Failure") {
        const revoked = ["sandbox-expired", "stale-generation", "not-found"].includes(
          described.failure.code
        )
        if (revoked) {
          ++detailRevision
        }
        update({
          connection: state.page === undefined ? "error" : "stale",
          error: described.failure.code,
          ...(revoked ? { page: undefined, detail: undefined } : {})
        })
        return
      }
      const sandbox = described.success
      if (sandbox.ref.sandboxId !== state.sandbox.ref.sandboxId && !allowDemoRotation) {
        ++detailRevision
        update({
          page: undefined,
          detail: undefined,
          connection: "error",
          error: "not-found"
        })
        return
      }
      if (sandbox.ref.generation < state.sandbox.ref.generation) {
        update({ connection: "stale", error: "stale-generation" })
        return
      }
      if (!sameRef(sandbox.ref, state.sandbox.ref)) {
        ++detailRevision
        update({
          page: undefined,
          detail: undefined,
          selected: undefined,
          cursor: undefined,
          pageNumber: 1,
          notice:
            "Sandbox generation changed. Old data and selection were revoked; filters retained."
        })
      }
      update({ sandbox })
      const request: ListJobs = {
        sandbox: state.sandbox.ref,
        filters: state.filters,
        limit: 5,
        ...(state.cursor === undefined ? {} : { cursor: state.cursor })
      }
      yield* bounded(client.list(request)).pipe(
        Effect.flatMap(decode(JobPage)),
        Effect.flatMap((page) =>
          ensureRef(page.sandbox, request.sandbox).pipe(Effect.as(page))
        ),
        Effect.match({
          onFailure: (error) => {
            if (revision === listRevision) {
              const revoked =
                error.code === "sandbox-expired" ||
                error.code === "stale-generation" ||
                error.code === "not-found"
              if (revoked) {
                ++detailRevision
              }
              update({
                connection: state.page === undefined ? "error" : "stale",
                error: error.code,
                ...(revoked ? { page: undefined, detail: undefined } : {})
              })
            }
          },
          onSuccess: (page) => {
            if (revision === listRevision) {
              update({ page, connection: "connected", error: undefined })
            }
          }
        })
      )
    }).pipe(Effect.ensuring(Effect.sync(() => --activeReads)))
    if (
      revision === listRevision &&
      state.connection === "connected" &&
      state.selected !== undefined
    ) {
      yield* select(state.selected)
    }
  })

  const filter = (filters: JobFilters) =>
    Effect.gen(function* () {
      update({ filters, cursor: undefined, pageNumber: 1, page: undefined })
      yield* refresh
    })
  const first = Effect.gen(function* () {
    update({ cursor: undefined, pageNumber: 1, page: undefined })
    yield* refresh
  })
  const next = Effect.gen(function* () {
    if (
      state.page?.nextCursor === null ||
      state.page?.nextCursor === undefined ||
      state.connection !== "connected"
    ) {
      return
    }
    update({
      cursor: state.page.nextCursor,
      pageNumber: state.pageNumber + 1,
      page: undefined
    })
    yield* refresh
  })

  const acceptScenario = (result: ScenarioResult, request: ReceiptRequest) =>
    Effect.gen(function* () {
      yield* ensureRef(result.sandbox, request.sandbox)
      if (result.requestId !== request.requestId) {
        return yield* new PlaygroundError({ code: "unavailable" })
      }
      if (result._tag === "OutcomeUnknown") {
        update({
          notice: "Outcome unknown. Do not replay. Look up the exact request receipt."
        })
      } else {
        update({
          pending: undefined,
          notice: `Enqueue acknowledged for ${result.jobIds.length} job(s). Handler success is not confirmed.`
        })
        yield* refresh
      }
    })
  const acceptReset = (result: ResetResult, request: ReceiptRequest) =>
    Effect.gen(function* () {
      yield* ensureRef(result.previous, request.sandbox)
      if (result.requestId !== request.requestId) {
        return yield* new PlaygroundError({ code: "unavailable" })
      }
      if (result._tag === "OutcomeUnknown") {
        update({
          notice:
            "Reset outcome unknown. Do not replay. Look up the exact request receipt."
        })
      } else {
        if (result.current.generation <= state.sandbox.ref.generation) {
          // This exact receipt acknowledges history, not newer sandbox authority.
          update({
            pending: undefined,
            notice: "Reset acknowledged. Current sandbox generation and data retained."
          })
          yield* refresh
          return
        }
        // Revoke displayed old data immediately, even if describe subsequently fails.
        ++listRevision
        ++detailRevision
        update({
          sandbox: { ...state.sandbox, ref: result.current },
          pending: undefined,
          page: undefined,
          detail: undefined,
          selected: undefined,
          cursor: undefined,
          pageNumber: 1,
          notice:
            "New sandbox generation. Old data is hidden; reset does not cancel running jobs."
        })
        yield* refresh
      }
    })
  const exclusive = <E, R>(operation: Effect.Effect<void, E, R>) =>
    Effect.suspend(() => {
      if (state.busy) {
        return Effect.void
      }
      update({ busy: true })
      return operation.pipe(Effect.ensuring(Effect.sync(() => update({ busy: false }))))
    })
  const command = (
    kind: "scenario" | "reset",
    requestId: string,
    scenario: ScenarioId,
    count: number
  ) =>
    exclusive(
      Effect.gen(function* () {
        if (state.pending !== undefined) {
          return
        }
        if (
          !(kind === "scenario"
            ? state.sandbox.capabilities.runScenario
            : state.sandbox.capabilities.resetSandbox)
        ) {
          update({ notice: "Capability unavailable. No command was sent." })
          return
        }
        const client = yield* JobsClient
        const input = yield* Schema.decodeUnknownEffect(ScenarioCommand)({
          sandbox: state.sandbox.ref,
          requestId,
          scenario,
          count
        }).pipe(Effect.mapError(() => new PlaygroundError({ code: "invalid-request" })))
        const request = { sandbox: input.sandbox, requestId: input.requestId }
        update({ pending: { kind, request }, busy: true, notice: "Sending one request…" })
        if (kind === "scenario") {
          yield* bounded(client.run(input)).pipe(
            Effect.flatMap(decode(ScenarioResult)),
            Effect.flatMap((result) => acceptScenario(result, request))
          )
        } else {
          yield* bounded(client.reset(request)).pipe(
            Effect.flatMap(decode(ResetResult)),
            Effect.flatMap((result) => acceptReset(result, request))
          )
        }
      }).pipe(
        Effect.catchTag("PlaygroundError", (error) =>
          Effect.sync(() => {
            update({
              notice:
                state.pending === undefined
                  ? `Command unavailable: ${error.code}.`
                  : `Command not confirmed (${error.code}). Do not replay; reconcile the exact receipt.`
            })
          })
        )
      )
    )
  const receipt = exclusive(
    Effect.gen(function* () {
      const pending = state.pending
      if (pending === undefined) {
        return
      }
      const client = yield* JobsClient
      update({ busy: true })
      if (pending.kind === "scenario") {
        yield* bounded(client.scenarioReceipt(pending.request)).pipe(
          Effect.flatMap(decode(ScenarioResult)),
          Effect.flatMap((result) => acceptScenario(result, pending.request))
        )
      } else {
        yield* bounded(client.resetReceipt(pending.request)).pipe(
          Effect.flatMap(decode(ResetResult)),
          Effect.flatMap((result) => acceptReset(result, pending.request))
        )
      }
    }).pipe(
      Effect.catchTag("PlaygroundError", (error) =>
        Effect.sync(() =>
          update({
            notice: `Receipt lookup: ${error.code}. Absence does not authorize replay.`
          })
        )
      )
    )
  )
  return {
    snapshot: () => state,
    reading: () => activeReads > 0,
    refresh,
    filter,
    first,
    next,
    select,
    command,
    receipt,
    connection: (connection: Connection) => update({ connection }),
    dispose: () => {
      disposed = true
      ++listRevision
      ++detailRevision
    }
  }
}
