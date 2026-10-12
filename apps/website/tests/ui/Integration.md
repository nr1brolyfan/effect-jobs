# React integration qualification

The integration branch combines foundation `203e5dce974d168eac820c3cf4364b7341adf241`,
theme `f94e7143e6f729ab09db5fed99cc314e3ac5666e`, theme fix
`541549e4ed2e512b6148bf97dbdc7d66474eb390`, and chart
`f7f201a67013523c497afff824f768f429b57618` on baseline
`391456cdcab426071ad4255a8ce617df3ad0c4c9`. The chart author's exact accessibility
fix `f47acc816be095519e9cd37eab07bb68b42ac311` was subsequently cherry-picked.

The integrated local dashboard runtime gate passed on 2026-10-12 in the final
authorized continuation. No review, push, preview merge, or deployment has been
performed. The owner preview on port 8787 remains untouched. Historical aggregate
lint/format failures remain explicit below; this is not a full CI PASS claim.

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
node apps/website/tests/ui/Focus.mjs
node apps/website/tests/ui/Reconciliation.mjs
python3 apps/playground-worker/tests/integration/ReactRunOwned.py
```

Runtime attempts require an explicitly authorized finite disposable-resource
window. The first continuation exhausted three attempts before final focus
qualification. A second authorized window completed the full gate in its third
attempt, then stopped. Set PLAYGROUND_EVIDENCE_DIRECTORY to a fresh directory
containing the Build.mjs fixture outputs to preserve prior attempt receipts.

## Completed final runtime gate

The second window first reproduced a chart measurement race: attached SVG does
not guarantee visible layout or a bounding box. The harness waits for visible SVG
and handles absent boxes while responsive layout settles. Its next attempt passed
the demo, retry, focus, chart, reconnect and rotation checks, then exposed an
incorrect authentication oracle. Missing credentials intentionally return exact
404/not-found; expired authenticated authority returns 401. The harness asserts
the concealed response status and body and waits for the real reset admission
cooldown rather than changing backend behavior.

Final React.mjs PASS uses the unchanged production Client.js, Worker.js and
extracted CSS. It checks real server filters/cursors and independent global stats,
demo write denial, details, exact PG availableAt and Europe/Warsaw formatting,
one-second countdown, and natural Eligible now wording. A transaction locks only
the selected real RetryScheduled row through its actual persisted deadline;
SKIP LOCKED lets other jobs continue. No clock, timestamp or state is rewritten.
Database time proves eligibility while waiting for a worker. Releasing the lock
then requires actual worker completion and authoritative API detail reconciliation.
Escape and Close return focus to that selected job, and its removal from the
filtered page requires the Jobs list fallback.

Real production SVG/tooltip/mobile/narrow layout and WCAG2/2.1 A/AA pass with zero
violations. A captured native socket is closed to inject transport loss; real
reconnect opens another socket and performs authoritative HTTP reconciliation.
Demo rotation rejects retired reads. Private checks cover HttpOnly/Secure/Strict
cookies, concealed unauthenticated reads, six real handler completions, details,
reset, stale-generation denial, database-time session expiry and recovery. Final
cleanup confirms zero workerd PG sessions, exact container absence, removed
synthetic configuration and absent node/workerd/Chromium process group.

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
focus restoration after Escape. A separate deterministic Focus.mjs reproduction
also failed with an unchanged selected row. Closing details changed the table's
selection-dependent cell render functions; the synchronous close callback focused
an old button before React replaced it. Focus was lost when that button unmounted.
The dashboard now restores focus in useLayoutEffect after the React commit.
Focus.mjs passes Escape, Close details, and the fallback to Jobs list after the
selected job leaves the page. Live reads can also reorder or evict the selected
row, so the real oracle now locates that exact job instead of assuming the first
row. The final focus source and oracle still require real PG reproduction in a
new authorized finite window.

Additional harness assertions cover actual responsive SVG shrinkage at a narrow
240px viewport (the ring legitimately stays capped at 220px at 390px), pointer
tooltip, rotation through the app-owned deadline, retired demo read denial,
stale private generation rejection, reconnect/reconciliation, real completion,
reset and DB-time expiry recovery. Those downstream assertions were not reached
in the first window; the completed final window above qualifies them against PG.

ReactRunOwned.py uses fresh synthetic credentials, one pinned PG 16.15 container,
tmpfs storage and a dynamic loopback-only port. Every attempt removed its exact
container and private configuration. The final wrapper additionally verified that
the node/workerd/Chromium process group was absent. No services were retained.

## Evidence limits

Original Browser.mjs covers StrictMode lifetime/unmount cleanup, keyboard/mobile
behavior, selection/filter/cursor semantics, stale reads and generation revocation.
Reconciliation.mjs covers hidden-page behavior, focus after unchanged reads,
overlap prevention, expiry and disposal. Their synthetic observations do not
substitute for real backend evidence. The completed real dashboard gate is
separate from those fixtures. The previous 475 unit PASS
receipt includes 50 skipped PG tests, which remain NotTested.

Root and playground aggregate lint failures on unchanged historical backend tests,
and whole-repository format failures on historical artifacts/unrelated inputs,
remain explicit, with no waiver or weakened rules. Scoped website/contracts/harness
checks pass. Playground skipLibCheck remains the transitive declaration
accommodation; application sources remain strict. Hosted/Cloudflare production
is NotTested. The locally qualified snapshot can be handed to the coordinator for
the single planned review set, with these limitations preserved.
