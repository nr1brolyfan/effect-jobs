# React integration qualification

The integration branch combines foundation `203e5dce974d168eac820c3cf4364b7341adf241`,
theme `f94e7143e6f729ab09db5fed99cc314e3ac5666e`, theme fix
`541549e4ed2e512b6148bf97dbdc7d66474eb390`, and chart
`f7f201a67013523c497afff824f768f429b57618` on baseline
`391456cdcab426071ad4255a8ce617df3ad0c4c9`. The chart author's exact accessibility
fix `f47acc816be095519e9cd37eab07bb68b42ac311` was subsequently cherry-picked.

Qualification remains incomplete. No review, push, preview merge, or deployment
has been performed. The owner preview on port 8787 remains untouched.

## Foundation and chart fixes

The build uses pinned Babel TypeScript and automatic React JSX transforms before
StyleX extraction, correcting unbound JSX functions in the original standalone
transpiler output. Production and development artifacts execute in Chromium;
355 StyleX rules are extracted with runtime injection disabled. Production.mjs
checks the actual production Client.js with synthetic HTTP responses, semantic
computed CSS, and absence of injected style elements; this is not PG qualification.

Root test dependencies pin pg 8.23.0 and @types/pg 8.20.0. Field's Bun test and
Theme's node:test suite run under their intended runtimes in `bun run test`.
Library peers and runtime dependencies remain unchanged.

Recharts 3.10.1 independently defaults Pie.rootTabIndex to zero even when
PieChart.accessibilityLayer is false. The chart author sets rootTabIndex to -1
for the decorative aria-hidden plot. The original Browser.mjs now passes its
unchanged accessibility oracle with zero WCAG2/2.1 A/AA violations. The additional
StatsChart.browser.mjs checks bidirectional Tab exclusion, desktop/mobile/narrow
SVG, pointer tooltip, palette, six-state textual equivalent and motion preferences.

## Reproduction commands

```sh
bun install --frozen-lockfile
PLAYGROUND_EVIDENCE_DIRECTORY=.multica/react-qualification node apps/playground-worker/tests/integration/Build.mjs
bun run check
bun run playground:check
bun run check:postgresql
bun run test
bun apps/website/tests/ui/StatsChart.mjs
node apps/website/tests/ui/Production.mjs
node apps/website/tests/ui/Browser.mjs
node apps/website/tests/ui/StatsChart.browser.mjs
node apps/website/tests/ui/Reconciliation.mjs
python3 apps/playground-worker/tests/integration/ReactRunOwned.py
```

Runtime attempts require an explicitly authorized finite disposable-resource
window. The current continuation used all three attempts; the final focus-oracle
repair has not been rerun against PG. Do not infer PASS from the harness source.

## Real runtime diagnosis

The earlier report attributed its timeout to the demo connected wait. Its runtime
failure predates the committed diagnostic scaffold, so that line reference does
not identify a statement in the final scaffold. The first continuation attempt
instead established HTTP 200 demo/list responses, an opened WebSocket, no browser
or CSP errors, and rendered connected status. It timed out finding Run scenario:
the native details launcher was collapsed, excluding the button from the
accessibility tree. The harness now opens the launcher before verifying disabled
demo controls. No production connection/setup failure was reproduced or repaired.

The second attempt passed demo write denial, server cursor/filter and independent
global statistics, then failed a stale selector: the migrated Badge has no legacy
state-badge class. The harness checks the status table cell's exact Retry scheduled
text without weakening the expected value.

The third attempt passed those gates plus real detail reads, database availableAt
byte-value comparison, exact Europe/Warsaw local formatting, a ticking countdown,
and Eligible now wording. The latter uses a temporary local browser-clock change
only; persisted lifecycle and API snapshots remain authoritative. It then failed
an assumption that Escape returns focus to the first row. Live reads can reorder
or evict the selected row from the five-item server page. The corrected oracle
requires focus on the exact selected job when present, otherwise the Jobs list
region, matching the production focus contract. That final oracle still requires
real PG reproduction in a new authorized finite window.

Additional harness assertions cover actual responsive SVG shrinkage at a narrow
240px viewport (the ring legitimately stays capped at 220px at 390px), pointer
tooltip, rotation through the app-owned deadline, retired demo read denial,
stale private generation rejection, reconnect/reconciliation, real completion,
reset and DB-time expiry recovery. Those downstream assertions were not reached;
they remain NotTested against PG in this continuation.

ReactRunOwned.py uses fresh synthetic credentials, one pinned PG 16.15 container,
tmpfs storage and a dynamic loopback-only port. Every attempt removed its exact
container and private configuration. The final wrapper additionally verified that
the node/workerd/Chromium process group was absent. No services were retained.

## Evidence limits

Original Browser.mjs covers StrictMode lifetime/unmount cleanup, keyboard/mobile
behavior, selection/filter/cursor semantics, stale reads and generation revocation.
Reconciliation.mjs covers hidden-page behavior, focus after unchanged reads,
overlap prevention, expiry and disposal. Their synthetic observations do not
substitute for the incomplete real backend suite. The previous 475 unit PASS
receipt includes 50 skipped PG tests, which remain NotTested.

Root and playground aggregate lint failures on unchanged historical backend tests,
and whole-repository format failures on historical artifacts/unrelated inputs,
remain explicit, with no waiver or weakened rules. Scoped website/contracts/harness
checks pass. Playground skipLibCheck remains the transitive declaration
accommodation; application sources remain strict. Hosted/Cloudflare production
is NotTested. The snapshot is not ready for review freeze.
