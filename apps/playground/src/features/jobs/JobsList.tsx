/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned atom-react 4.0.5 is the supported Effect Atom subscription API. */
import { useAtomValue } from "@effect/atom-react"
import * as stylex from "@stylexjs/stylex"
import type { Runtime } from "./Runtime.js"
import { classes } from "./DashboardClasses.js"
import { layout } from "./Dashboard.stylex.js"
import { useLayoutEffect } from "react"
import type { JobSummary } from "@effect-jobs/playground-contracts/Jobs"
import { Icon, TabsRoot, TabsList, TabsTab, TabsPanel } from "../../ui/Primitives.js"
import { Pagination } from "../../ui/Pagination.js"
import { stateOrder, stateLabels } from "../../ui/Theme.stylex.js"
import { JobsTable } from "./JobsTable.js"

export const JobsList = (props: { readonly runtime: Runtime }) => {
  const query = useAtomValue(props.runtime.views.query)
  const list = useAtomValue(props.runtime.views.list)
  const status = useAtomValue(props.runtime.views.status)
  const stats = useAtomValue(props.runtime.atoms.stats)
  const state = { ...query, ...list, ...status }
  useLayoutEffect(
    () => props.runtime.restoreViewport(),
    [props.runtime, state.resultsCurrent, state.page]
  )
  return (
    <section
      data-jobs-focus-fallback
      tabIndex={-1}
      {...classes("jobs-panel")}
      aria-label="Jobs list"
    >
      <div {...classes("panel-heading")}>
        <h2 {...stylex.props(layout.heading)}>Jobs</h2>
        <span
          role="status"
          className={["results-count", stylex.props(layout.resultsLabel).className].join(
            " "
          )}
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
          void props.runtime.run(
            props.runtime.filter({
              ...state.filters,
              state: value === "all" ? undefined : (value as JobSummary["state"])
            })
          )
        }}
      >
        <TabsList wrap={false} aria-label="Job states" {...classes("state-tabs")}>
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
          <div aria-busy={state.loading}>
            {state.page === undefined ? (
              <div {...classes("empty-state")}>
                <Icon name="jobs" />
                <strong>Connecting to your workspace</strong>
              </div>
            ) : (
              <JobsTable runtime={props.runtime} data={state.page.items} />
            )}
          </div>
          <div {...classes("pagination")}>
            <Pagination
              {...state.pagination}
              current={state.displayedQuery?.pageNumber ?? state.pagination.current}
              hasPrevious={
                state.displayedQuery
                  ? state.displayedQuery.pageNumber > 1
                  : state.pagination.hasPrevious
              }
              hasNext={
                state.page ? state.page.nextCursor !== null : state.pagination.hasNext
              }
              disabled={state.error === "sandbox-expired"}
              busy={state.loading}
              onPage={(n) => void props.runtime.run(props.runtime.goTo(n))}
              onFirst={() => void props.runtime.run(props.runtime.first)}
              onPrevious={() => void props.runtime.run(props.runtime.previous)}
              onNext={() => void props.runtime.run(props.runtime.next)}
            />
            <label {...stylex.props(layout.pageSize)}>
              <span {...stylex.props(layout.pageSizeLabel)}>Rows per page</span>
              <select
                {...stylex.props(layout.pageSizeSelect)}
                aria-label="Rows per page"
                value={state.pageSize}
                disabled={state.error === "sandbox-expired"}
                onChange={(event) =>
                  void props.runtime.run(
                    props.runtime.setPageSize(Number(event.target.value) as 20 | 50)
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
  )
}
