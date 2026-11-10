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

| Existing oracle                                           | Typed coverage                                                                                                                                                       | Still required before legacy removal                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ui/Field.test.mjs`                                       | `Field.browser.tsx`: unique native/custom label associations, value preservation, explicit id/checkbox props                                                         | Shared dependency registration and replacement root test command                                                                 |
| `ui/Theme.test.mjs`                                       | `Theme.unit.ts`: all text/focus contrast and current registry comparison                                                                                             | Remove registry comparison only with the UI owner's actual icon deduplication; browser button/icon accessibility remains covered |
| static HTTP case in `site/Foundation.mjs`                 | `StaticAssets.unit.ts`: GET/HEAD/POST, API/private/dotfile exclusions, docs and dashboard CSP                                                                        | Source extraction/marker/symlink/LCS cases remain in Foundation until typed site source is integrated                            |
| `ui/details/Details.browser.mjs`                          | `Details.e2e.ts`: drawer/full/related/history, relock/unmount, focus/scroll, mobile overflow, axe, stale generation, direct demo fallback                            | Canonical project registration; original legacy fixture's `kind` assumption is obsolete                                          |
| paging/stale/Unknown/cleanup portions of `ui/Browser.mjs` | `Browser.e2e.ts`: exact 20-row page identities, next cursor, lifecycle update, filters/stale retention, no command replay, reads/events stopped beyond the next poll | Remaining dashboard/a11y/mobile/reset/docs assertions stay in the legacy entrypoint                                              |
| `ui/Focus.mjs`                                            | `Browser.e2e.ts`: Escape/Close row focus and page-eviction fallback                                                                                                  | Canonical registration                                                                                                           |
| worker `integration/React.mjs` five-row assertion         | `Browser.e2e.ts`: exact default of 20 and page identities on synthetic reads                                                                                         | Real PostgreSQL/workerd test remains separate and owned outside this test tree; synthetic coverage is not a replacement for it   |

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
