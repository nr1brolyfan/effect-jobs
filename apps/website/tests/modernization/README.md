# Typed website test projects

`Projects.ts` exports three disjoint Vitest projects for registration by the shared
configuration owner. They do not replace the existing library, PostgreSQL, crash,
installed-consumer, benchmark or native-worker gates.

| Project         | Files           | Execution                                                                          |
| --------------- | --------------- | ---------------------------------------------------------------------------------- |
| website-unit    | `*.unit.ts`     | Node; palette and static HTTP asset policy                                         |
| website-browser | `*.browser.tsx` | Vitest's real Playwright Chromium provider; native controls and accessible buttons |
| website-e2e     | `*.e2e.ts`      | Node drives real Chromium against disposable Vite-built component/browser fixtures |

The provider is passed to `websiteProjects(playwright())` by the root registrar.
Use `vitest@4.1.11`, `@vitest/browser-playwright@4.1.11` and
`playwright@1.56.1`. Install Chromium using that exact Playwright release.
`@effect/vitest@4.0.5` requires Vitest 5 and cannot be registered with this pin.
Effect tests can use the installed Effect 4 `Scope` and `TestClock.layer()` APIs
through Vitest's ordinary async test boundary; this is not a claim that the
incompatible official adapter is supported. Existing runtime-owner tests stay
with that owner.

The shared registrar must preserve existing test discovery/exclusions and add
these projects explicitly. The suffixes deliberately avoid accidental discovery
by the legacy root runner before registration. Shared manifest, lock, TypeScript
and CI edits remain with their sole owner. Until registration, the legacy `.mjs`
gates remain authoritative and must not be removed.

`apps/playground/tests/fixtures/BuildFixture.ts` compiles original sources with
the application's Vite configuration and official StyleX plugin. Fixture-only
imports resolve through the playground's declared dependencies, using Vite's
import conditions. No generated source mirror or separate Babel compiler is
used. Each fixture build has an owned temporary directory, is read before cleanup,
and records source/config/lock and output hashes in ignored local evidence.
`FixtureServer.ts` owns ephemeral loopback listeners. Tests close pages, browsers
and listeners before returning. Component browser mode proves native DOM behavior;
its Vite development server does not qualify production CSP or extracted CSS.

## Oracle map

No legacy test is deleted by this partial migration. Registration and complete
coverage of each legacy entrypoint must precede its removal.

| Existing oracle                                           | Typed coverage                                                                                                                                                       | Still required before legacy removal                                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ui/Field.test.mjs`                                       | `Field.browser.tsx`: unique native/custom label associations, value preservation, explicit id/checkbox props                                                         | Shared dependency registration and replacement root test command                                                               |
| `ui/Theme.test.mjs`                                       | `Theme.unit.ts`: all text/focus contrast; `Field.browser.tsx` verifies all 25 named Lucide mappings, aria, stroke and sizing                                         | UI deduplication is delivered; the literal path-array requirement is replaced by actual rendered named graphics                |
| static HTTP case in `site/Foundation.mjs`                 | `StaticAssets.unit.ts`: GET/HEAD/POST, API/private/dotfile exclusions, docs and dashboard CSP                                                                        | `Extraction.unit.ts` retains all marker/path/symlink/LCS cases through the typed site implementation                           |
| `ui/details/Details.browser.mjs`                          | `Details.e2e.ts`: drawer/full/related/history, relock/unmount, focus/scroll, mobile overflow, axe, stale generation, direct demo fallback                            | Canonical project registration; original legacy fixture's `kind` assumption is obsolete                                        |
| paging/stale/Unknown/cleanup portions of `ui/Browser.mjs` | `Browser.e2e.ts`: exact 20-row page identities, next cursor, lifecycle update, filters/stale retention, no command replay, reads/events stopped beyond the next poll | Remaining dashboard/a11y/mobile/reset/docs assertions stay in the legacy entrypoint                                            |
| `ui/Focus.mjs`                                            | `Browser.e2e.ts`: Escape/Close row focus and page-eviction fallback                                                                                                  | Canonical registration                                                                                                         |
| worker `integration/React.mjs` five-row assertion         | `Browser.e2e.ts`: exact default of 20 and page identities on synthetic reads                                                                                         | Real PostgreSQL/workerd test remains separate and owned outside this test tree; synthetic coverage is not a replacement for it |

The detail fixture separately exercises a bounded, shareable state filter (page 3,
opaque cursor, selection and scroll restored) and an unshareable `name` filter
(page 1 with safe focus fallback, no name retained in URL/history). The latter
is an intentional privacy boundary, not a reason to restore the obsolete `kind`
field or relax the assertion.

Polling cleanup observes actual list/describe/write counts for longer than the
five-second polling period after disposal. It does not assume that Effect fibers
allocate native `setInterval` handles. Deterministic scheduler/race coverage stays
in the runtime owner's existing tests.

Other legacy site, documentation, installed, rendering and real-PG runners remain
unmigrated. Legacy `Jobs.html` consumers must move to the built canonical site alias
once that source/config handoff is integrated; this slice does not remove the guide.
Native application workerd test registration requires the native Alchemy source
and configuration handoff. Neither mocks nor this browser provider prove it.

## Continuation and resource qualification

`ProviderLifecycle.ts` starts the actual three projects through the public Vitest
API, awaits close, checks that no timer or other active resource remains and
requires natural child-process exit. It uses no timeout extension, force exit,
GC, unref, dependency patch or warning suppression. The StyleX 0.19.1 HTTP hook
starts an interval finalized only by `httpServer.close`; Vitest also has a
middleware-only transform server without HTTP. `Projects.ts` retains the hook on
the real browser server and omits that HTTP-only hook on the middleware host.
Transform/extraction and real browser CSS serving remain enabled.

The fixture builder and browser project deduplicate React/ReactDOM. Qualification
requires a fresh canonical hoisted Bun install; forcing an install over an older
isolated layout can leave physical React copies and does not prove freshness.

`Dashboard.e2e.ts` runs the complete typed Browser, Reconciliation and Primitives
runners, retaining their keyboard/mobile/axe/CSP/reset/no-replay/focus/disposal
oracles. Primitives and dashboard fixtures use the same canonical Vite builder.
Legacy CLI entrypoints delegate to the typed implementations while the foundation
owner retains shared root scripts. Field's compatibility entrypoint executes the
registered real-browser project; Theme retains both contrast checks, while icon
semantics live in the registered browser tests. No `.mjs` entrypoint is added.
`Docs.unit.ts` checks the full snippet inventory and malformed-region negatives;
`Reference.ts` preserves exact generated bytes and the existing `--check` mode.
`StatsChart.unit.ts` executes the existing complete loading/zero/global-count/
ordered-state/percentage/text-accessibility render oracle with StyleX enabled.
`FormAtoms.browser.tsx` independently proves simultaneous state isolation and
revoked-setter behavior across a new field lifetime. The UI owner's separate
FormAtoms lifecycle gate and runtime owner's Clock/Scope tests remain unchanged.

## Independent packed graph

`packed/consumer.json` and `packed/consumer.lock` freeze an independent Bun-only
consumer. `Packed.ts` installs the actual library and private contract tarballs
outside the repository, without ancestor workspace dependencies, source aliases,
manual dependency links or library development dependencies. For each new packed
artifact it rebinds only the two local tarball integrity entries; registry graph,
pins and integrity bytes stay frozen. The receipt hashes both the template and
actual consumer lock, artifacts, source inputs and runner. Lock authoring is an
explicit `--write-consumer-lock` maintenance operation, never normal qualification.

Redux Toolkit is exactly 2.13.0 with declaration SHA256
`4ebd4061b84c620b21e519842bab9f1a42b3c48e17ba7742ee172492e81a518d`.
Strict/exactOptional/noUnchecked/verbatim/noEmit/skipLibCheck:false remains the
raw declaration gate: exactly six errors at 994 (three TS2344), 997 (TS2344),
1690 (TS2344), 2064 (TS2420). It remains FAIL. `Installed.e2e.ts` verifies that
accepted failure contract separately from successful own-code types, a broken
caller negative control, Vite browser bundle and Node/Bun state smoke without
PG/Drizzle peers. It never reports the full strict gate as PASS.

The Browser and Reconciliation guide consumers load canonical built assets through
`StaticAssets`, including `/docs/jobs` and `/docs/playground`. Worker-owned
`integration/Local.mjs` still injects legacy `Jobs.html`; its owner must migrate it
before the site owner removes that file. No blanket HTML removal is authorized.
Native Alchemy application testing still requires the native phase-B source/config
handoff and narrow capnp disposition. Existing wrapper/workerd/real-PG tests and
historical page-size/filter reproductions are retained, not relabeled native proof.
Other historical rendering/qualification entrypoints retain their existing gates
until their full oracle coverage is migrated; this continuation does not authorize
their deletion or weaken backend/runtime qualification.
