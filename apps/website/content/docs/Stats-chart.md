# React job distribution

`StatsChart({ stats }: { readonly stats: JobStats | undefined })` is a pure view
of the caller's authoritative global statistics. Import the named component
from `src/features/jobs/StatsChart.js` after the foundation removes the legacy
`StatsChart.ts`. Filters, table pages, requests and subscriptions belong to the
dashboard; they do not change how the chart derives its data.

The six states keep the order, labels and SVG fill colors exported by
`ui/Theme.stylex.ts`. StyleX legend dots use the matching semantic variables.
Every state remains in the textual legend, including zero counts. The total is
the API's `stats.total`; percentages are rounded independently and can sum to
slightly more or less than 100%. Loading uses unknown counts, and an empty
snapshot uses a neutral ring rather than a fabricated nonzero slice.

The Recharts donut fills a square parent with a 220px maximum width and shrinks
with available space. At 600px and below, the legend moves under the graphic.
Pie and tooltip animations are disabled for every motion preference. The
graphic is decorative for assistive technology: the labelled section, total
and complete textual legend provide its equivalent without duplicate chart
keyboard targets. Pointer tooltips repeat the state, count and percentage.

## Focused qualification

Use the centrally installed foundation dependencies; do not install an
independent dependency graph. In the integrated worktree:

```sh
bun apps/website/tests/ui/StatsChart.mjs
node_modules/.bin/oxlint --deny-warnings apps/website/src/features/jobs/StatsChart.tsx apps/website/src/features/jobs/StatsChart.stylex.ts apps/website/tests/ui/StatsChart.render.tsx apps/website/tests/ui/StatsChart.mjs
node_modules/.bin/oxfmt --config .oxfmtrc.json --check apps/website/src/features/jobs/StatsChart.tsx apps/website/src/features/jobs/StatsChart.stylex.ts apps/website/tests/ui/StatsChart.render.tsx apps/website/tests/ui/StatsChart.mjs apps/website/content/docs/Stats-chart.md
```

For the isolated chart worktree, temporarily link its root and website
`node_modules` to the corresponding foundation directories and set
`STATS_CHART_THEME_PATH` to the theme author's `Theme.stylex.ts`. The runner
copies the exact input bytes into a disposable layout under
`.multica/stats-chart/`, checks source types using the real local `JobStats`,
compiles actual StyleX with runtime injection disabled, verifies mobile CSS
extraction, and renders actual React markup. No dependency or theme mock is
used. The receipt records source hashes and installed tool versions.

The source check uses `skipLibCheck: true`. Strict third-party declaration
compatibility remains an integration gate: the first attempt with
`skipLibCheck: false` found errors in Recharts' transitive
`@reduxjs/toolkit@2.13.0` declarations with TypeScript 7.0.2. This slice does not
own dependency pins or compiler policy.

SSR tests cover loading, empty data, global total, all state counts/order,
percentages, sparse data and heading/legend semantics. They do not qualify
browser SVG sectors, pointer tooltip behavior, resize observation, mobile
overflow, real assistive technology, or the complete dashboard. The serial
integrator must test these in Chromium and run the full required local gates.

API references: [Recharts Pie](https://recharts.github.io/en-US/api/Pie/),
[ResponsiveContainer](https://recharts.github.io/en-US/api/ResponsiveContainer/),
[Tooltip](https://recharts.github.io/en-US/api/Tooltip/) and
[StyleX defining styles](https://stylexjs.com/docs/learn/styling-ui/defining-styles/).
