import { ArcElement, Chart, DoughnutController, Tooltip } from "chart.js"
import type { JobStats } from "@effect-jobs/playground-contracts/Jobs"

Chart.register(ArcElement, DoughnutController, Tooltip)
const states = [
  "Completed",
  "Active",
  "Pending",
  "RetryScheduled",
  "Dead",
  "Isolated"
] as const
const colors = ["#c7e89f", "#8ebed6", "#8e9b83", "#dfbd77", "#da9999", "#b7a0d5"]

export const mount = () => {
  const panel = document.createElement("section")
  panel.className = "stats-chart-panel"
  const heading = document.createElement("h2")
  heading.textContent = "Job distribution"
  const body = document.createElement("div")
  body.className = "stats-chart-body"
  const graphic = document.createElement("div")
  graphic.className = "stats-chart-graphic"
  const canvas = document.createElement("canvas")
  canvas.setAttribute("role", "img")
  canvas.setAttribute("aria-label", "Job state distribution, waiting for data")
  const center = document.createElement("div")
  center.className = "stats-chart-center"
  const total = document.createElement("strong")
  total.textContent = "—"
  const label = document.createElement("span")
  label.textContent = "Total jobs"
  center.append(total, label)
  graphic.append(canvas, center)
  const legend = document.createElement("ul")
  legend.className = "stats-chart-legend"
  const values = states.map((state, index) => {
    const row = document.createElement("li")
    const dot = document.createElement("span")
    dot.className = `chart-dot chart-dot-${state.toLowerCase()}`
    dot.setAttribute("aria-hidden", "true")
    const name = document.createElement("span")
    name.textContent = state === "RetryScheduled" ? "Retry scheduled" : state
    const count = document.createElement("strong")
    count.textContent = "—"
    const percent = document.createElement("span")
    percent.className = "chart-percent"
    row.append(dot, name, count, percent)
    legend.append(row)
    return { count, percent, color: colors[index] }
  })
  body.append(graphic, legend)
  panel.append(heading, body)
  let chart: Chart<"doughnut"> | undefined
  let previous = ""
  return {
    panel,
    update: (stats: JobStats | undefined) => {
      if (!stats) {
        chart?.destroy()
        chart = undefined
        previous = ""
        total.textContent = "—"
        canvas.setAttribute("aria-label", "Job state distribution, waiting for data")
        values.forEach(({ count, percent }) => {
          count.textContent = "—"
          percent.textContent = ""
        })
        return
      }
      const data = states.map((state) => stats[state])
      const signature = data.join(":")
      if (signature === previous) {
        return
      }
      previous = signature
      total.textContent = stats.total.toLocaleString("en")
      canvas.setAttribute(
        "aria-label",
        states.map((state, index) => `${state}: ${data[index]}`).join(", ")
      )
      values.forEach(({ count, percent }, index) => {
        count.textContent = String(data[index])
        percent.textContent = `${stats.total === 0 ? 0 : Math.round(((data[index] ?? 0) / stats.total) * 100)}%`
      })
      if (chart) {
        chart.data.datasets[0]!.data = data
        chart.update("none")
      } else {
        chart = new Chart(canvas, {
          type: "doughnut",
          data: {
            labels: states.map((state) =>
              state === "RetryScheduled" ? "Retry scheduled" : state
            ),
            datasets: [
              {
                data,
                backgroundColor: colors,
                borderColor: "#151716",
                borderWidth: 3,
                hoverOffset: 4,
                borderRadius: 3
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            cutout: "78%",
            plugins: {
              tooltip: {
                backgroundColor: "#222a20",
                titleColor: "#eef3e8",
                bodyColor: "#c3cdbb",
                padding: 12,
                displayColors: false
              }
            }
          }
        })
      }
    },
    dispose: () => chart?.destroy()
  }
}
