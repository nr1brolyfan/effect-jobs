# Typed website test projects

The foundation-owned root configuration registers three disjoint projects:

| Project         | Authored files  | Execution                                                      |
| --------------- | --------------- | -------------------------------------------------------------- |
| website-unit    | `*.unit.ts`     | Node assertions, render/extraction/static asset contracts      |
| website-browser | `*.browser.tsx` | Real Playwright Chromium provider and native DOM controls      |
| website-e2e     | `*.e2e.ts`      | Node drives disposable canonical fixtures or production assets |

Run `bun run test:website`. Run `bun run playground:check` and
`bun run playground:lint` for the authored adapters and fixtures as well.
The supported pins remain Vitest/browser-playwright 4.1.11, Playwright 1.56.1,
Vite 8.3.4 and the application's declared StyleX plugin. Effect 4 TestClock and
Scope tests use ordinary Vitest async boundaries; incompatible @effect/vitest 5
registration is not implied.

## Canonical fixtures and lifetime

`apps/playground/tests/fixtures/BuildFixture.ts` compiles actual source through
the application's Vite configuration. There are no Babel source mirrors,
ad hoc Bun builds, React dependency links or alternative style transforms.
`FixtureServer.ts` owns temporary build directories and ephemeral loopback
listeners. Every browser adapter awaits browser/server disposal. Server tests
that use raw WebSocket frames also destroy owned sockets before returning.
Production browser tests hash the actual Client/CSS bytes separately from
synthetic HTTP input. No synthetic fixture is evidence for real PostgreSQL,
authority, workerd, native Alchemy or hosted operation.

`ProviderLifecycle.ts` runs every registered unit/browser/e2e file in complete,
explicit partitions. The original complete 24-test set stays together in one
combined host; additional adapter waves receive separate full host lifetimes.
Each child creates the same three configured projects,
asserts exact selected-module coverage, awaits host.close, checks active resource
absence and zero referenced timers, and exits naturally. Each child retains the
existing 120-second bound. The complete suite grows by adding finite partitions,
not by extending teardown limits. Test failures still fail the aggregate, even
when their resource cleanup succeeds. Per-partition logs and resource receipts
are written beneath `.multica/test-continuation`.

The pinned StyleX HTTP-only configureServer hook remains enabled on real HTTP
servers and omitted only on middleware hosts without httpServer. This preserves
real extraction/browser CSS while avoiding a timer whose only release event is
HTTP close. No force-exit, timeout extension, unref, GC or warning suppression is
part of the proof.

## Legacy migration and oracle map

`LegacyMigration.json` enumerates all 47 original entrypoints, their baseline
hashes and authored replacements. All 47 old files are removed after moving their useful assertions and
replacing shared registrar invocations with typed entrypoints. The two Local/React
worker delegates and unused website helper are also removed. DemoUnlock retains
its independent historical baselineRoot reference. A filename
change alone does not qualify a migration: strict authored types, canonical
builds and runtime/negative controls remain separate gates.

| Original responsibility       | Typed oracle                                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field and Theme               | `Field.browser.tsx`, `Theme.unit.ts`: labels, props, contrast; all named Lucide mappings, aria, stroke and sizing                                                                                        |
| Foundation/static routing     | `Extraction.unit.ts`, `StaticAssets.unit.ts`: regions, malformed markers, paths, symlinks, line changes, verbs, reserved/private routes and CSP                                                          |
| Dashboard, focus and receipts | `Browser.ts`, `Reconciliation.ts`, `Browser.e2e.ts`, `AcknowledgementFocus.ts`: exact pages/cursors, stale rows, focus, unknown outcomes, no replay and disposal                                         |
| DateTime                      | `DateTime.browser.ts`: production extraction, exact DST/local/UTC/ISO, null/invalid/epoch, keyboard/touch, geometry, focus and CSP                                                                       |
| Details lifecycle             | `Details.e2e.ts`, `details/Focus.browser.ts`: drawer/full/history, relock, replacement/evicted opener, mobile, axe and generation fencing                                                                |
| Payload                       | `payload/Browser.ts`, `DetailsIntegration.ts`, `ShellPayload.ts`: real crypto, wrong keys/tamper, held decrypt/copy completion, volatile plaintext, storage/network/log/history denial, mobile and a11y  |
| Repair                        | `repair/Browser.ts`, `Applicability.browser.ts`, `Composition.ts`: eligibility, field validation, confirmations, exact immutable receipts, no resubmission, keyboard/focus and negative controls         |
| Refresh/chart/shell           | `DashboardRefresh.ts`, `Declutter.browser.ts`, `Ux.ts`, `StatsChart.browser.ts`, `StatsChart.render.tsx`: real transports, stable DOM, cursors, global counts, SVG, tab exclusion, mobile and CSP        |
| Documentation                 | `docs-reference/*.ts`, `order-tutorial/*.ts`, `site/*.ts`: exact regions/bytes, links/anchors, keyboard/no-JS, negative callers, packed/source types, Node/Bun and owned PostgreSQL                      |
| Real worker adapters          | `apps/playground-worker/tests/integration/Local.ts`, `React.ts`: canonical assets, exact 20-row/cursor identities, DB time, real workerd/Chromium, private authority, rotation/reset, expiry and cleanup |

The read-only demo omits mutation controls. Retry scheduling displays the actual
persisted availability through DateTime; DB eligibility is checked while the
real row is locked, then completion is observed after release. Pure countdown
and equality contracts retain their independent existing RetryTime tests.
The real six-job scenario assertion follows those exact admitted identities,
excluding unrelated starter jobs. Reset starts the documented six starter jobs
in a new generation; stale generation requests still fail.

The chart's standalone fixture uses the canonical 13-item client independently
of the paging fixture's 43-item extension. The details fixture covers both
shareable filters/cursors and the intentional privacy fallback for unshareable
name filters. Polling disposal observes actual list/describe/write counts beyond
the next poll, rather than counting native setInterval handles.

## Installed consumers

`packed/consumer.json` and `packed/consumer.lock` retain the independent frozen
Bun graph. `Packed.ts` installs actual library/private-contract tarballs outside
the workspace, without ancestor dependencies, manual links, source aliases or
library development dependencies. Only local tarball integrity entries are
rebound per artifact; registry pins and integrity bytes remain frozen.

Toolkit remains exactly 2.13.0 with declaration SHA256
`4ebd4061b84c620b21e519842bab9f1a42b3c48e17ba7742ee172492e81a518d`.
Full strict/exactOptional/noUnchecked/verbatim/noEmit/skipLibCheck:false stays a
raw FAIL with the accepted six diagnostics: 994 (three TS2344), 997 and 1690
(TS2344), 2064 (TS2420). `Installed.e2e.ts` checks that precise failure contract
separately from own-code types, the negative caller, Vite bundle and Node/Bun
smoke. It must never describe the full strict gate as PASS.

## Source-owner dependencies

Guide consumers now use canonical built assets and the /docs/jobs alias.
The site source owner removed obsolete Jobs.html after verifying the
zero-code-consumer inventory. Shared manifests,
locks, scripts, CI and registrars remain with foundation. Foundation delivered typed registrar replacements before delegate removal.
Its temporary website **/*.mjs exclusion remains foundation-owned.

The API-design page compiles all seven snippets against current source, with
negative callers for queue overrides, missing policy and undeclared slots. Obsolete APIs or unused expect-error directives are
real failures requiring the page/scaffold owner to reconcile the contract;
qualification must not accept those errors as a new exception.

Native application qualification waits for the native owner's actual phase-B
Alchemy entry/module/bindings, approved dependency graph, local HTTP/WebSocket
client and awaited disposal contract. Manual Miniflare/workerd tests qualify
only that legacy local host. They do not establish native Alchemy assembly,
cloud provisioning or hosted behavior. Real-PG adapters remain separate from
synthetic component tests and do not replace the library's PG/crash matrices.
