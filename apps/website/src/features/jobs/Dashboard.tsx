import { JobDetailsDrawer } from "./details/JobDetailsDrawer.js"
import { JobDetailsPage } from "./details/JobDetailsPage.js"
import { SyntheticDocumentSession } from "./payload/SyntheticDocumentSession.js"
import { JobPayloadPanel } from "./payload/JobPayloadPanel.js"
import { JobRepairPanel } from "./repair/JobRepairPanel.js"
import { useAtomValue } from "@effect/atom-react"
import * as stylex from "@stylexjs/stylex"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef
} from "@tanstack/react-table"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { JobSummary } from "@effect-jobs/playground-contracts/Jobs"
import { ScenarioId } from "@effect-jobs/playground-contracts/Scenarios"
import { DateTime } from "../../ui/DateTime.js"
import { Pagination } from "../../ui/Pagination.js"
import {
  Badge,
  Button,
  Field,
  Icon,
  TabsRoot,
  TabsList,
  TabsTab,
  TabsPanel
} from "../../ui/Primitives.js"
import { stateOrder, stateLabels } from "../../ui/Theme.stylex.js"
import { StatsChart } from "./StatsChart.js"
import { jobIcon, jobName, type IconName } from "./Design.js"
import { styles, layout } from "./Dashboard.stylex.js"
import * as OperatorEligibility from "./OperatorEligibility.js"
import { OperatorControls } from "./OperatorControls.js"
import type { Runtime } from "./Runtime.js"

// Semantic class names remain stable for browser qualification; all styling is compiled.
const classStyles = {
  "jobs-app": layout.app,
  sidebar: layout.sidebar,
  brand: layout.brand,
  "brand-mark": layout.brandMark,
  "workspace-switcher": layout.workspace,
  "workspace-avatar": layout.avatar,
  "sidebar-navigation": layout.nav,
  "sidebar-item": layout.navButton,
  active: layout.navActive,
  "sidebar-note": layout.sidebarNote,
  "sidebar-profile": layout.profile,
  "profile-avatar": layout.avatar,
  "dashboard-main": layout.main,
  topbar: layout.topbar,
  breadcrumb: layout.breadcrumb,
  "environment-badge": layout.environment,
  "dashboard-canvas": layout.canvas,
  "page-header": layout.header,
  eyebrow: layout.eyebrow,
  "header-actions": layout.actions,
  "jobs-overview": layout.overview,
  "stats-grid": layout.stats,
  "stat-card": layout.stat,
  "stat-label": layout.statLabel,
  "stat-value": layout.statValue,
  "stat-note": layout.statNote,
  "jobs-layout": layout.jobsLayout,
  "has-detail": layout.withDetail,
  "jobs-panel": layout.panel,
  "panel-heading": layout.panelHeading,
  "state-tabs": layout.tabs,
  "state-tab": layout.tab,
  "active-tab": layout.tabActive,
  "filter-bar": layout.filters,
  "table-scroll": layout.scroll,
  "jobs-table": layout.table,
  "job-identity": layout.identity,
  "job-icon": layout.jobIcon,
  "job-name": layout.jobName,
  "job-id": layout.jobId,
  "queue-cell": layout.cell,
  "updated-cell": layout.cell,
  "failure-cell": layout.cell,
  selected: styles.selected,
  pagination: layout.pagination,
  "empty-state": layout.empty,
  "detail-panel": layout.detail,
  "detail-heading": layout.detailHeading,
  "scenario-panel": layout.scenario,
  "scenario-summary-title": layout.summaryTitle,
  "scenario-body": layout.scenarioBody,
  "session-bar": layout.session,
  "sandbox-scope": layout.scope,
  muted: styles.muted
} satisfies Record<string, stylex.StyleXStyles>
const classes = (names: string) => {
  const props = stylex.props(
    names.endsWith("-cell") && layout.td,
    ...names.split(" ").map((name) => classStyles[name as keyof typeof classStyles])
  )
  return { ...props, className: [names, props.className].filter(Boolean).join(" ") }
}

const navigation: ReadonlyArray<readonly [string, IconName]> = [
  ["Overview", "grid"],
  ["Background Jobs", "jobs"],
  ["Activity", "activity"],
  ["Integrations", "layers"],
  ["Settings", "settings"]
]

const JobsTable = ({
  runtime,
  data,
  search,
  due
}: {
  readonly runtime: Runtime
  readonly data: ReadonlyArray<JobSummary>
  readonly search: string
  readonly due: boolean
}) => {
  const selected = useAtomValue(runtime.atoms.selected)
  const now = useAtomValue(runtime.now)
  const visible = useMemo(
    () =>
      data.filter(
        (job) =>
          job.jobId.toLowerCase().includes(search.toLowerCase()) &&
          (!due || (job.state === "Pending" && job.availableAt <= now))
      ),
    [data, search, due, now]
  )
  const columns = useMemo<ColumnDef<JobSummary>[]>(
    () => [
      {
        id: "job",
        header: "Job",
        cell: ({ row }) => (
          <div {...classes("job-identity")}>
            <span {...classes("job-icon")}>
              <Icon name={jobIcon(row.original.catalog.kind)} />
            </span>
            <div>
              <strong
                {...classes("job-name")}
                title={`${row.original.catalog.kind} v${row.original.catalog.version}`}
              >
                {jobName(row.original.catalog.kind)}
              </strong>
              <button
                type="button"
                {...classes("job-id")}
                title={row.original.jobId}
                data-job-id={row.original.jobId}
                aria-pressed={selected === row.original.jobId}
                onClick={() => {
                  void runtime.run(runtime.select(row.original.jobId))
                }}
              >
                {row.original.jobId}
              </button>
            </div>
          </div>
        )
      },
      { id: "queue", header: "Queue", accessorFn: (job) => job.catalog.queue },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <Badge state={row.original.state} />
      },
      {
        id: "attempts",
        header: "Attempts",
        cell: ({ row }) => (
          <span title="Finalized attempts, not all handler invocations">
            {String(row.original.attemptsMade).padStart(2, "0")}
          </span>
        )
      },
      {
        id: "updated",
        header: "Updated",
        cell: ({ row }) => <DateTime value={row.original.updatedAt} label="Updated" />
      },
      {
        id: "terminal",
        header: "Terminal",
        cell: ({ row }) => (
          <DateTime value={row.original.completedAt} label="Terminal timestamp" />
        )
      },
      {
        id: "failure",
        header: "Failure code",
        accessorFn: (job) => job.lastFailureCode ?? "—"
      }
    ],
    [runtime, selected]
  )
  const table = useReactTable({
    data: visible,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (job) => job.jobId,
    manualPagination: true,
    manualFiltering: true
  })
  return (
    <>
      <div {...classes("table-scroll")}>
        <table {...classes("jobs-table")} aria-label="Background jobs">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id} {...stylex.props(layout.th)} scope="col">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody {...classes("job-list")}>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                {...stylex.props(layout.row, selected === row.id && styles.selected)}
                className={[
                  selected === row.id ? "selected" : "",
                  stylex.props(layout.row, selected === row.id && styles.selected)
                    .className
                ].join(" ")}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} {...classes(`${cell.column.id}-cell`)}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && (
        <div {...classes("empty-state")}>
          <Icon name="jobs" />
          <strong>{"No jobs match on this page"}</strong>
        </div>
      )}
    </>
  )
}

export const Dashboard = ({
  runtime,
  demo
}: {
  readonly runtime: Runtime
  readonly demo: boolean
}) => {
  const state = useAtomValue(runtime.stateAtom)
  const now = useAtomValue(runtime.now)
  const route = useAtomValue(runtime.navigation.route)
  const detailPanel = useRef<HTMLElement>(null)
  const jobsPanel = useRef<HTMLElement>(null)
  const scenariosPanel = useRef<HTMLDetailsElement>(null)
  const scenarioControl = useRef<HTMLSelectElement>(null)
  const focusedSelection = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    if (state.selected !== undefined && focusedSelection.current !== state.selected) {
      detailPanel.current?.focus({ preventScroll: true })
    } else if (state.selected === undefined && focusedSelection.current !== undefined) {
      // TanStack cell renderers change with selection. Restore focus only after
      // React commits their replacement, using current authoritative page rows.
      const previous = focusedSelection.current
      const buttons = jobsPanel.current?.querySelectorAll<HTMLButtonElement>(".job-id")
      const target = Array.from(buttons ?? []).find((button) => button.title === previous)
      ;(target ?? jobsPanel.current)?.focus({ preventScroll: true })
    }
    focusedSelection.current = state.selected
  }, [state.selected])
  const [search, setSearch] = useState("")
  const [due, setDue] = useState(false)
  const [kind, setKind] = useState("")
  const [scenario, setScenario] = useState<typeof ScenarioId.Type>("success")
  const [count, setCount] = useState(1)
  const close = () => {
    if (route._tag === "List") {
      runtime.closeDetail()
    } else {
      runtime.navigation.close()
    }
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && runtime.snapshot().selected !== undefined) {
        close()
      }
    }
    window.addEventListener("keydown", escape)
    return () => window.removeEventListener("keydown", escape)
  })
  useLayoutEffect(() => {
    runtime.restoreViewport()
  }, [runtime, state.resultsCurrent, state.page])
  useEffect(() => setKind(state.filters.kind ?? ""), [state.filters.kind])
  const fullDetailFocus = useRef<{ identity: string; focused: boolean } | undefined>(
    undefined
  )
  useLayoutEffect(() => {
    if (route._tag !== "Detail") {
      fullDetailFocus.current = undefined
      return
    }
    const identity = JSON.stringify([
      route.mode,
      state.sandbox.ref.sandboxId,
      route.generation,
      route.jobId
    ])
    if (fullDetailFocus.current?.identity !== identity) {
      fullDetailFocus.current = { identity, focused: false }
    }
    const detail = state.detail
    if (
      fullDetailFocus.current.focused ||
      state.sandbox.expiresAt <= now ||
      route.generation !== state.sandbox.ref.generation ||
      state.selected !== route.jobId ||
      state.detailError !== undefined ||
      detail?.job.jobId !== route.jobId ||
      detail.sandbox.sandboxId !== state.sandbox.ref.sandboxId ||
      detail.sandbox.generation !== route.generation
    ) {
      return
    }
    const heading = document.querySelector<HTMLElement>("[data-job-details-heading]")
    if (heading) {
      heading.focus({ preventScroll: true })
      fullDetailFocus.current.focused = true
    }
  }, [route, state.selected, state.detail, state.detailError, state.sandbox, now])
  const stats = state.stats
  const totals = [
    stats?.total,
    stats ? stats.Pending + stats.RetryScheduled + stats.Active : undefined,
    stats?.Completed,
    state.page?.attentionStats.needsAttention
  ]
  const unavailable =
    state.busy || state.pending !== undefined || state.sandbox.expiresAt <= now
  const detail = state.detail
  const identity = `${demo ? "demo" : "private"}:${state.sandbox.ref.sandboxId}:${state.sandbox.ref.generation}:${detail?.job.jobId}`
  const repairActions = detail
    ? OperatorEligibility.repairApplicability(detail, demo)
    : undefined
  const operatorActions = detail
    ? OperatorEligibility.eligibility(detail, state.sandbox, now)
    : undefined
  const hasActions =
    repairActions &&
    (repairActions.redrive ||
      repairActions.correct ||
      repairActions.resolve ||
      operatorActions?.retryNow.enabled ||
      operatorActions?.cancel.enabled)
  const detailProps = detail
    ? {
        detail,
        now,
        onClose: close,
        onOpenFull: () => runtime.navigation.openFull(detail.job.jobId),
        onRelated: (jobId: typeof detail.job.jobId) => runtime.navigation.openFull(jobId),
        payloadSlot: (
          <JobPayloadPanel
            key={identity}
            detail={detail}
            identityKey={identity}
            allowCopyEncoded={!demo}
          />
        ),
        repairSlot:
          hasActions || state.pending || state.notice ? (
            <div {...stylex.props(styles.detailActions)}>
              <OperatorControls
                runtime={runtime}
                detail={detail}
                sandbox={state.sandbox}
                now={now}
                blocked={unavailable}
              />
              <JobRepairPanel
                key={identity}
                detail={detail}
                readOnly={demo}
                blocked={
                  state.busy ||
                  (state.pending !== undefined && state.pending.kind !== "repair") ||
                  state.sandbox.expiresAt <= now
                }
                pending={state.pending?.kind === "repair" ? state.pending.command : null}
                onSubmit={(command) => void runtime.run(runtime.repair(command))}
                onReceipt={() => void runtime.run(runtime.receipt)}
                onResolve={(command) => void runtime.run(runtime.repair(command))}
              />
              {state.notice && <p role="status">{state.notice}</p>}
              {state.pending && state.pending.kind !== "repair" && (
                <Button
                  disabled={state.busy}
                  onClick={() => void runtime.run(runtime.receipt)}
                >
                  Check exact {state.pending.kind} receipt
                </Button>
              )}
            </div>
          ) : null
      }
    : undefined
  if (route._tag !== "List") {
    return (
      <main>
        {route._tag === "Detail" && detailProps && state.sandbox.expiresAt > now ? (
          <SyntheticDocumentSession
            key={JSON.stringify([identity, "page", detail?.payload])}
          >
            <JobDetailsPage {...detailProps} />
          </SyntheticDocumentSession>
        ) : (
          <>
            <p role="status">
              {route._tag === "Stale"
                ? "Stale generation. Return to this mode's list."
                : route._tag === "Invalid"
                  ? "Invalid job link."
                  : state.detailError
                    ? `Detail unavailable: ${state.detailError}.`
                    : "Loading job details…"}
            </p>
            <Button onClick={close}>Back to jobs</Button>
          </>
        )}
        {state.pending && (
          <Button disabled={state.busy} onClick={() => void runtime.run(runtime.receipt)}>
            Check exact request receipt
          </Button>
        )}
      </main>
    )
  }
  return (
    <div {...classes("jobs-app")}>
      <aside {...classes("sidebar")} aria-label="Workspace navigation">
        <div {...classes("brand")}>
          <span {...classes("brand-mark")}>
            <Icon name="layers" />
          </span>
          <div {...stylex.props(layout.desktop)}>
            <strong>effect-jobs</strong>
            <span {...stylex.props(layout.sublabel)}>Developer console</span>
          </div>
        </div>
        <div {...classes("workspace-switcher")}>
          <span {...classes("workspace-avatar")}>P</span>
          <div>
            <strong>Playground</strong>
            <span {...stylex.props(layout.sublabel)}>Personal workspace</span>
          </div>
          <Icon name="down" />
        </div>
        <nav {...classes("sidebar-navigation")} aria-label="Main navigation">
          <p {...stylex.props(layout.navLabel)}>WORKSPACE</p>
          {navigation.map(([label, icon]) => (
            <Button
              key={label}
              {...classes(`sidebar-item${label === "Background Jobs" ? " active" : ""}`)}
              disabled={label !== "Background Jobs"}
              aria-current={label === "Background Jobs" ? "page" : undefined}
              title={
                label === "Background Jobs"
                  ? undefined
                  : "Not available in this playground"
              }
            >
              <Icon name={icon} />
              {label}
            </Button>
          ))}
        </nav>
        <div {...classes("sidebar-note")}>
          <Icon name="code" />
          <p {...stylex.props(layout.paragraph)}>All data is synthetic.</p>
        </div>
        <div {...classes("sidebar-profile")}>
          <span {...classes("profile-avatar")}>DA</span>
          <div {...stylex.props(layout.desktop)}>
            <strong>{demo ? "Demo viewer" : "Demo admin"}</strong>
            <span {...stylex.props(layout.sublabel)}>
              {demo ? "Public · read only" : "Isolated sandbox"}
            </span>
          </div>
          <Icon name="shield" />
        </div>
      </aside>
      <div {...classes("dashboard-main")}>
        <div {...classes("topbar")}>
          <div {...classes("breadcrumb")}>
            <Icon name="grid" />
            <span>Workspace</span>
            <Icon name="chevron" />
            <strong>Background Jobs</strong>
          </div>
          <span {...classes("environment-badge")}>Local playground</span>
        </div>
        <div {...classes("dashboard-canvas")}>
          <header {...classes("page-header")}>
            <div>
              <h1 {...stylex.props(layout.title)}>Background Jobs</h1>
            </div>
            <div {...classes("header-actions")}>
              {!demo && (
                <Button
                  variant="primary"
                  onClick={() => {
                    if (scenariosPanel.current) {
                      scenariosPanel.current.open = true
                      scenariosPanel.current.scrollIntoView({
                        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                          ? "instant"
                          : "smooth",
                        block: "center"
                      })
                      scenarioControl.current?.focus({ preventScroll: true })
                    }
                  }}
                >
                  <Icon name="plus" />
                  Create jobs
                </Button>
              )}
            </div>
          </header>
          <div {...classes("jobs-overview")}>
            <div {...classes("stats-grid")} aria-label="All jobs statistics">
              {(
                [
                  ["Total jobs", "jobs", "neutral"],
                  ["In progress", "clock", "blue"],
                  ["Completed", "check", "green"],
                  ["Needs attention", "alert", "amber"]
                ] as const
              ).map(([title, icon, tone], index) => (
                <section key={title} {...classes(`stat-card ${tone}`)}>
                  <div {...classes("stat-label")}>
                    <span>{title}</span>
                    <Icon name={icon} />
                  </div>
                  <strong {...classes("stat-value")}>
                    {totals[index] === undefined
                      ? "—"
                      : String(totals[index]).padStart(2, "0")}
                  </strong>
                  <p {...classes("stat-note")}>
                    {stats === undefined
                      ? "Waiting for statistics"
                      : index === 0
                        ? "Across all states"
                        : index === 1
                          ? "Pending, retry scheduled & active"
                          : index === 2
                            ? stats?.total
                              ? `${Math.round((stats.Completed / stats.total) * 100)}% completed`
                              : "No completed jobs yet"
                            : `${stats?.Dead ?? 0} dead · ${stats?.Isolated ?? 0} isolated`}
                  </p>
                </section>
              ))}
            </div>
            <StatsChart stats={stats} />
          </div>
          <div
            {...classes(
              `jobs-layout${state.selected === undefined ? "" : " has-detail"}`
            )}
          >
            <section
              ref={jobsPanel}
              data-jobs-focus-fallback
              tabIndex={-1}
              {...classes("jobs-panel")}
              aria-label="Jobs list"
            >
              <div {...classes("panel-heading")}>
                <h2 {...stylex.props(layout.heading)}>Jobs</h2>
                <span
                  role="status"
                  className={[
                    "results-count",
                    stylex.props(layout.resultsLabel).className
                  ].join(" ")}
                >
                  {state.page && state.resultsCurrent
                    ? `${state.page.filteredTotal} ${state.page.filteredTotal === 1 ? "result" : "results"}${state.error ? " · stale" : ""}`
                    : state.loading
                      ? "Loading…"
                      : "Results unavailable"}
                </span>
              </div>
              <TabsRoot
                value={state.filters.state ?? "all"}
                onValueChange={(value) => {
                  void runtime.run(
                    runtime.filter({
                      ...state.filters,
                      state: value === "all" ? undefined : (value as JobSummary["state"])
                    })
                  )
                }}
              >
                <TabsList aria-label="Job states" {...classes("state-tabs")}>
                  <TabsTab
                    value="all"
                    {...classes("state-tab")}
                    {...(stats ? { count: stats.total } : {})}
                  >
                    All jobs
                  </TabsTab>
                  {stateOrder.map((tab) => (
                    <TabsTab
                      key={tab}
                      value={tab}
                      {...classes("state-tab")}
                      {...(stats ? { count: stats[tab] } : {})}
                    >
                      {stateLabels[tab]}
                    </TabsTab>
                  ))}
                </TabsList>
                <TabsPanel value={state.filters.state ?? "all"} keepMounted>
                  <form
                    {...classes("filter-bar")}
                    aria-label="Job filters"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void runtime.run(
                        runtime.filter({
                          resolution: state.filters.resolution,
                          needsAttention: state.filters.needsAttention,
                          state: state.filters.state,
                          ...(kind === "" ? {} : { kind })
                        })
                      )
                    }}
                  >
                    <Field label="Kind (exact)">
                      <input
                        value={kind}
                        onChange={(event) => setKind(event.target.value)}
                        maxLength={128}
                      />
                    </Field>
                    <Field label="Search this page">
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        aria-label="Search job ID on this page"
                        maxLength={128}
                      />
                    </Field>
                    <Field label="Due now">
                      <input
                        type="checkbox"
                        checked={due}
                        onChange={(event) => setDue(event.target.checked)}
                        aria-label="Due Pending on this page (browser clock)"
                      />
                    </Field>
                    <Button type="submit">Apply filters</Button>
                  </form>
                  <div aria-busy={state.loading}>
                    {state.page === undefined ? (
                      <div {...classes("empty-state")}>
                        <Icon name="jobs" />
                        <strong>Connecting to your workspace</strong>
                      </div>
                    ) : (
                      <JobsTable
                        runtime={runtime}
                        data={state.page.items}
                        search={search}
                        due={due}
                      />
                    )}
                  </div>
                  <div {...classes("pagination")}>
                    <Pagination
                      {...state.pagination}
                      current={
                        state.displayedQuery?.pageNumber ?? state.pagination.current
                      }
                      hasPrevious={
                        state.displayedQuery
                          ? state.displayedQuery.pageNumber > 1
                          : state.pagination.hasPrevious
                      }
                      hasNext={
                        state.page
                          ? state.page.nextCursor !== null
                          : state.pagination.hasNext
                      }
                      disabled={state.error === "sandbox-expired"}
                      busy={state.loading}
                      onPage={(n) => void runtime.run(runtime.goTo(n))}
                      onFirst={() => void runtime.run(runtime.first)}
                      onPrevious={() => void runtime.run(runtime.previous)}
                      onNext={() => void runtime.run(runtime.next)}
                    />
                    <label {...stylex.props(layout.pageSize)}>
                      <span {...stylex.props(layout.pageSizeLabel)}>Rows per page</span>
                      <select
                        {...stylex.props(layout.pageSizeSelect)}
                        aria-label="Rows per page"
                        value={state.pageSize}
                        disabled={state.error === "sandbox-expired"}
                        onChange={(event) =>
                          void runtime.run(
                            runtime.setPageSize(Number(event.target.value) as 20 | 50)
                          )
                        }
                      >
                        <option value="20">20</option>
                        <option value="50">50</option>
                      </select>
                    </label>
                  </div>
                </TabsPanel>
              </TabsRoot>
            </section>
            {detailProps && state.sandbox.expiresAt > now && (
              <SyntheticDocumentSession
                key={JSON.stringify([identity, "drawer", detail?.payload])}
              >
                <JobDetailsDrawer {...detailProps} />
              </SyntheticDocumentSession>
            )}
          </div>
          <section aria-label="Problem resolution">
            <p>
              Needs attention counts unresolved problem chains. Execution counts include
              every retained job.
            </p>
            <Field label="Resolution">
              <select
                value={
                  state.filters.needsAttention
                    ? "attention"
                    : (state.filters.resolution ?? "all")
                }
                onChange={(event) => {
                  const value = event.target.value
                  void runtime.run(
                    runtime.filter({
                      ...state.filters,
                      resolution:
                        value === "Open" || value === "InProgress" || value === "Resolved"
                          ? value
                          : undefined,
                      needsAttention: value === "attention" ? true : undefined
                    })
                  )
                }}
              >
                <option value="all">All executions</option>
                <option value="attention">Needs attention</option>
                <option value="Open">Open</option>
                <option value="InProgress">In progress</option>
                <option value="Resolved">Resolved</option>
              </select>
            </Field>
            {state.problemRows
              ?.filter((row) => row.representative === null)
              .map((row) => (
                <p key={row.problem.rootJobId}>
                  Job no longer retained: {row.problem.rootJobId} · {row.problem.state}
                </p>
              ))}
          </section>
          <div {...classes("session-bar")}>
            <p
              role="status"
              {...classes("connection-status")}
              data-connection={state.connection}
            >
              {state.connection}
              {state.error ? ` · ${state.error}` : ""}
              {state.connection === "stale"
                ? " · Last successful data retained; it may be outdated."
                : ""}
            </p>
            <p {...classes("sandbox-scope")}>
              {demo ? "Public demo" : "Own sandbox"}: {state.sandbox.ref.sandboxId} ·
              generation {state.sandbox.ref.generation} · expires{" "}
              <DateTime value={state.sandbox.expiresAt} label="Session expires" />
            </p>
            <Button
              variant="ghost"
              aria-disabled={state.loading || undefined}
              onClick={() => {
                if (!runtime.snapshot().loading) {
                  void runtime.run(runtime.refresh)
                }
              }}
            >
              <Icon name="refresh" />
              Refresh reads
            </Button>
            {state.error === "sandbox-expired" && (
              <Button
                disabled={state.pending !== undefined}
                onClick={() => location.reload()}
              >
                Recover session
              </Button>
            )}
          </div>
          {!demo && (
            <details
              ref={scenariosPanel}
              {...classes("scenario-panel")}
              role="region"
              aria-label="Scenario launcher"
            >
              <summary {...stylex.props(layout.summary)}>
                <div {...classes("scenario-summary-title")}>
                  <Icon name="terminal" />
                  <strong>Scenario lab</strong>
                </div>
                <Icon name="plus" />
              </summary>
              <div {...classes("scenario-body")}>
                <Field label="Fake provider behavior">
                  <select
                    ref={scenarioControl}
                    value={scenario}
                    onChange={(event) =>
                      setScenario(event.target.value as typeof ScenarioId.Type)
                    }
                  >
                    {ScenarioId.literals.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Jobs (1–10)">
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={count}
                    onChange={(event) => setCount(event.target.valueAsNumber)}
                  />
                </Field>
                <Button
                  variant="primary"
                  disabled={
                    unavailable ||
                    !state.sandbox.capabilities.runScenario ||
                    (state.sandbox.capacity?.mode === "bounded" &&
                      (state.sandbox.capacity.retainedJobs + count > 100 ||
                        state.sandbox.capacity.admittedCommands >= 200))
                  }
                  onClick={() =>
                    void runtime.run(
                      runtime.command("scenario", crypto.randomUUID(), scenario, count)
                    )
                  }
                >
                  Run scenario
                </Button>
                <Button
                  disabled={
                    unavailable ||
                    !state.sandbox.capabilities.resetSandbox ||
                    (state.sandbox.capacity?.mode === "bounded" &&
                      (state.sandbox.capacity.retainedJobs > 94 ||
                        state.sandbox.capacity.admittedCommands > 198))
                  }
                  onClick={() => {
                    if (
                      window.confirm(
                        "Start a new generation with 6 starter jobs? Old jobs and receipts remain. Running jobs are not cancelled."
                      )
                    ) {
                      void runtime.run(
                        runtime.command("reset", crypto.randomUUID(), "success", 1)
                      )
                    }
                  }}
                >
                  Reset my sandbox
                </Button>
                <Button
                  disabled={state.pending === undefined || state.busy}
                  onClick={() => void runtime.run(runtime.receipt)}
                >
                  Check exact request receipt
                </Button>
                <p {...stylex.props(layout.paragraph)}>
                  {state.pending
                    ? `Pending ${state.pending.kind} request: ${state.pending.request.requestId}`
                    : ""}
                </p>
                <p role="status" {...stylex.props(styles.notice)}>
                  {state.notice}
                </p>
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}
