import { Effect, Exit, Layer } from "effect"
import type { JobSummary } from "@effect-jobs/playground-contracts/Jobs"
import type { SandboxView } from "@effect-jobs/playground-contracts/Sandbox"
import { ScenarioId } from "@effect-jobs/playground-contracts/Scenarios"
import { JobsClient, type Client } from "./Adapter.js"
import * as Controller from "./Controller.js"
import { compactTime, icon, jobIcon, jobName, type IconName } from "./Design.js"

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

const decoratedButton = (text: string, name: IconName, action: () => void) => {
  const node = button(text, action)
  node.prepend(icon(name))
  return node
}

// DOM/Promise/timer FFI stays here. Domain operations use Effect and a client tag.
// The returned cleanup owns the timer and aborts every outstanding UI operation.
export const mount = (
  root: HTMLElement,
  client: Client,
  sandbox: SandboxView,
  options: {
    readonly poll?: boolean
    readonly changed?: (state: Controller.State) => void
  } = {}
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
  const sidebar = element("aside")
  sidebar.className = "sidebar"
  sidebar.setAttribute("aria-label", "Workspace navigation")
  const brand = element("div")
  brand.className = "brand"
  const brandMark = element("span")
  brandMark.className = "brand-mark"
  brandMark.append(icon("layers"))
  const brandName = element("div")
  brandName.append(element("strong", "effect-jobs"), element("span", "Developer console"))
  brand.append(brandMark, brandName)
  const workspace = element("div")
  workspace.className = "workspace-switcher"
  const workspaceIcon = element("span", "P")
  workspaceIcon.className = "workspace-avatar"
  const workspaceName = element("div")
  workspaceName.append(
    element("strong", "Playground"),
    element("span", "Personal workspace")
  )
  workspace.append(workspaceIcon, workspaceName, icon("down"))
  const navigation = element("nav")
  navigation.className = "sidebar-navigation"
  navigation.setAttribute("aria-label", "Main navigation")
  navigation.append(element("p", "WORKSPACE"))
  const navigationItems: ReadonlyArray<readonly [string, IconName]> = [
    ["Overview", "grid"],
    ["Background Jobs", "jobs"],
    ["Activity", "activity"],
    ["Integrations", "layers"],
    ["Settings", "settings"]
  ]
  for (const [label, name] of navigationItems) {
    const item = decoratedButton(label, name, () => undefined)
    item.className = "sidebar-item"
    if (label === "Background Jobs") {
      item.classList.add("active")
      item.setAttribute("aria-current", "page")
    } else {
      item.disabled = true
      item.title = "Not available in this playground"
    }
    navigation.append(item)
  }
  const sidebarNote = element("div")
  sidebarNote.className = "sidebar-note"
  sidebarNote.append(
    icon("code"),
    element("strong", "Real jobs. Safe playground."),
    element("p", "A working demo of durable background jobs. All data is synthetic.")
  )
  const profile = element("div")
  profile.className = "sidebar-profile"
  const avatar = element("span", "DA")
  avatar.className = "profile-avatar"
  const profileName = element("div")
  profileName.append(element("strong", "Demo admin"), element("span", "Isolated sandbox"))
  profile.append(avatar, profileName, icon("shield"))
  sidebar.append(brand, workspace, navigation, sidebarNote, profile)

  const main = element("div")
  main.className = "dashboard-main"
  const topbar = element("div")
  topbar.className = "topbar"
  const breadcrumb = element("div")
  breadcrumb.className = "breadcrumb"
  breadcrumb.append(
    icon("grid"),
    element("span", "Workspace"),
    icon("chevron"),
    element("strong", "Background Jobs")
  )
  const environment = element("span", "Local playground")
  environment.className = "environment-badge"
  topbar.append(breadcrumb, environment)
  const canvas = element("div")
  canvas.className = "dashboard-canvas"
  const header = element("header")
  header.className = "page-header"
  const heading = element("div")
  const eyebrow = element("p", "WORKSPACE / OPERATIONS")
  eyebrow.className = "eyebrow"
  heading.append(
    eyebrow,
    element("h1", "Background Jobs"),
    element("p", "Every job, every state. Your background work, in one place.")
  )
  const headerActions = element("div")
  headerActions.className = "header-actions"
  header.append(heading, headerActions)
  const source = element(
    "p",
    `Source: ${client.source}. ${client.source === "mock" ? "UI development fixtures; no durable execution." : "Read observations do not prove exactly-once execution."}`
  )
  const scope = element("p")
  const status = element("p")
  status.setAttribute("role", "status")
  source.className = "source muted"
  scope.className = "sandbox-scope"
  status.className = "connection-status"
  const refresh = decoratedButton("Refresh reads", "refresh", () =>
    run(controller.refresh)
  )
  const openScenarios = decoratedButton("Create jobs", "plus", () => {
    scenarios.open = true
    scenarios.scrollIntoView({ behavior: "smooth", block: "center" })
    scenario.focus({ preventScroll: true })
  })
  openScenarios.className = "button-primary"
  headerActions.append(refresh, openScenarios)
  const stats = element("div")
  stats.className = "stats-grid"
  stats.setAttribute("aria-label", "Current page statistics")
  const metricValues: HTMLElement[] = []
  const metricNotes: HTMLElement[] = []
  const metricBars: HTMLElement[] = []
  for (const [title, name, tone] of [
    ["Total jobs", "jobs", "neutral"],
    ["In progress", "clock", "blue"],
    ["Completed", "check", "green"],
    ["Needs attention", "alert", "amber"]
  ] as const) {
    const card = element("section")
    card.className = `stat-card ${tone}`
    const label = element("div")
    label.className = "stat-label"
    label.append(element("span", title), icon(name))
    const value = element("strong", "—")
    value.className = "stat-value"
    const note = element("p", "Waiting for a snapshot")
    note.className = "stat-note"
    const bar = element("div")
    bar.className = "stat-distribution"
    bar.setAttribute("aria-hidden", "true")
    metricValues.push(value)
    metricNotes.push(note)
    metricBars.push(bar)
    card.append(label, value, note, bar)
    stats.append(card)
  }
  const statsCaption = element(
    "p",
    "CURRENT PAGE · Live snapshot, not global totals or historical trends."
  )
  statsCaption.className = "stats-caption"
  const filters = element("form")
  filters.className = "filter-bar"
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
  search.setAttribute("aria-label", "Search job ID on this page")
  const due = element("input")
  due.type = "checkbox"
  due.setAttribute("aria-label", "Due Pending on this page (browser clock)")
  due.title = "Pending jobs eligible on this page, using the browser clock"
  filters.append(
    field("State", stateFilter),
    field("Kind (exact)", kind),
    field("Search this page", search),
    field("Due now", due)
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
  quick.className = "state-tabs"
  quick.setAttribute("aria-label", "Quick views")
  const tabButtons = new Map<string, HTMLButtonElement>()
  for (const tab of [
    "All jobs",
    "Pending",
    "RetryScheduled",
    "Active",
    "Completed",
    "Dead",
    "Isolated"
  ] as const) {
    const control = button(tab === "RetryScheduled" ? "Retry scheduled" : tab, () => {
      stateFilter.value = tab === "All jobs" ? "" : tab
      run(
        controller.filter({
          ...(kind.value === "" ? {} : { kind: kind.value }),
          ...(tab === "All jobs" ? {} : { state: tab })
        })
      )
    })
    control.className = "state-tab"
    tabButtons.set(tab, control)
    quick.append(control)
  }
  const expired = element("button", "Expired lease · unavailable")
  expired.type = "button"
  expired.disabled = true
  quick.append(expired)
  const limits = element("details")
  const limitText = element(
    "p",
    "Order: job ID ascending. Global search, alternative sorting, total counters and lease-expiry filters are unavailable. Page counters describe the current read only."
  )
  limits.className = "read-limitations muted"
  limits.append(element("summary", "Read limitations"), limitText)
  const counters = element("p")
  counters.className = "table-count"
  const content = element("div")
  content.className = "jobs-layout"
  const list = element("section")
  list.setAttribute("aria-label", "Jobs list")
  list.className = "jobs-panel"
  const empty = element("div")
  empty.className = "empty-state"
  const emptyTitle = element("strong")
  const emptyHint = element("p")
  empty.append(icon("jobs"), emptyTitle, emptyHint)
  const tableScroll = element("div")
  tableScroll.className = "table-scroll"
  const table = element("table")
  table.className = "jobs-table"
  table.setAttribute("aria-label", "Background jobs")
  const tableHead = element("thead")
  const headings = element("tr")
  for (const title of ["Job", "Queue", "Status", "Attempts", "Updated", "Failure code"]) {
    const cell = element("th", title)
    cell.scope = "col"
    headings.append(cell)
  }
  tableHead.append(headings)
  const rows = element("tbody")
  rows.className = "job-list"
  table.append(tableHead, rows)
  tableScroll.append(table)
  const pagination = element("nav")
  pagination.setAttribute("aria-label", "Pagination")
  const first = button("First page", () => run(controller.first))
  const next = button("Next page", () => run(controller.next))
  const pageLabel = element("span")
  pagination.append(first, pageLabel, next)
  pagination.className = "pagination"
  const panelHeader = element("div")
  panelHeader.className = "panel-heading"
  const panelTitle = element("div")
  panelTitle.append(element("h2", "All background jobs"), counters)
  const sortLabel = element("span", "Job ID ↑")
  sortLabel.className = "sort-label"
  sortLabel.title = "The current API supports job ID ascending only"
  panelHeader.append(panelTitle, sortLabel)
  list.append(panelHeader, quick, filters, limits, tableScroll, empty, pagination)
  const detail = element("section")
  detail.setAttribute("aria-label", "Job details")
  detail.tabIndex = -1
  detail.className = "detail-panel"
  detail.hidden = true
  const detailHeading = element("div")
  detailHeading.className = "detail-heading"
  const closeDetail = () => {
    detail.hidden = true
    content.classList.remove("has-detail")
    const selected = controller.snapshot().selected
    if (selected !== undefined) {
      rowNodes.get(selected)?.button.focus({ preventScroll: true })
    }
  }
  const close = decoratedButton("Close details", "close", closeDetail)
  close.className = "icon-button"
  close.setAttribute("aria-label", "Close details")
  detailHeading.append(element("h2", "Job details"), close)
  detail.append(detailHeading)
  const detailBody = element("div")
  detail.append(detailBody)
  content.append(list, detail)
  const scenarios = element("details")
  scenarios.className = "scenario-panel"
  scenarios.setAttribute("role", "region")
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
  const scenarioSummary = element("summary")
  const scenarioTitle = element("div")
  scenarioTitle.className = "scenario-summary-title"
  scenarioTitle.append(
    icon("terminal"),
    element("strong", "Scenario lab"),
    element("span", "Create jobs. Simulate failures. See what happens.")
  )
  scenarioSummary.append(scenarioTitle, icon("plus"))
  launch.className = "button-primary"
  const scenarioBody = element("div")
  scenarioBody.className = "scenario-body"
  scenarioBody.append(
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
  scenarioBody.append(capabilities)
  scenarios.append(scenarioSummary, scenarioBody)
  const shared = element("section")
  shared.className = "shared-feed muted"
  shared.append(
    element("h2", "Shared feed"),
    element(
      "p",
      "Read-only shared feed unavailable in the frozen API. Your sandbox data is never treated as a public feed."
    )
  )
  const docs = element("section")
  docs.className = "playground-guide"
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
  const sessionBar = element("div")
  sessionBar.className = "session-bar"
  sessionBar.append(status, scope)
  const footer = element("footer")
  footer.className = "dashboard-footer"
  footer.append(source, element("span", "effect-jobs · initial alpha"))
  canvas.append(
    header,
    stats,
    statsCaption,
    content,
    sessionBar,
    scenarios,
    docs,
    shared,
    footer
  )
  main.append(topbar, canvas)
  root.replaceChildren(sidebar, main)
  let lastDetail: Controller.State["detail"]
  let lastDetailError: Controller.State["detailError"]
  let lastSelected: string | undefined
  const rowNodes = new Map<
    string,
    {
      readonly li: HTMLTableRowElement
      readonly button: HTMLButtonElement
      readonly state: HTMLSpanElement
      readonly queue: HTMLTableCellElement
      readonly attempts: HTMLTableCellElement
      readonly updated: HTMLTableCellElement
      readonly failure: HTMLTableCellElement
    }
  >()
  const renderRows = (state: Controller.State) => {
    const all = state.page?.items ?? []
    const visible = all.filter(
      (job) =>
        job.jobId.toLowerCase().includes(search.value.toLowerCase()) &&
        (!due.checked || (job.state === "Pending" && job.availableAt <= Date.now()))
    )
    counters.textContent = `${all.length} on current page · ${visible.length} visible`
    const completed = all.filter((job) => job.state === "Completed").length
    const active = all.filter((job) =>
      ["Pending", "RetryScheduled", "Active"].includes(job.state)
    ).length
    const attention = all.filter(
      (job) => job.state === "Dead" || job.state === "Isolated"
    ).length
    for (const [index, value] of [all.length, active, completed, attention].entries()) {
      const metric = metricValues[index]
      if (metric !== undefined) {
        metric.textContent =
          state.page === undefined ? "—" : String(value).padStart(2, "0")
      }
    }
    const notes = [
      "Jobs in this page snapshot",
      "Pending, retry scheduled & active",
      all.length === 0
        ? "No completed jobs yet"
        : `${Math.round((completed / all.length) * 100)}% of this page completed`,
      `${all.filter((job) => job.state === "Dead").length} dead · ${all.filter((job) => job.state === "Isolated").length} isolated`
    ]
    metricNotes.forEach((note, index) => {
      note.textContent = notes[index] ?? ""
    })
    // Distribution bars describe the current snapshot, never fabricated historical trends.
    for (const [index, bar] of metricBars.entries()) {
      const values =
        index === 0
          ? [active, completed, attention]
          : ([
              [active, all.length - active],
              [completed, all.length - completed],
              [attention, all.length - attention]
            ][index - 1] ?? [])
      bar.replaceChildren(
        ...values.map((value, part) => {
          const segment = element("span")
          segment.className = `distribution-segment part-${part}`
          segment.style.flexGrow = String(value)
          segment.hidden = value === 0
          return segment
        })
      )
    }
    emptyTitle.textContent =
      state.page === undefined
        ? "Connecting to your workspace"
        : visible.length === 0
          ? "No jobs match on this page"
          : ""
    emptyHint.textContent =
      state.page === undefined
        ? "Your live job snapshot will appear here."
        : all.length === 0
          ? "Create a scenario to see background jobs in action. Other pages may contain matches."
          : "Try different filters. Other pages may contain matches."
    empty.hidden = visible.length !== 0
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
        const li = element("tr")
        const select = button(job.jobId, () => {
          detail.hidden = false
          content.classList.add("has-detail")
          run(controller.select(job.jobId))
          detail.focus()
        })
        select.className = "job-id"
        select.title = job.jobId
        const identity = element("td")
        const identityWrap = element("div")
        identityWrap.className = "job-identity"
        const mark = element("span")
        mark.className = "job-icon"
        mark.append(icon(jobIcon(job.catalog.kind)))
        const description = element("div")
        const name = element("strong", jobName(job.catalog.kind))
        name.className = "job-name"
        name.title = `${job.catalog.kind} v${job.catalog.version}`
        description.append(name, select)
        identityWrap.append(mark, description)
        identity.append(identityWrap)
        const queue = element("td")
        const stateCell = element("td")
        const stateBadge = element("span")
        stateCell.append(stateBadge)
        const attempts = element("td")
        const updated = element("td")
        const failure = element("td")
        li.append(identity, queue, stateCell, attempts, updated, failure)
        nodes = {
          li,
          button: select,
          state: stateBadge,
          queue,
          attempts,
          updated,
          failure
        }
        rowNodes.set(job.jobId, nodes)
      }
      nodes.button.setAttribute("aria-pressed", String(state.selected === job.jobId))
      nodes.li.classList.toggle("selected", state.selected === job.jobId)
      nodes.state.className = `state-badge state-${job.state.toLowerCase()}`
      nodes.state.textContent =
        job.state === "RetryScheduled" ? "Retry scheduled" : job.state
      nodes.queue.textContent = job.catalog.queue
      nodes.queue.className = "queue-cell"
      nodes.attempts.textContent = String(job.attemptsMade).padStart(2, "0")
      nodes.attempts.className = "attempts-cell"
      nodes.attempts.title = "Finalized attempts, not all handler invocations"
      nodes.updated.textContent = compactTime(job.updatedAt)
      nodes.updated.className = "updated-cell"
      nodes.failure.textContent = job.lastFailureCode ?? "—"
      nodes.failure.className = "failure-cell"
      if (rows.children[index] !== nodes.li) {
        rows.insertBefore(nodes.li, rows.children[index] ?? null)
      }
    })
  }
  const render = (state: Controller.State) => {
    scope.textContent = `Own sandbox: ${state.sandbox.ref.sandboxId} · generation ${state.sandbox.ref.generation} · expires ${time(state.sandbox.expiresAt)}`
    status.textContent = `${state.connection}${state.error === undefined ? "" : ` · ${state.error}`} · ${state.connection === "stale" ? "Last successful data retained; it may be outdated." : "Reconciles reads every 5 seconds while visible."}`
    status.dataset.connection = state.connection
    for (const [tab, control] of tabButtons) {
      control.setAttribute(
        "aria-pressed",
        String((state.filters.state ?? "All jobs") === tab)
      )
    }
    if (state.selected === undefined) {
      detail.hidden = true
      content.classList.remove("has-detail")
    }
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
  const publish = (state: Controller.State) => {
    render(state)
    options.changed?.(state)
  }
  const controller = Controller.make(sandbox, publish)
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
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !detail.hidden) {
      closeDetail()
    }
  }
  window.addEventListener("keydown", escape)
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
      window.removeEventListener("keydown", escape)
      document.removeEventListener("visibilitychange", reconcile)
      root.replaceChildren()
    }
  }
}
