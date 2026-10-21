import * as stylex from "@stylexjs/stylex"
import type { JobStats } from "@effect-jobs/playground-contracts/Jobs"
import { useId } from "react"
import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"
import { stateColors, stateLabels, stateOrder } from "../../ui/Theme.stylex.js"
import { styles, stateDots } from "./StatsChart.stylex.js"

const countFormat = new Intl.NumberFormat("en")
const percentage = (count: number, total: number) =>
  `${total === 0 ? 0 : Math.round((count / total) * 100)}%`

/** The caller supplies global API statistics, independent of the visible job page. */
export const StatsChart = (props: { readonly stats: JobStats | undefined }) => {
  const stats = props.stats
  const headingId = useId()
  const data = stateOrder.map((state) => ({
    state,
    name: stateLabels[state],
    value: stats?.[state] ?? 0,
    fill: stateColors[state]
  }))

  return (
    <section {...stylex.props(styles.panel)} aria-labelledby={headingId}>
      <h2 {...stylex.props(styles.heading)} id={headingId}>
        Job distribution
      </h2>
      {stats === undefined && (
        <p {...stylex.props(styles.message)} role="status">
          Loading job statistics…
        </p>
      )}
      {stats?.total === 0 && <p {...stylex.props(styles.message)}>No jobs yet.</p>}
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.graphic)}>
          {/* The complete textual equivalent below also includes zero-valued states. */}
          <div {...stylex.props(styles.plot)} aria-hidden="true">
            {stats !== undefined && stats.total > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <PieChart accessibilityLayer={false}>
                  <Pie
                    // Pie has its own tab stop even with the chart accessibility layer disabled.
                    rootTabIndex={-1}
                    data={data}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius="74%"
                    outerRadius="94%"
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                    isAnimationActive={false}
                  />
                  <Tooltip
                    isAnimationActive={false}
                    content={(tooltip) => {
                      const item = tooltip.payload?.[0]
                      if (!tooltip.active || typeof item?.value !== "number") {
                        return null
                      }
                      return (
                        <div {...stylex.props(styles.tooltip)}>
                          <strong>{item.name}</strong>
                          <span>
                            {countFormat.format(item.value)} jobs ·{" "}
                            {percentage(item.value, stats.total)}
                          </span>
                        </div>
                      )
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div {...stylex.props(styles.emptyRing)} />
            )}
          </div>
          <div {...stylex.props(styles.center)}>
            <strong {...stylex.props(styles.total)}>
              {stats === undefined ? "—" : countFormat.format(stats.total)}
            </strong>
            <span {...stylex.props(styles.totalLabel)}>Total jobs</span>
          </div>
        </div>
        <ul {...stylex.props(styles.legend)} aria-label="Jobs by state">
          {data.map((item) => {
            return (
              <li key={item.state} {...stylex.props(styles.row)}>
                <span
                  {...stylex.props(styles.dot, stateDots[item.state])}
                  aria-hidden="true"
                />
                <span {...stylex.props(styles.stateLabel)}>{item.name}</span>
                <strong {...stylex.props(styles.count)}>
                  {stats === undefined ? "—" : countFormat.format(item.value)}
                </strong>
                <span {...stylex.props(styles.percent)}>
                  {stats === undefined ? "" : percentage(item.value, stats.total)}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
