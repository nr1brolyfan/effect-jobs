import {
  JobRepairCommand,
  JobRepairResult,
  JobResolutionCommand,
  JobResolutionResult
} from "@effect-jobs/playground-contracts/Repairs"
import {
  JobProblemPage,
  type JobProblemRow
} from "@effect-jobs/playground-contracts/Jobs"
import type { JobReturnContext } from "./details/Navigation.js"
/* oxlint-disable effecttsgo/unstable-api-usage -- Owner-selected Atom API is pinned to Effect 4.0.0. */
import {
  JobOperatorCommand,
  JobOperatorResult,
  type JobOperatorAction
} from "@effect-jobs/playground-contracts/Operators"
import * as OperatorEligibility from "./OperatorEligibility.js"
import { Clock, Effect, Schema } from "effect"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import {
  JobDetail,
  JobPage,
  type JobFilters,
  type JobStats,
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
export interface Query {
  readonly sandbox: SandboxRef
  readonly filters: JobFilters
  readonly pageNumber: number
  readonly pageSize: 20 | 50
}
export interface Pagination {
  readonly total: number | undefined
  readonly pageCount: number | undefined
  readonly pages: ReadonlyArray<number>
  readonly current: number
  readonly hasPrevious: boolean
  readonly hasNext: boolean
}
export interface State {
  readonly sandbox: SandboxView
  readonly filters: JobFilters
  readonly cursor: string | undefined
  readonly pageNumber: number
  readonly page: JobPage | undefined
  readonly problemRows: ReadonlyArray<JobProblemRow> | undefined
  readonly stats: JobStats | undefined
  readonly loading: boolean
  readonly pageSize: 20 | 50
  readonly pagination: Pagination
  readonly displayedQuery: Query | undefined
  // False means retained rows belong to previous results, even after a failed read.
  readonly resultsCurrent: boolean
  readonly selected: JobId | undefined
  readonly detail: JobDetail | undefined
  readonly connection: Connection
  readonly error: PublicErrorCode | undefined
  readonly detailError: PublicErrorCode | undefined
  readonly pending:
    | { readonly kind: "scenario" | "reset"; readonly request: ReceiptRequest }
    | {
        readonly kind: "operator"
        readonly request: ReceiptRequest
        readonly command: JobOperatorCommand
      }
    | {
        readonly kind: "repair"
        readonly request: ReceiptRequest
        readonly command: JobRepairCommand
      }
    | {
        readonly kind: "resolution"
        readonly request: ReceiptRequest
        readonly command: JobResolutionCommand
      }
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
    }),
    // Adapter defects use the same revision-guarded public failure path.
    Effect.catchDefect(() => Effect.fail(new PlaygroundError({ code: "unavailable" })))
  )

export const make = (initial: SandboxView, allowDemoRotation = false) => {
  const atoms = {
    sandbox: Atom.make(initial).pipe(Atom.keepAlive),
    filters: Atom.make<JobFilters>({}).pipe(Atom.keepAlive),
    cursor: Atom.make<string | undefined>(undefined).pipe(Atom.keepAlive),
    pageNumber: Atom.make(1).pipe(Atom.keepAlive),
    page: Atom.make<JobPage | undefined>(undefined).pipe(Atom.keepAlive),
    problemRows: Atom.make<ReadonlyArray<JobProblemRow> | undefined>(undefined).pipe(
      Atom.keepAlive
    ),
    stats: Atom.make<JobStats | undefined>(undefined).pipe(Atom.keepAlive),
    pageSize: Atom.make<20 | 50>(20).pipe(Atom.keepAlive),
    displayedQuery: Atom.make<Query | undefined>(undefined).pipe(Atom.keepAlive),
    cursors: Atom.make<ReadonlyArray<string | undefined>>([undefined]).pipe(
      Atom.keepAlive
    ),
    selected: Atom.make<JobId | undefined>(undefined).pipe(Atom.keepAlive),
    detail: Atom.make<JobDetail | undefined>(undefined).pipe(Atom.keepAlive),
    connection: Atom.make<Connection>("loading").pipe(Atom.keepAlive),
    error: Atom.make<PublicErrorCode | undefined>(undefined).pipe(Atom.keepAlive),
    detailError: Atom.make<PublicErrorCode | undefined>(undefined).pipe(Atom.keepAlive),
    pending: Atom.make<State["pending"]>(undefined).pipe(Atom.keepAlive),
    busy: Atom.make(false).pipe(Atom.keepAlive),
    notice: Atom.make("").pipe(Atom.keepAlive),
    loading: Atom.make(false).pipe(Atom.keepAlive)
  }
  const registry = AtomRegistry.make()
  const stateAtom = Atom.make((get): State => {
    const sandbox = get(atoms.sandbox)
    const filters = get(atoms.filters)
    const pageNumber = get(atoms.pageNumber)
    const pageSize = get(atoms.pageSize)
    const displayedQuery = get(atoms.displayedQuery)
    const cursors = get(atoms.cursors)
    const page = get(atoms.page)
    return {
      sandbox,
      filters,
      cursor: get(atoms.cursor),
      pageNumber,
      pageSize,
      page,
      problemRows: get(atoms.problemRows),
      stats: get(atoms.stats),
      loading: get(atoms.loading),
      displayedQuery,
      resultsCurrent:
        displayedQuery !== undefined &&
        sameRef(displayedQuery.sandbox, sandbox.ref) &&
        displayedQuery.pageNumber === pageNumber &&
        displayedQuery.pageSize === pageSize &&
        displayedQuery.filters.state === filters.state &&
        displayedQuery.filters.kind === filters.kind &&
        displayedQuery.filters.resolution === filters.resolution &&
        displayedQuery.filters.needsAttention === filters.needsAttention,
      pagination: {
        total: page?.filteredTotal,
        pageCount:
          page === undefined || displayedQuery === undefined
            ? undefined
            : Math.ceil(page.filteredTotal / displayedQuery.pageSize),
        pages: cursors.map((_, index) => index + 1),
        current: pageNumber,
        hasPrevious: pageNumber > 1,
        hasNext: pageNumber < cursors.length
      },
      selected: get(atoms.selected),
      detail: get(atoms.detail),
      connection: get(atoms.connection),
      error: get(atoms.error),
      detailError: get(atoms.detailError),
      pending: get(atoms.pending),
      busy: get(atoms.busy),
      notice: get(atoms.notice)
    }
  })
  const snapshot = () => registry.get(stateAtom)
  let listRevision = 0
  let activeReads = 0
  let transport: Connection | undefined
  let detailRevision = 0
  // Ordinary background detail reads must not fence historical command receipts.
  let selectionRevision = 0
  let activeDetail:
    | { readonly revision: number; readonly sandbox: SandboxRef; readonly jobId: JobId }
    | undefined
  let disposed = false
  type Patch = Partial<Omit<State, "pagination" | "resultsCurrent">> & {
    readonly cursors?: ReadonlyArray<string | undefined>
  }
  const update = (patch: Patch) => {
    if (disposed) {
      return
    }
    // Batch keeps consumers from observing half-applied authority changes.
    Atom.batch(() => {
      const write = <K extends keyof typeof patch>(key: K) => {
        if (Object.hasOwn(patch, key)) {
          registry.set(
            atoms[key] as unknown as Atom.Writable<(typeof patch)[K]>,
            patch[key]
          )
        }
      }
      write("sandbox")
      write("filters")
      write("cursor")
      write("pageNumber")
      write("page")
      write("stats")
      write("problemRows")
      write("loading")
      write("pageSize")
      write("displayedQuery")
      write("cursors")
      write("selected")
      write("detail")
      write("connection")
      write("error")
      write("detailError")
      write("pending")
      write("busy")
      write("notice")
    })
  }
  const ensureRef = (ref: SandboxRef, expected: SandboxRef) =>
    sameRef(ref, expected)
      ? Effect.void
      : Effect.fail(new PlaygroundError({ code: "stale-generation" }))

  const revoke = () => {
    ++listRevision
    ++detailRevision
    ++selectionRevision
    update({
      page: undefined,
      problemRows: undefined,
      stats: undefined,
      displayedQuery: undefined,
      detail: undefined,
      selected: undefined,
      detailError: undefined,
      pending: undefined,
      cursor: undefined,
      pageNumber: 1,
      cursors: [undefined],
      loading: false
    })
  }
  const revokesAuthority = (code: PublicErrorCode) =>
    code === "sandbox-expired" || code === "stale-generation" || code === "not-found"

  const select = (jobId: JobId): Effect.Effect<void, never, JobsClient> =>
    Effect.gen(function* () {
      if (disposed) {
        return
      }
      const client = yield* JobsClient
      const sandbox = snapshot().sandbox.ref
      if (
        activeDetail?.revision === detailRevision &&
        activeDetail.jobId === jobId &&
        sameRef(activeDetail.sandbox, sandbox)
      ) {
        return
      }
      if (snapshot().selected !== jobId) {
        ++selectionRevision
      }
      const revision = ++detailRevision
      const request = { revision, sandbox, jobId }
      activeDetail = request
      activeReads++
      update({
        selected: jobId,
        detail: snapshot().selected === jobId ? snapshot().detail : undefined,
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
              if (error.code === "sandbox-expired" || error.code === "stale-generation") {
                revoke()
                update({ connection: "error", error: error.code })
              } else {
                update({ detail: undefined, detailError: error.code })
              }
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
            activeReads--
            if (activeDetail === request) {
              activeDetail = undefined
            }
          })
        )
      )
    })

  const read = (
    background: boolean,
    force = false
  ): Effect.Effect<void, never, JobsClient> =>
    Effect.gen(function* () {
      // A background read never steals ownership from any outstanding read.
      if (disposed || (background && !force && activeReads > 0)) {
        return
      }
      const client = yield* JobsClient
      const revision = ++listRevision
      activeReads++
      if (!background) {
        update({ loading: true })
      }
      yield* Effect.gen(function* () {
        const described = yield* bounded(client.describe()).pipe(
          Effect.flatMap(decode(SandboxView)),
          Effect.result
        )
        if (revision !== listRevision) {
          return
        }
        if (described._tag === "Failure") {
          if (revokesAuthority(described.failure.code)) {
            revoke()
          }
          update({
            connection: snapshot().page === undefined ? "error" : "stale",
            error: described.failure.code
          })
          return
        }
        const sandbox = described.success
        if (
          sandbox.ref.sandboxId !== snapshot().sandbox.ref.sandboxId &&
          !allowDemoRotation
        ) {
          revoke()
          update({
            connection: "error",
            error: "not-found"
          })
          return
        }
        if (
          sandbox.ref.sandboxId === snapshot().sandbox.ref.sandboxId &&
          sandbox.ref.generation < snapshot().sandbox.ref.generation
        ) {
          revoke()
          update({ connection: "error", error: "stale-generation" })
          return
        }
        if (!sameRef(sandbox.ref, snapshot().sandbox.ref)) {
          // Keep this read as the current owner while fencing old details/history.
          ++detailRevision
          ++selectionRevision
          update({
            page: undefined,
            stats: undefined,
            displayedQuery: undefined,
            detail: undefined,
            selected: undefined,
            detailError: undefined,
            pending: undefined,
            cursor: undefined,
            pageNumber: 1,
            cursors: [undefined],
            notice:
              "Sandbox generation changed. Old data and selection were revoked; filters retained."
          })
        }
        update({ sandbox })
        let query: Query = {
          sandbox: sandbox.ref,
          filters: snapshot().filters,
          pageNumber: snapshot().pageNumber,
          pageSize: snapshot().pageSize
        }
        let request: ListJobs = {
          sandbox: snapshot().sandbox.ref,
          filters: snapshot().filters,
          limit: query.pageSize,
          ...(snapshot().cursor === undefined ? {} : { cursor: snapshot().cursor })
        }
        let problemRows: ReadonlyArray<JobProblemRow> | undefined
        const fetchPage = (input: ListJobs) => {
          const problems =
            input.filters.resolution !== undefined ||
            input.filters.needsAttention === true
          const operation = problems
            ? bounded(client.problems(input)).pipe(
                Effect.flatMap(decode(JobProblemPage)),
                Effect.map((result) => {
                  problemRows = result.items
                  // Display only genuine retained summaries; tombstones render separately.
                  return {
                    ...result,
                    items: result.items.flatMap((row) =>
                      row.representative === null ? [] : [row.representative]
                    )
                  }
                })
              )
            : bounded(client.list(input)).pipe(Effect.flatMap(decode(JobPage)))
          return operation.pipe(
            Effect.flatMap((page) =>
              ensureRef(page.sandbox, input.sandbox).pipe(Effect.as(page))
            ),
            Effect.flatMap((page) =>
              page.items.length <= input.limit
                ? Effect.succeed(page)
                : Effect.fail(new PlaygroundError({ code: "unavailable" }))
            )
          )
        }
        yield* fetchPage(request).pipe(
          Effect.flatMap((page) => {
            if (
              revision !== listRevision ||
              query.pageNumber === 1 ||
              ((page.items.length > 0 || (problemRows?.length ?? 0) > 0) &&
                (query.pageNumber < Math.ceil(page.filteredTotal / query.pageSize) ||
                  (query.pageNumber === Math.ceil(page.filteredTotal / query.pageSize) &&
                    page.nextCursor === null)))
            ) {
              return Effect.succeed(page)
            }
            // Shrink can invalidate an anchor/history position. Restart once, bounded;
            // publish the normalized label and replacement together on success.
            query = { ...query, pageNumber: 1 }
            request = {
              sandbox: request.sandbox,
              filters: request.filters,
              limit: request.limit
            }
            return fetchPage(request)
          }),
          Effect.match({
            onFailure: (error) => {
              if (revision === listRevision) {
                if (revokesAuthority(error.code)) {
                  revoke()
                }
                update({
                  connection: snapshot().page === undefined ? "error" : "stale",
                  error: error.code
                })
              }
            },
            onSuccess: (page) => {
              if (revision === listRevision) {
                const known =
                  query.pageNumber === 1 && snapshot().pageNumber !== 1
                    ? [undefined]
                    : registry.get(atoms.cursors)
                // If the next anchor changes, descendants from the old chain are invalid.
                const cursors =
                  page.nextCursor === null
                    ? known.slice(0, query.pageNumber)
                    : known[query.pageNumber] === page.nextCursor
                      ? known
                      : [...known.slice(0, query.pageNumber), page.nextCursor]
                update({
                  page,
                  problemRows,
                  pageNumber: query.pageNumber,
                  cursor: request.cursor,
                  stats: page.stats,
                  displayedQuery: query,
                  cursors: cursors.slice(
                    0,
                    Math.max(1, Math.ceil(page.filteredTotal / query.pageSize))
                  ),
                  connection: transport ?? "connected",
                  error: undefined
                })
              }
            }
          })
        )
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            activeReads--
            if (revision === listRevision && !background) {
              update({ loading: false })
            }
          })
        )
      )
      const selected = disposed ? undefined : snapshot().selected
      if (
        revision === listRevision &&
        snapshot().connection === "connected" &&
        selected !== undefined
      ) {
        yield* select(selected)
      }
    })

  const refresh = read(false)
  const backgroundRefresh = read(true)

  const filter = (filters: JobFilters) =>
    Effect.gen(function* () {
      if (disposed) {
        return
      }
      update({ filters, cursor: undefined, pageNumber: 1, cursors: [undefined] })
      yield* refresh
    })
  const goTo = (pageNumber: number) =>
    Effect.gen(function* () {
      if (
        disposed ||
        !Number.isInteger(pageNumber) ||
        pageNumber < 1 ||
        pageNumber === snapshot().pageNumber ||
        pageNumber > registry.get(atoms.cursors).length
      ) {
        return
      }
      update({ cursor: registry.get(atoms.cursors)[pageNumber - 1], pageNumber })
      yield* refresh
    })
  const first = goTo(1)
  const previous = Effect.suspend(() =>
    snapshot().loading ? Effect.void : goTo(snapshot().pageNumber - 1)
  )
  const next = Effect.suspend(() =>
    snapshot().loading ? Effect.void : goTo(snapshot().pageNumber + 1)
  )
  const setPageSize = (pageSize: 20 | 50) =>
    Effect.gen(function* () {
      if (disposed || pageSize === snapshot().pageSize) {
        return
      }
      update({ pageSize, cursor: undefined, pageNumber: 1, cursors: [undefined] })
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
        if (result.current.generation <= snapshot().sandbox.ref.generation) {
          // This exact receipt acknowledges history, not newer sandbox authority.
          update({
            pending: undefined,
            notice: "Reset acknowledged. Current sandbox generation and data retained."
          })
          yield* refresh
          return
        }
        // Revoke displayed old data immediately, even if describe subsequently fails.
        revoke()
        update({
          sandbox: { ...snapshot().sandbox, ref: result.current },
          pending: undefined,
          page: undefined,
          detail: undefined,
          selected: undefined,
          cursor: undefined,
          pageNumber: 1,
          notice:
            "New generation with starter jobs. Old jobs and receipts are retained; reset does not cancel running jobs."
        })
        yield* refresh
      }
    })
  const exclusive = <E, R>(operation: Effect.Effect<void, E, R>) =>
    Effect.suspend(() => {
      if (disposed || snapshot().busy) {
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
        if (snapshot().pending !== undefined) {
          return
        }
        if (
          !(kind === "scenario"
            ? snapshot().sandbox.capabilities.runScenario
            : snapshot().sandbox.capabilities.resetSandbox)
        ) {
          update({ notice: "Capability unavailable. No command was sent." })
          return
        }
        if (disposed) {
          return
        }
        const client = yield* JobsClient
        const input = yield* Schema.decodeUnknownEffect(ScenarioCommand)({
          sandbox: snapshot().sandbox.ref,
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
        Effect.catchTags({
          PlaygroundError: (error) =>
            Effect.sync(() => {
              update({
                notice:
                  snapshot().pending === undefined
                    ? `Command unavailable: ${error.code}.`
                    : `Command not confirmed (${error.code}). Do not replay; reconcile the exact receipt.`
              })
            })
        })
      )
    )
  const acceptOperator = (
    result: JobOperatorResult,
    pending: Extract<NonNullable<State["pending"]>, { kind: "operator" }>
  ) =>
    Effect.gen(function* () {
      if (
        disposed ||
        snapshot().pending !== pending ||
        !sameRef(snapshot().sandbox.ref, pending.request.sandbox)
      ) {
        return
      }
      const command = pending.command
      yield* ensureRef(result.sandbox, command.sandbox)
      if (
        result.requestId !== command.requestId ||
        (result._tag !== "OutcomeUnknown" && result.action !== command.action) ||
        (result._tag === "Rejected" && result.jobId !== command.jobId) ||
        (result._tag === "Committed" &&
          (result.sourceJobId !== command.jobId ||
            result.sourceState !== command.expectedState ||
            result.sourceLifecycleVersion !== command.expectedLifecycleVersion))
      ) {
        return yield* new PlaygroundError({ code: "unavailable" })
      }
      if (result._tag === "OutcomeUnknown") {
        update({
          notice:
            "Operator outcome unknown. Do not replay. Look up the exact request receipt."
        })
        return
      }
      update({
        pending: undefined,
        notice:
          result._tag === "Rejected"
            ? `Operator rejected: ${result.reason}. No job was changed.`
            : result.action === "redrive"
              ? `Redrive acknowledged. New job: ${result.resultJobId}. Handler success is not confirmed.`
              : "Operator acknowledged. Reconciling current job state."
      })
      // Fence pre-operation reads; receipt state is historical, never a row patch.
      ++listRevision
      ++detailRevision
      update({ loading: false })
      yield* read(true, true)
    })
  const operate = (
    action: JobOperatorAction,
    requestId: string,
    confirmDuplicateEffects = false
  ) =>
    exclusive(
      Effect.gen(function* () {
        const state = snapshot()
        if (
          disposed ||
          state.pending !== undefined ||
          state.detail === undefined ||
          state.selected !== state.detail.job.jobId
        ) {
          return
        }
        const available = OperatorEligibility.eligibility(
          state.detail,
          state.sandbox,
          yield* Clock.currentTimeMillis
        )
        const entry =
          action === "retry-now"
            ? available.retryNow
            : action === "cancel"
              ? available.cancel
              : available.redrive
        if (!entry.enabled) {
          update({ notice: OperatorEligibility.explanation(entry.reason) })
          return
        }
        const command = yield* Schema.decodeUnknownEffect(JobOperatorCommand)(
          {
            sandbox: state.sandbox.ref,
            requestId,
            jobId: state.detail.job.jobId,
            expectedState: state.detail.job.state,
            expectedLifecycleVersion: state.detail.job.lifecycleVersion,
            action,
            ...(action === "redrive" ? { confirmDuplicateEffects } : {})
          },
          { onExcessProperty: "error" }
        ).pipe(Effect.mapError(() => new PlaygroundError({ code: "invalid-request" })))
        const pending = Object.freeze({
          kind: "operator" as const,
          command: Object.freeze({
            ...command,
            sandbox: Object.freeze({ ...command.sandbox })
          }),
          request: Object.freeze({
            sandbox: Object.freeze({ ...command.sandbox }),
            requestId: command.requestId
          })
        })
        const revision = selectionRevision
        update({ pending, notice: "Sending one operator request…" })
        const client = yield* JobsClient
        yield* bounded(client.operate(pending.command)).pipe(
          Effect.flatMap(decode(JobOperatorResult)),
          Effect.flatMap((result) =>
            revision === selectionRevision ? acceptOperator(result, pending) : Effect.void
          )
        )
      }).pipe(
        Effect.catchTags({
          PlaygroundError: (error) =>
            Effect.sync(() => {
              if (disposed) {
                return
              }
              if (snapshot().pending?.kind === "operator") {
                update({
                  notice: `Operator not confirmed (${error.code}). Do not replay; look up the exact receipt.`
                })
              } else {
                update({
                  notice: `Operator unavailable: ${error.code}. No command was sent.`
                })
              }
            })
        })
      )
    )
  const acceptRepair = (
    result: JobRepairResult | JobResolutionResult,
    pending: Extract<NonNullable<State["pending"]>, { kind: "repair" | "resolution" }>
  ) =>
    Effect.gen(function* () {
      if (
        disposed ||
        snapshot().pending !== pending ||
        !sameRef(snapshot().sandbox.ref, pending.request.sandbox)
      ) {
        return
      }
      yield* ensureRef(result.sandbox, pending.request.sandbox)
      if (result.requestId !== pending.request.requestId) {
        return yield* new PlaygroundError({ code: "unavailable" })
      }
      if (result._tag === "OutcomeUnknown") {
        update({
          notice: "Outcome unknown. Only the exact receipt may reconcile this command."
        })
        return
      }
      if (pending.kind === "repair") {
        if (
          (result._tag === "Rejected" &&
            (!("jobId" in result) || result.jobId !== pending.command.jobId)) ||
          (result._tag === "Committed" &&
            (!("sourceJobId" in result) ||
              result.sourceJobId !== pending.command.jobId ||
              result.action !== pending.command.action ||
              result.sourceState !== pending.command.expectedState ||
              result.sourceLifecycleVersion !== pending.command.expectedLifecycleVersion))
        ) {
          return yield* new PlaygroundError({ code: "unavailable" })
        }
      } else if (
        (result._tag === "Rejected" &&
          (!("rootJobId" in result) || result.rootJobId !== pending.command.rootJobId)) ||
        (result._tag === "Committed" &&
          result.problem.rootJobId !== pending.command.rootJobId)
      ) {
        return yield* new PlaygroundError({ code: "unavailable" })
      }
      update({
        pending: undefined,
        notice:
          result._tag === "Rejected"
            ? `Request rejected: ${result.reason}.`
            : "Acknowledged. Refreshing retained facts; execution state remains truthful."
      })
      ++listRevision
      ++detailRevision
      // The replacement read owns the revision; the old foreground finalizer cannot clear it.
      update({ loading: false })
      yield* read(true, true)
    })
  const repairCommand = (input: JobRepairCommand | JobResolutionCommand) =>
    exclusive(
      Effect.gen(function* () {
        const state = snapshot()
        if (
          state.pending !== undefined ||
          state.detail === undefined ||
          state.selected !== state.detail.job.jobId ||
          state.sandbox.expiresAt <= (yield* Clock.currentTimeMillis) ||
          allowDemoRotation
        ) {
          return
        }
        const repair = "jobId" in input
        if (
          !sameRef(input.sandbox, state.sandbox.ref) ||
          (repair
            ? input.jobId !== state.detail.job.jobId
            : input.rootJobId !== state.detail.problem?.rootJobId)
        ) {
          return
        }
        // The registry owns definitive identity. Snapshot validated JSON before the first yield to transport.
        const requestId = crypto.randomUUID()
        const command = repair
          ? yield* Schema.decodeUnknownEffect(JobRepairCommand)(
              { ...input, requestId },
              { onExcessProperty: "error" }
            ).pipe(
              Effect.mapError(() => new PlaygroundError({ code: "invalid-request" }))
            )
          : yield* Schema.decodeUnknownEffect(JobResolutionCommand)(
              { ...input, requestId },
              { onExcessProperty: "error" }
            ).pipe(
              Effect.mapError(() => new PlaygroundError({ code: "invalid-request" }))
            )
        const freeze = (value: unknown): void => {
          if (value !== null && typeof value === "object") {
            Object.values(value).forEach(freeze)
            Object.freeze(value)
          }
        }
        const snapshotCommand = structuredClone(command)
        freeze(snapshotCommand)
        const request = Object.freeze({ sandbox: snapshotCommand.sandbox, requestId })
        const pending: Extract<
          NonNullable<State["pending"]>,
          { kind: "repair" | "resolution" }
        > = repair
          ? { kind: "repair", request, command: snapshotCommand as JobRepairCommand }
          : {
              kind: "resolution",
              request,
              command: snapshotCommand as JobResolutionCommand
            }
        Object.freeze(pending)
        update({ pending, notice: "Sending one guarded request…" })
        const client = yield* JobsClient
        if (pending.kind === "repair") {
          yield* bounded(client.repair(pending.command)).pipe(
            Effect.flatMap(decode(JobRepairResult)),
            Effect.flatMap((result) => acceptRepair(result, pending))
          )
        } else {
          yield* bounded(client.resolve(pending.command)).pipe(
            Effect.flatMap(decode(JobResolutionResult)),
            Effect.flatMap((result) => acceptRepair(result, pending))
          )
        }
      }).pipe(
        Effect.catchTags({
          PlaygroundError: (error) =>
            Effect.sync(() =>
              update({
                notice: snapshot().pending
                  ? `Request not confirmed (${error.code}). Check its exact receipt; do not replay.`
                  : `Request unavailable: ${error.code}.`
              })
            )
        })
      )
    )
  const receipt = exclusive(
    Effect.gen(function* () {
      const pending = snapshot().pending
      if (pending === undefined) {
        return
      }
      if (disposed) {
        return
      }
      const client = yield* JobsClient
      update({ busy: true })
      if (pending.kind === "repair") {
        yield* bounded(client.repairReceipt(pending.request)).pipe(
          Effect.flatMap(decode(JobRepairResult)),
          Effect.flatMap((result) => acceptRepair(result, pending))
        )
      } else if (pending.kind === "resolution") {
        yield* bounded(client.resolutionReceipt(pending.request)).pipe(
          Effect.flatMap(decode(JobResolutionResult)),
          Effect.flatMap((result) => acceptRepair(result, pending))
        )
      } else if (pending.kind === "operator") {
        const revision = selectionRevision
        yield* bounded(client.operatorReceipt(pending.request)).pipe(
          Effect.flatMap(decode(JobOperatorResult)),
          Effect.flatMap((result) =>
            revision === selectionRevision ? acceptOperator(result, pending) : Effect.void
          )
        )
      } else if (pending.kind === "scenario") {
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
      Effect.catchTags({
        PlaygroundError: (error) =>
          Effect.sync(() =>
            update({
              notice: `Receipt lookup: ${error.code}. Absence does not authorize replay.`
            })
          )
      })
    )
  )
  return {
    atoms,
    registry,
    stateAtom,
    snapshot,
    reading: () => !disposed && activeReads > 0,
    refresh,
    backgroundRefresh,
    filter,
    first,
    next,
    previous,
    goTo,
    setPageSize,
    select,
    command,
    operate,
    repair: repairCommand,
    receipt,
    restore: (context: JobReturnContext | null, notice: string) => {
      ++listRevision
      ++detailRevision
      update({
        filters: context?.filters ?? {},
        pageSize: context?.pageSize === 50 ? 50 : 20,
        pageNumber: context?.pageNumber ?? 1,
        cursors: context?.cursors ?? [undefined],
        cursor: context?.cursors[(context?.pageNumber ?? 1) - 1],
        notice,
        page: undefined,
        displayedQuery: undefined,
        problemRows: undefined
      })
    },
    closeDetail: () => {
      ++detailRevision
      ++selectionRevision
      update({ selected: undefined, detail: undefined, detailError: undefined })
    },
    revokeAuthority: (code: "sandbox-expired" | "stale-generation") => {
      revoke()
      update({ connection: "error", error: code })
    },
    connection: (connection: Connection) => {
      if (connection === "connected" || connection === "reconnecting") {
        transport = connection
      }
      if (snapshot().error === undefined) {
        update({ connection })
      }
    },
    dispose: () => {
      disposed = true
      ++listRevision
      ++detailRevision
      ++selectionRevision
      registry.dispose()
    }
  }
}
