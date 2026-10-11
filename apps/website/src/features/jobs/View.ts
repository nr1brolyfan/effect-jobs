import { Effect, Exit, Layer } from "effect"
import type { JobSummary } from "@effect-jobs/playground-contracts/Jobs"
import type { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import { ScenarioId } from "@effect-jobs/playground-contracts/Scenarios"
import { JobsClient, type Client } from "./Adapter.js"
import * as Controller from "./Controller.js"

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const node = document.createElement(tag)
  if (text !== undefined) {
    node.textContent = text
  }
  return node
}
const button = (text: string, action: () => void) => {
  const node = element("button", text)
  node.type = "button"
  node.addEventListener("click", action)
  return node
}
let fieldId = 0
const field = (text: string, control: HTMLElement) => {
  const label = element("label", text)
  control.id = `jobs-field-${++fieldId}`
  label.htmlFor = control.id
  const wrapper = element("div")
  wrapper.className = "jobs-field"
  wrapper.append(label, control)
  return wrapper
}
const option = (value: string, text: string) => {
  const node = element("option", text)
  node.value = value
  return node
}
const time = (millis: number | null) =>
  millis === null ? "Not recorded" : new Date(millis).toISOString()

// DOM/Promise/timer FFI stays here. Domain operations use Effect and a client tag.
// The returned cleanup owns the timer and aborts every outstanding UI operation.
export const mount = (
  root: HTMLElement,
  client: Client,
  sandbox: SandboxView,
  options: { readonly poll?: boolean } = {}
) => {
  const lifecycle = new AbortController()
  const layer = Layer.succeed(JobsClient, client)
  const run = (operation: Effect.Effect<void, never, JobsClient>) => {
    void Effect.runPromiseExit(operation.pipe(Effect.provide(layer)), {
      signal: lifecycle.signal
    }).then((exit) => {
      if (Exit.isFailure(exit) && !lifecycle.signal.aborted) {
        controller.connection("error")
        notice.textContent =
          "Request not confirmed. Refresh reads; never replay an uncertain command."
      }
    })
  }
  const header = element("header")
  header.append(
    element("p", "EFFECT JOBS / PLAYGROUND"),
    element("h1", "Durable work, visible."),
    element("p", "Explore job states and persisted policy with synthetic data.")
  )
  const source = element(
    "p",
    `Source: ${client.source}. ${client.source === "mock" ? "UI development fixtures; no durable execution." : "Read observations do not prove exactly-once execution."}`
  )
  source.className = "source"
  const scope = element("p")
  const status = element("p")
  status.setAttribute("role", "status")
  const refresh = button("Refresh reads", () => run(controller.refresh))
  const filters = element("form")
  filters.setAttribute("aria-label", "Job filters")
  const stateFilter = element("select")
  stateFilter.append(
    option("", "All states"),
    ...["Pending", "RetryScheduled", "Active", "Completed", "Dead", "Isolated"].map(
      (state) => option(state, state)
    )
  )
  const kind = element("input")
  kind.type = "text"
  kind.placeholder = "Exact kind"
  kind.maxLength = 128
  const search = element("input")
  search.type = "search"
  search.placeholder = "Search this page"
  search.maxLength = 128
  const due = element("input")
  due.type = "checkbox"
  filters.append(
    field("State", stateFilter),
    field("Kind (exact)", kind),
    field("Search job ID on this page", search),
    field("Due Pending on this page (browser clock)", due)
  )
  const apply = element("button", "Apply filters")
  apply.type = "submit"
  filters.append(apply)
  filters.addEventListener("submit", (event) => {
    event.preventDefault()
    const state = stateFilter.value as Controller.State["filters"]["state"]
    run(
      controller.filter({
        ...(stateFilter.value === "" || state === undefined ? {} : { state }),
        ...(kind.value === "" ? {} : { kind: kind.value })
      })
    )
  })
  const quick = element("nav")
  quick.setAttribute("aria-label", "Quick views")
  for (const state of ["Dead", "Isolated"] as const) {
    quick.append(
      button(state, () => {
        stateFilter.value = state
        run(controller.filter({ ...controller.snapshot().filters, state }))
      })
    )
  }
  const expired = element("button", "Expired lease · unavailable")
  expired.type = "button"
  expired.disabled = true
  quick.append(expired)
  const limits = element(
    "p",
    "Order: job ID ascending. Global search, alternative sorting, total counters and lease-expiry filters are unavailable. Page counters describe the current read only."
  )
  limits.className = "muted"
  const counters = element("p")
  const content = element("div")
  content.className = "jobs-layout"
  const list = element("section")
  list.setAttribute("aria-label", "Jobs list")
  const empty = element("p")
  const rows = element("ul")
  rows.className = "job-list"
  const pagination = element("nav")
  pagination.setAttribute("aria-label", "Pagination")
  const first = button("First page", () => run(controller.first))
  const next = button("Next page", () => run(controller.next))
  const pageLabel = element("span")
  pagination.append(first, pageLabel, next)
  list.append(element("h2", "Jobs"), counters, empty, rows, pagination)
  const detail = element("section")
  detail.setAttribute("aria-label", "Job details")
  detail.tabIndex = -1
  detail.append(element("h2", "Job details"))
  const detailBody = element("div")
  detail.append(detailBody)
  content.append(list, detail)
  const scenarios = element("section")
  scenarios.setAttribute("aria-label", "Scenario launcher")
  const scenario = element("select")
  for (const id of ScenarioId.literals) {
    scenario.append(option(id, id))
  }
  const count = element("input")
  count.type = "number"
  count.min = "1"
  count.max = "10"
  count.value = "1"
  const launch = button("Run scenario", () =>
    run(
      controller.command(
        "scenario",
        crypto.randomUUID(),
        scenario.value as typeof ScenarioId.Type,
        count.valueAsNumber
      )
    )
  )
  const reset = button("Reset my sandbox", () => {
    if (
      window.confirm(
        "Reset only your sandbox generation? Running jobs are not cancelled."
      )
    ) {
      run(controller.command("reset", crypto.randomUUID(), "success", 1))
    }
  })
  const receipt = button("Check exact request receipt", () => run(controller.receipt))
  const notice = element("p")
  notice.setAttribute("role", "status")
  const request = element("p")
  scenarios.append(
    element("h2", "Synthetic scenarios"),
    element(
      "p",
      "Scenarios choose fake provider behavior. No live email, payment or outbound webhook. The backend rechecks permissions and limits."
    ),
    field("Fake provider behavior", scenario),
    field("Jobs (1–10)", count),
    launch,
    reset,
    receipt,
    request,
    notice
  )
  const capabilities = element("p")
  scenarios.append(capabilities)
  const shared = element("section")
  shared.append(
    element("h2", "Shared feed"),
    element(
      "p",
      "Read-only shared feed unavailable in the frozen API. Your sandbox data is never treated as a public feed."
    )
  )
  const docs = element("section")
  docs.id = "jobs-explained"
  docs.append(element("h2", "How to read this playground"))
  const guide = element("a", "Read the jobs guide")
  guide.href = "/docs/jobs"
  docs.append(guide)
  const explanations = [
    [
      "States",
      "Pending waits for eligibility; RetryScheduled waits after a finalized retry; Active is owned by a worker; Completed, Dead and Isolated describe durable lifecycle state. Isolated is not automatically purged."
    ],
    [
      "Unknown outcomes",
      "A lost response does not prove rollback. Check the exact request receipt. Receipt absence does not grant permission to replay."
    ],
    [
      "Attempts and leases",
      "Attempts count finalized attempts, not all handler invocations. Unknown recovery may repeat an attempt number. Lease tokens and expiry are not exposed by this read API."
    ],
    [
      "Privacy and isolation",
      "Only allowlisted metadata and synthetic relations are visible. Payloads, protected fields, ciphertext and fingerprints are not exposed. Sandbox reset changes visibility and admission; it does not cancel workers."
    ],
    [
      "Live reads",
      "Pages are current reads, not historical snapshots. State changes may move rows between pages. Refresh keeps your current cursor and filters; First page explicitly restarts pagination."
    ]
  ]
  for (const [title, text] of explanations) {
    const item = element("details")
    item.append(element("summary", title), element("p", text))
    docs.append(item)
  }
  root.classList.add("jobs-app")
  root.replaceChildren(
    header,
    source,
    scope,
    status,
    refresh,
    filters,
    quick,
    limits,
    content,
    scenarios,
    shared,
    docs
  )
  let lastDetail: Controller.State["detail"]
  let lastDetailError: Controller.State["detailError"]
  let lastSelected: string | undefined
  const rowNodes = new Map<
    string,
    {
      readonly li: HTMLLIElement
      readonly button: HTMLButtonElement
      readonly meta: HTMLParagraphElement
    }
  >()
  const renderRows = (state: Controller.State) => {
    const all = state.page?.items ?? []
    const visible = all.filter(
      (job) =>
        job.jobId.toLowerCase().includes(search.value.toLowerCase()) &&
        (!due.checked || (job.state === "Pending" && job.availableAt <= Date.now()))
    )
    counters.textContent = `${all.length} on current page · ${visible.length} visible · ${["Pending", "RetryScheduled", "Active", "Completed", "Dead", "Isolated"].map((name) => `${name} ${all.filter((job) => job.state === name).length}`).join(" / ")}`
    empty.textContent =
      state.page === undefined
        ? "Waiting for a read."
        : visible.length === 0
          ? "No jobs match on this page. Other pages may contain matches."
          : ""
    const wanted = new Set<string>(visible.map((job) => job.jobId))
    for (const [id, nodes] of rowNodes) {
      if (!wanted.has(id)) {
        nodes.li.remove()
        rowNodes.delete(id)
      }
    }
    visible.forEach((job: JobSummary, index) => {
      let nodes = rowNodes.get(job.jobId)
      if (nodes === undefined) {
        const li = element("li")
        const select = button(job.jobId, () => {
          run(controller.select(job.jobId))
          detail.focus()
        })
        const meta = element("p")
        li.append(select, meta)
        nodes = { li, button: select, meta }
        rowNodes.set(job.jobId, nodes)
      }
      nodes.button.setAttribute("aria-pressed", String(state.selected === job.jobId))
      nodes.meta.textContent = `${job.state} · ${job.catalog.kind} v${job.catalog.version} · ${job.attemptsMade} finalized attempt(s)`
      if (rows.children[index] !== nodes.li) {
        rows.insertBefore(nodes.li, rows.children[index] ?? null)
      }
    })
  }
  const render = (state: Controller.State) => {
    scope.textContent = `Own sandbox: ${state.sandbox.ref.sandboxId} · generation ${state.sandbox.ref.generation} · expires ${time(state.sandbox.expiresAt)}`
    status.textContent = `${state.connection}${state.error === undefined ? "" : ` · ${state.error}`} · ${state.connection === "stale" ? "Last successful data retained; it may be outdated." : "Reconciles reads every 5 seconds while visible."}`
    first.disabled = state.cursor === undefined
    next.disabled =
      state.connection !== "connected" ||
      state.page?.nextCursor === null ||
      state.page === undefined
    pageLabel.textContent = `Page ${state.pageNumber}`
    renderRows(state)
    if (
      lastDetail !== state.detail ||
      lastDetailError !== state.detailError ||
      lastSelected !== state.selected ||
      detailBody.childNodes.length === 0
    ) {
      const focusedLink = detailBody.querySelector('a[href="#synthetic-entities"]')
      const restoreLinkFocus =
        focusedLink !== null &&
        document.activeElement === focusedLink &&
        lastDetail !== undefined &&
        state.detail !== undefined &&
        lastDetail.job.jobId === state.detail.job.jobId &&
        lastDetail.sandbox.sandboxId === state.detail.sandbox.sandboxId &&
        lastDetail.sandbox.generation === state.detail.sandbox.generation &&
        lastDetail.relations.syntheticOrderId === state.detail.relations.syntheticOrderId
      lastDetail = state.detail
      lastDetailError = state.detailError
      lastSelected = state.selected
      detailBody.replaceChildren()
      const d = state.detail
      if (d === undefined) {
        detailBody.append(
          element(
            "p",
            state.detailError !== undefined
              ? `Detail: ${state.detailError}. Selection retained.`
              : state.selected === undefined
                ? "Select a job to inspect its metadata."
                : "Loading selected job…"
          )
        )
      } else {
        const values = element("dl")
        const value = (label: string, text: string) => {
          values.append(element("dt", label), element("dd", text))
        }
        value("Job ID", d.job.jobId)
        value("State", d.job.state)
        value(
          "Catalog",
          `${d.job.catalog.queue} / ${d.job.catalog.kind} / v${d.job.catalog.version}`
        )
        value(
          "Producer identity",
          `${d.producer.operation} / ${d.producer.operationId} / ${d.producer.slot}`
        )
        value("Available", time(d.job.availableAt))
        value("Updated", time(d.job.updatedAt))
        value("Terminal timestamp", time(d.job.completedAt))
        value(
          "Finalized attempts / stalled recoveries / lifecycle version",
          `${d.job.attemptsMade} / ${d.job.stalledCount} / ${d.job.lifecycleVersion}`
        )
        value("Failure code", d.job.lastFailureCode ?? "None recorded")
        value("Synthetic actor", d.relations.syntheticActor ?? "Not supplied")
        value(
          "Lease / attempt timeout",
          `${d.policy.leaseDurationMillis}ms / ${d.policy.attemptTimeoutMillis}ms`
        )
        value(
          "Attempt / stalled limits",
          `${d.policy.maxAttempts} / ${d.policy.maxStalledCount}`
        )
        value("Retry delay", `${d.policy.retrySchedule.delayMillis}ms (fixed)`)
        value(
          "Completed / Dead retention",
          `${d.policy.completedRetention._tag === "Forever" ? "Forever" : `${d.policy.completedRetention.millis}ms`} / ${d.policy.deadRetention._tag === "Forever" ? "Forever" : `${d.policy.deadRetention.millis}ms`}`
        )
        value(
          "Observation",
          d.observation === undefined
            ? "Unknown; no observation supplied."
            : `${d.observation.outcome} · ${d.observation.source} · ${time(d.observation.observedAt)}`
        )
        detailBody.append(values)
        if (d.observation?.outcome === "unknown") {
          detailBody.append(
            element("p", "Unknown outcome: do not infer success or replay safety.")
          )
        }
        if (d.relations.syntheticOrderId !== undefined) {
          const link = element("a", `${d.relations.syntheticOrderId} (synthetic example)`)
          link.href = "#synthetic-entities"
          detailBody.append(link)
          if (restoreLinkFocus) {
            link.focus({ preventScroll: true })
          }
        }
        detailBody.append(
          element(
            "p",
            "Payload and protected fields are unavailable. Lease ownership and complete history are not exposed."
          )
        )
        for (const name of ["Retry", "Cancel", "Redrive"]) {
          const control = element("button", `${name} · unavailable`)
          control.type = "button"
          control.disabled = true
          detailBody.append(control)
        }
      }
    }
    const unavailable =
      state.busy || state.pending !== undefined || state.sandbox.expiresAt <= Date.now()
    launch.disabled = unavailable || !state.sandbox.capabilities.runScenario
    reset.disabled = unavailable || !state.sandbox.capabilities.resetSandbox
    receipt.disabled = state.pending === undefined || state.busy
    request.textContent =
      state.pending === undefined
        ? ""
        : `Pending ${state.pending.kind} request: ${state.pending.request.requestId}`
    notice.textContent = state.notice
    capabilities.textContent = `Scenario: ${state.sandbox.capabilities.runScenario ? "available" : "unavailable"}; reset: ${state.sandbox.capabilities.resetSandbox ? "available" : "unavailable"}. Retry/cancel/redrive are not wired to any supported command in this UI.`
  }
  const controller = Controller.make(sandbox, render)
  const localFilter = () => renderRows(controller.snapshot())
  search.addEventListener("input", localFilter)
  due.addEventListener("change", localFilter)
  const entities = element(
    "p",
    "demo-order-a / demo-order-b / demo-customer: synthetic application relations, not external accounts."
  )
  entities.id = "synthetic-entities"
  docs.append(entities)
  const reconcile = () => {
    if (document.visibilityState !== "hidden" && !controller.reading()) {
      run(controller.refresh)
    }
  }
  const reconnect = () => {
    controller.connection("reconnecting")
    reconcile()
  }
  const offline = () => controller.connection("stale")
  window.addEventListener("online", reconnect)
  window.addEventListener("offline", offline)
  document.addEventListener("visibilitychange", reconcile)
  const timer = options.poll === false ? undefined : window.setInterval(reconcile, 5_000)
  render(controller.snapshot())
  run(controller.refresh)
  return {
    controller,
    dispose: () => {
      controller.dispose()
      lifecycle.abort()
      if (timer !== undefined) {
        window.clearInterval(timer)
      }
      window.removeEventListener("online", reconnect)
      window.removeEventListener("offline", offline)
      document.removeEventListener("visibilitychange", reconcile)
      root.replaceChildren()
    }
  }
}
