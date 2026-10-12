# Dashboard UX integration qualification

This local follow-up starts at `0099ffef68397f78ea670c526df1528636497e54` and
integrates the exact original reads, primitives and DateTime slices. It preserves
the existing dark StyleX identity and six-state palette. No source preview,
port 8787, backend contract, migration, library API or cloud resource is changed.

Dashboard statistics, chart and tab counts now use authoritative `state.stats`.
The displayed snapshot remains mounted while a different query loads, with
localized `aria-busy` and a visible live announcement identifying previous results.
Failed replacement retains that announcement and manual reconciliation. Revoked
identity/generation never retains old rows, counts or detail. Read recovery is a
ghost action next to live status; creation and the scenario/reset lab remain
available in the private playground and are absent from read-only demo.

Shared Base UI tabs use manual keyboard activation. The current panel is kept
mounted when its controlled value changes. Numbered pagination and 20/50 limits
use actual known cursor history, including the next neighbor. These are browsing
positions, not filtered ranks, total page counts or arbitrary jumps. See
CursorPagination.md for concurrent-change and scope-reset semantics. A localized
page count reports the displayed query only after successful replacement.

Every displayed timestamp uses DateTime: Updated and Terminal columns, detail
Updated/Terminal/observation/availability/retry, and session expiration. Null
terminal time remains Not recorded. Local date/year/time with seconds is visible;
keyboard/touch details expose timezone/offset, exact local and UTC time, and ISO.
The persisted availableAt and countdown/eligibility calculation are unchanged.

Body/table roles use 14px, secondary 13px and small metadata 12px, with existing
sans/mono families. The table scrolls horizontally inside its panel on narrow
screens; tabs and page controls wrap. Prose remains within 72ch. No additional
font, Temporal, Tailwind, Next pipeline or second theme was introduced.

## Reproduction

```sh
bun install --frozen-lockfile
bun run build
bun install --frozen-lockfile
bun run playground:check
bun run playground:build
node_modules/.bin/vitest run --cache=false --exclude 'tests/poc/**' --exclude 'apps/website/tests/ui/Field.test.mjs' --exclude 'apps/website/tests/ui/Theme.test.mjs' --exclude '.multica/**'
bun apps/website/tests/ui/Field.test.mjs
node --test apps/website/tests/ui/Theme.test.mjs
bun run playground:test:primitives
bun apps/website/tests/ui/DateTime.compile.mjs
node apps/website/tests/ui/Ux.mjs
bun apps/website/tests/ui/StatsChart.mjs
node apps/website/tests/ui/Production.mjs
bun run check:postgresql
bun run test:release-imports
bun run check:docs:api
```

Use task-local dependencies/caches. Vitest excludes generated evidence and has
cache disabled. A first broad invocation accidentally included the temporary
exact-base archive, duplicated suites and failed its Bun-only test under Node.
That archive was removed after retaining its built artifacts and screenshot
receipts. The corrected invocation tests current sources only; 499 PASS and
50 skipped PG tests, which remain NotTested.

The historical Browser.mjs/Focus.mjs five-row fixture assumptions are not reused
as evidence for this twenty-row UI. Ux.mjs qualifies the new production HTTP
behavior; UxRuntime.mjs reproduces original real-PG retry, focus, eviction,
reconnect, rotation, private reset and expiry contracts with current controls.
Existing historical reports are preserved, rather than declared valid for a
changed UI bundle. Original Runtime/Atoms/Reads tests cover lifetime/races/WS
admission/authority revocation and run against this integration.

The real gate needs Docker, local Playwright Chromium and the existing pinned
worker toolchain. Explicit authorization is limited to three sequential attempts,
one disposable exact-owned container at a time; stop at final PASS. It binds
local workerd to 18842 and never uses preview configuration. Prepare only the
migration fixture in a fresh evidence directory, then execute synchronously:

```sh
apps/playground-worker/node_modules/.bin/esbuild apps/playground-worker/tests/integration/SchemaEntry.ts --bundle --platform=node --format=esm --external:effect '--external:effect/*' '--external:effect-jobs/*' --outfile=.multica/ux-runtime-final/Migrations.mjs
PLAYGROUND_EVIDENCE_DIRECTORY=.multica/ux-runtime-final python3 apps/playground-worker/tests/integration/UxRunOwned.py
```

The wrapper owns `effect-jobs-upve-2046-ux`, pinned PG16.15 tmpfs storage,
loopback port, fresh synthetic credentials, and exact-ID cleanup. It removes its
private configuration and verifies the child node/workerd/Chromium group is absent.
Runtime checks also require zero remaining PG sessions. The second attempt
exposed a historical oracle error: next_generation_at is the automatic generator
deadline, continuously advanced by Executor.generate, rather than reset admission
cooldown. The current reset path has no such time guard. The harness now calls
the actual reset and requires generation 2 in DB/UI plus exact stale-read denial;
no generator/job/authority deadline is altered to make reset pass. The harness changes only
the application-owned demo rotation deadline, holds a real RetryScheduled row
until its persisted deadline, and requires actual worker completion after release.
It never rewrites job lifecycle timestamps or substitutes simulated success.

## Browser and design evidence

Ux.mjs serves the actual production bundle under self-only CSP with synthetic
65-job HTTP responses. A lockfile-pinned ws8.21.0 fixture, resolved through
the existing Miniflare test dependency, provides admission-ready signals; this
avoids unrelated missing-socket reconnect noise during deliberate HTTP delays.
Real WS behavior is qualified only by the separately labeled workerd receipt. Delayed server responses demonstrate retained rows,
mounted shell/table/chart, stable global statistics and filter keyboard focus and
scroll. It checks neighboring numbered/back navigation, page-size scope reset,
counts, failed replacement/recovery, expiry and generation change racing old HTTP.
Generation invalidation must clear rows/stats/details before replacement and must
fence the late old response. It opens exact dates through Enter/Space and checks
Escape/Close focus restoration. Desktop/mobile axe has zero WCAG2/2.1 A/AA
violations. A separate Chromium touch context taps a real DateTime popup,
asserts at least 44px trigger/Close targets and 390px popup containment.
These are automated Chromium observations, not physical-device claims.

Before screenshots came from an archived exact base built with local pinned
dependencies, served the same synthetic dataset and date in Europe/Warsaw.
No source-preview cache or private data was used. `Ux.mjs --before` requires
recreating that base archive under `.multica/ux-base`, with local dependency
resolution, and building its website first. The archive is disposable; preserve
its receipt/artifact hashes and screenshots before removal. Keep generated
archives excluded from any test or formatting discovery.

Official Impeccable guidance was read from a pinned upstream commit, recorded
with SHA256 in the attached handoff. The launcher was unavailable: context,
detect, slash commands and CLI were **not invoked**. No install, hooks, telemetry,
uploads, global resources or agents were used. Existing implementation/tokens and
accepted requirements supplied context; no PRODUCT.md/DESIGN.md was invented.
Scoped manual audit/typeset/layout/polish guidance preserved the current Operate
surface. One batched desktop/mobile inspection led to profile-label separation,
44px navigation width and consistent table data sizing; the second batched
inspection confirmed those corrections. There is no further visual polish loop.

## Final focus regression and remaining prerequisite

An expanded keyboard pagination check reproduced native disabled-button focus
loss after a successful delayed Page 2 read. Dashboard now remembers the focused
pagination control and restores it with preventScroll after loading only when it
still exists, is enabled and the browser focus remains on body. Moving focus,
pressing Tab or pointing outside the pagination cancels restoration. The original
reproduction plus the no-stealing case pass with the final production bundle.
The shared Pagination component remains the original author's unchanged code.

The real PG sequence was PASS, FAIL, PASS; attempt 2 exposed the incorrect
generator-deadline oracle described above, fixed before attempt 3. All resources
were cleaned. The final focus-only source correction occurred after attempt 3,
so the previous real browser receipt qualifies its explicitly hashed bundle,
not the final new Client.js. Current build/types/scoped lint/format/synthetic
Chromium keyboard/touch/axe pass. No fourth PG attempt is permitted by this issue;
final exact-artifact PG qualification requires an explicit new finite window
from the coordinator/owner. This handoff is blocked on that prerequisite and must
not be presented as ready for review or preview activation.

## Limits

Dashboard-specific local PG/workerd/Chromium qualification is distinct from full
CI. Historical root/playground aggregate lint and whole-repository formatting
failures remain without waiver. Application sources are strict; transitive
skipLibCheck remains unchanged. The 50 skipped PG suites are not qualified by
this dashboard test. Unchanged library/backend installed matrices retain only
their exact-byte historical evidence, not a new blanket PASS. Hosted Cloudflare,
physical touch devices and other browser engines are NotTested. No push, PR,
merge, preview activation, deployment or review dispatch is authorized here.
