# React integration qualification

The integration branch combines foundation `203e5dce974d168eac820c3cf4364b7341adf241`,
theme `f94e7143e6f729ab09db5fed99cc314e3ac5666e`, theme fix
`541549e4ed2e512b6148bf97dbdc7d66474eb390`, and chart
`f7f201a67013523c497afff824f768f429b57618`, in that order, on baseline
`391456cdcab426071ad4255a8ce617df3ad0c4c9`.

Qualification is incomplete. The chart author's accessibility fix and successful
real PG/workerd/Chromium qualification are prerequisites for freezing a qualified
snapshot. No review, push, preview merge, or deployment has been performed.

## Foundation fixes

Bun.Transpiler's standalone automatic JSX output contained unbound generated JSX
function names. Build success did not imply that the output could execute. The
build now uses pinned Babel TypeScript and automatic React JSX transforms before
StyleX extraction. Production and development artifacts execute in Chromium;
355 StyleX rules are extracted with runtime injection disabled. Production.mjs
checks the actual production Client.js with synthetic HTTP responses, semantic
computed CSS, and absence of injected style elements. It makes no PG/WS claim.

Root test dependencies now pin pg 8.23.0 and @types/pg 8.20.0. Library peers and
runtime dependencies are unchanged. Field's Bun test and Theme's node:test suite
run under their intended runtimes as part of `bun run test`; their exact paths
are excluded from Vitest rather than silently dropped.

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
node apps/website/tests/ui/Reconciliation.mjs
```

Browser.mjs completes its functional assertions and writes a failing receipt
before asserting that accumulated accessibility violations must be empty. The
desktop audit currently reports `aria-hidden-focus`: StatsChart's aria-hidden
plot contains `<g class="recharts-layer recharts-pie" tabindex="0">`, despite
PieChart's `accessibilityLayer={false}`. Preserve the textual six-state equivalent
and fix this in the original chart author's owned files. The audit is not waived.

Browser functional assertions cover filters, cursor/selection/search preservation,
stale reads, online recovery, details focus and keyboard activation, mobile width,
generation revocation, unknown command receipts, and real React StrictMode
lifetime/unmount cleanup of both countdown/poll intervals. Reconciliation.mjs
also checks hidden-page behavior, focus after unchanged reads, overlap prevention,
expiry revocation, and no reads after disposal.

## Real runtime attempt and remaining gates

The one foreground disposable PG 16.15 attempt verified extracted production CSS
served byte-for-byte through workerd. It timed out waiting for the production
demo's connected state. The exact container was removed, absence verified, and
the fresh private configuration deleted. No production bootstrap failure cause
has been established. Production.mjs subsequently passed with synthetic HTTP;
this does not substitute for the failed real backend gate.

ReactRunOwned.py provides an isolated fresh-credential/tmpfs/loopback runner with
bounded foreground child lifetime and exact container-ID cleanup. React.mjs
contains the remaining real authorization, cursor/global-statistics, persisted
retry time/countdown, responsive SVG, WebSocket reconnect, details/reset and
DB-time expiry recovery assertions. Those downstream assertions were not reached
in the recorded real runtime attempt. New diagnostic capture was added after the
failure and has not been rerun against PG. Do not treat the scaffold as PASS.

Root and playground aggregate lint commands fail on warnings in unchanged
historical backend qualification tests. Full-repository format includes unchanged
historical .multica artifacts and an unrelated diagnostics spec with format
failures. Relevant website/contracts/integration-harness lint and formatting are
checked separately without modifying those historical inputs or weakening rules.
Playground skipLibCheck remains the original transitive Recharts/Redux Toolkit
accommodation; application sources remain strict. No hosted/Cloudflare production,
tooltip/resize with real backend, or complete PG regression claim is made.
