# React dashboard foundation

The dashboard uses a registry per mounted React session. `Atoms.ts` owns writable
filters, pagination, selection, authoritative snapshots, command uncertainty,
errors, notices and connection state. `stateAtom` derives a read snapshot from
those atoms; there is no controller snapshot or retained DOM view.

`Runtime.ts` owns a live Effect Scope, HTTP operation fibers, browser listeners,
clock and reconciliation timers, and a replaceable child Scope for WebSocket
resources. Mount cleanup interrupts outstanding operations and disposes the
registry. `Mount.tsx` allocates the runtime in an effect, so development StrictMode
recreates the complete lifetime. Pagehide unmounts React and closes the Scope.
Fixture builds use development React to exercise that setup/cleanup cycle.

`Dashboard.tsx` consumes atoms and TanStack Table's core row model. Pagination and
state/kind filters remain server operations. Search and due-pending controls apply
only to the current page. Statistics come from the global API snapshot. Details
render the actual privacy-safe DTO, including exact availability and browser-clock
retry eligibility countdown. Unknown commands retain the exact receipt request
and block further writes.

## Compilation

`bun apps/website/build.mjs` builds the production client. The build creates a
short-lived JS mirror of every website TS/TSX source, resolves NodeNext `.js`
theme imports there, runs the pinned StyleX Babel compiler without runtime
injection, and bundles with Bun. Extracted CSS is appended to the document reset
in `dist/Jobs.css`. The local worker serves that generated file. Every transformed
source and the production bundles are checked for uncompiled StyleX calls, and a
source-hash/CSS-rule receipt is written alongside the assets.

`bun apps/website/build.mjs --fixtures` also builds FixtureEntry and BrowserEntry.
`UI_BUILD_DIRECTORY` can select an owned output directory. The browser harnesses
invoke this compiler and serve the resulting CSS, rather than bundling raw styles.
Never substitute theme/chart modules: integrate their actual author commits first.

## Focused checks

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
bun install --frozen-lockfile --ignore-scripts --force
bun run --filter @effect-jobs/playground-contracts build
bunx vitest run apps/website/tests/ui/Atoms.test.ts apps/website/tests/ui/Runtime.test.ts apps/website/tests/ui/RetryTime.test.ts
bunx oxlint --deny-warnings apps/website
bun run playground:check
bun apps/website/build.mjs
```

The playground TypeScript configuration skips third-party declaration checking
because Recharts' internal Redux Toolkit declarations fail exact optional checking
with pinned TypeScript 7. Application source remains strict; the independent root
library configs are unchanged. The application does not use Redux as its state
owner. Real PostgreSQL/workerd/Chromium qualification belongs to the serial
integrated dashboard stage, including accessibility and StrictMode browser checks.
