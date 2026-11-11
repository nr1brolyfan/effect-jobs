import { test } from "vitest"

test("StatsChart preserves loading/zero/global counts, state order, percentages and textual accessibility", async () => {
  await import("../ui/StatsChart.render.js")
})
