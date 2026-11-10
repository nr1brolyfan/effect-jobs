/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned atom-react 4.0.5 is the supported Effect Atom subscription API. */
import { useAtomValue } from "@effect/atom-react"
import type { Runtime } from "./Runtime.js"
import { classes } from "./DashboardClasses.js"
import { Icon } from "../../ui/Primitives.js"
import { StatsChart } from "./StatsChart.js"
export const JobsOverview = (props: { readonly runtime: Runtime }) => {
  const stats = useAtomValue(props.runtime.atoms.stats)
  const page = useAtomValue(props.runtime.atoms.page)
  const totals = [
    stats?.total,
    stats ? stats.Pending + stats.RetryScheduled + stats.Active : undefined,
    stats?.Completed,
    page?.attentionStats.needsAttention
  ]
  return (
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
              {totals[index] === undefined ? "—" : String(totals[index]).padStart(2, "0")}
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
  )
}
