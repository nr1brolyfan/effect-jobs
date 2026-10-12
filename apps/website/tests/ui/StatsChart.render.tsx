import assert from "node:assert/strict"
import { renderToStaticMarkup } from "react-dom/server"
import { StatsChart } from "../../src/features/jobs/StatsChart.js"

const render = (stats: Parameters<typeof StatsChart>[0]["stats"]) =>
  renderToStaticMarkup(<StatsChart stats={stats} />)
const rows = (html: string) =>
  [...html.matchAll(/<li\b[^>]*>(.*?)<\/li>/g)].map((match) =>
    (match[1] ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  )
const labels = ["Completed", "Active", "Pending", "Retry scheduled", "Dead", "Isolated"]
const zero = {
  total: 0,
  Completed: 0,
  Active: 0,
  Pending: 0,
  RetryScheduled: 0,
  Dead: 0,
  Isolated: 0
}

const loading = render(undefined)
assert.match(loading, /role="status"[^>]*>Loading job statistics…/)
assert.equal(rows(loading).length, 6)
assert(!loading.includes("0%"))
assert(!loading.includes("No jobs yet."))
labels.forEach((label, index) => assert.equal(rows(loading)[index], `${label} —`))

const empty = render(zero)
assert.match(empty, /No jobs yet\./)
assert(!empty.includes("Loading job statistics"))
labels.forEach((label, index) => assert.equal(rows(empty)[index], `${label} 0 0%`))
assert(!empty.includes("NaN") && !empty.includes("Infinity"))

// Counts belong to the global snapshot, even when a table elsewhere shows five jobs.
const populated = render({
  total: 1000,
  Completed: 500,
  Active: 250,
  Pending: 100,
  RetryScheduled: 75,
  Dead: 50,
  Isolated: 25
})
assert.match(populated, />1,000<\/strong>/)
assert.match(populated, />Total jobs<\/span>/)
assert.deepEqual(rows(populated), [
  "Completed 500 50%",
  "Active 250 25%",
  "Pending 100 10%",
  "Retry scheduled 75 8%",
  "Dead 50 5%",
  "Isolated 25 3%"
])
assert.match(populated, /aria-label="Jobs by state"/)
const headingId = populated.match(/<h2[^>]*id="([^"]+)"/)?.[1]
assert(headingId)
assert(populated.includes(`aria-labelledby="${headingId}"`))

const sparse = render({ ...zero, total: 1, Active: 1 })
assert.equal(rows(sparse).length, 6)
assert.equal(rows(sparse)[1], "Active 1 100%")
assert.equal(rows(sparse)[0], "Completed 0 0%")
assert.deepEqual(rows(render(undefined)), rows(loading))
assert.deepEqual(rows(render(zero)), rows(empty))

console.log(
  "PASS: loading, zero, global total, six ordered states, percentages and textual accessibility"
)
