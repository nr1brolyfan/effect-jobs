# Shared timestamp display

`DateTime({ value, seconds = true, label = "Timestamp" })` accepts authoritative
epoch milliseconds, including zero, or null/undefined. Import it from
`../../ui/DateTime.js` in the jobs feature. The essential local date, year and
time are always visible in a semantic `<time dateTime={iso}>`. A native button
trigger opens the shared Base UI Popover. The accessible name identifies
the field, visible time and resolved IANA timezone. No hover-only title is used.
Use a field-specific label (for example `Updated` or `Retry available at`).

The details include local timezone name plus the instant's UTC offset, exact
local/UTC dates with seconds and milliseconds, and selectable ISO 8601 text.
The offset disambiguates repeated DST hours. `seconds={false}` affects only the
compact display; details and machine-readable ISO retain the exact instant.
Null/undefined display `Not recorded`, with no focusable empty control or invalid
`datetime`. Nonfinite/out-of-range values display `Invalid timestamp`.
There is no clock, timestamp arithmetic, clipboard dependency or zone menu.

`formatDateTime(value, { locale, timeZone, seconds })` exposes deterministic
formatting for tests. Production uses browser locale/timezone defaults. Intl and
Date are presentation FFI; they must never feed timestamps back into scheduling,
retry arithmetic, eligibility or persisted state. Invalid locale/timezone
configuration is a caller error; production does not accept arbitrary zone input.

The trigger selects `Popover.Trigger variant="timestamp"`, which omits the
shared default button classes. DateTime supplies one complete StyleX result:
transparent, normal weight, no inline inset, two left-aligned lines and a visible
keyboard focus ring. The column layout wraps within its container; coarse-pointer
targets retain a minimum 44px height. Other Popover triggers keep default styling.

DateTime has no visible Close button. Base UI owns Escape, outside-click/touch,
Tab traversal and focus return. Escape returns focus to the trigger; leaving via
Tab or clicking an outside control preserves the newly selected focus. Local,
UTC and ISO values remain selectable. Other Popover instances retain Close.

## Complete timestamp inventory

Replace human-facing timestamps at all these locations, including currently
absent presentation locations. Keep identifiers, durations and generation
numbers separate from dates:

| Location                        | Authoritative value                                      | Required behavior                                                                                                                         |
| ------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Table Updated                   | `job.updatedAt`                                          | Compact DateTime with seconds and `Updated` label                                                                                         |
| Table Terminal                  | `job.completedAt`                                        | DateTime; null is Not recorded, including Isolated/Active/Pending/RetryScheduled                                                          |
| Detail availability             | `detail.job.availableAt`                                 | DateTime with seconds, including non-retry jobs                                                                                           |
| Detail Updated                  | `detail.job.updatedAt`                                   | DateTime with seconds                                                                                                                     |
| Detail Terminal                 | `detail.job.completedAt`                                 | DateTime with nullable handling                                                                                                           |
| Detail observation              | `detail.observation.observedAt`                          | DateTime alongside unchanged outcome/source; absent observation stays Not recorded                                                        |
| Sandbox/session expiration      | `state.sandbox.expiresAt`                                | DateTime with seconds; preserve actual expiration guards                                                                                  |
| Demo rotation/session metadata  | Authoritative timestamp if surfaced by the read contract | Use DateTime for any displayed dates; current Sandbox contract has expiresAt only, so do not infer a rotation date from generation or IDs |
| Retry exact time                | `detail.job.availableAt`                                 | DateTime with seconds instead of `RetryTime.exactTime`/ISO/title                                                                          |
| Retry countdown and eligibility | `RetryTime.countdown(availableAt, now)`                  | Keep unchanged next to DateTime; at equality retain Eligible now · waiting for a worker, never imply execution started                    |

Do not insert DateTime's button inside another button/link. Current table rows
are clickable: preserve row selection and verify that opening/closing a timestamp
does not accidentally select a different job. Converting detail pairs currently
typed as strings requires a ReactNode value in D's implementation. Remove unused
raw ISO/compact/exactTime helpers only in files D owns. Inspect any new session or
rotation metadata during integration so no human-facing date remains raw ISO.

## Focused qualification

Run from the repository root with isolated, lockfile-pinned dependencies:

```sh
node_modules/.bin/vitest run apps/website/tests/ui/DateTimeFormat.test.ts apps/website/tests/ui/RetryTime.test.ts
bun apps/website/tests/ui/DateTime.compile.mjs
node_modules/.bin/oxlint --deny-warnings apps/website/src/ui/DateTime.tsx apps/website/src/ui/DateTime.stylex.ts apps/website/src/ui/DateTimeFormat.ts apps/website/tests/ui/DateTimeFormat.test.ts apps/website/tests/ui/DateTime.compile.mjs
node_modules/.bin/oxfmt --config .oxfmtrc.json --check apps/website/src/ui/DateTime.tsx apps/website/src/ui/DateTime.stylex.ts apps/website/src/ui/DateTimeFormat.ts apps/website/tests/ui/DateTimeFormat.test.ts apps/website/tests/ui/DateTime.compile.mjs apps/website/tests/ui/DateTime.md
```

The formatter suite covers absence, zero, invalid numbers, seconds, millisecond
preservation, locale/zone injection, date rollover, DST spring gap and repeated
fall hours in Europe/Warsaw. Existing retry tests guard countdown and equality
wording. DateTime.compile.mjs transpiles actual modules and extracts production
StyleX with runtimeInjection false, checks focus/coarse-pointer CSS and emits
source/CSS hashes. It does not render Popover or claim full build/CSP qualification.

`bun apps/website/tests/ui/DateTime.browser.mjs --before` compiles the actual
modules from frozen base `68f19504df18825e7e8db2769d06e18122484887` using
`git show`, without accessing the running preview. The same harness without
`--before` compiles current sources. It reuses the existing Primitives browser
compiler and pinned Chromium dependency, with runtime StyleX injection disabled.
The synthetic fixture contains constrained table/detail/session/retry values,
null/undefined/invalid/zero, and an unrelated default Popover with Close.

Screenshots and receipts land under `.multica/datetime-browser/before` and
`after`. Desktop and 390px emulated touch exercise Enter/Space, Escape and focus
return, Tab traversal, outside click/tap, exact Europe/Warsaw and UTC milliseconds,
semantic `datetime`, normal weight, zero inset, matching date/local left edges,
44px touch target, viewport bounds and strict CSP. Keyboard tests wait for Base
UI initial focus before advancing, so they exercise completed focus transitions.
This is synthetic component evidence, not real backend or physical-device testing.

Run `bun apps/website/tests/ui/Primitives.mjs` to verify default Popover behavior
and existing shared controls. Build contracts before the full production website:
`bun run --filter @effect-jobs/playground-contracts build`, then
`bun apps/website/build.mjs`. Integrated Dashboard locations and real runtime/axe
qualification remain the integration stream's responsibility; this slice does
not repeat the previous completed review or backend matrix.

## Documentation read before implementation

Read every file recursively under ai-docs (no documentation files skipped):

```text
ai-docs/README.md
ai-docs/tsconfig.json
ai-docs/src/index.md
ai-docs/src/01_services/10_services-and-layers.ts
ai-docs/src/01_services/20_module-consumption.ts
ai-docs/src/01_services/30_layer-composition.ts
ai-docs/src/02_modeling/10_schema-tagged-match.ts
ai-docs/src/03_errors/10_errors-and-causes.ts
ai-docs/src/04_observability/10_operation-observability.ts
ai-docs/src/05_resources/10_resources-interruption-secrets.ts
ai-docs/src/06_persistence/10_mutation-boundaries.ts
ai-docs/src/07_transport/10_wire-errors.ts
ai-docs/src/08_style/10_visible-code-and-modules.ts
ai-docs/src/09_testing/10_testing-and-review.ts
ai-docs/src/10_boundaries/10_external-time-regex.ts
ai-docs/src/fixtures/Auth.ts
```

Also read specs/architecture-decisions.md in full, canonical UPVE-1020 workflow
attachment, assigned issue and its empty comment scan, existing UI theme and
primitives, DateTime integration locations and retry tests. No tracked AGENTS.md
or applicable ancestor/website instructions were present beyond the runtime brief.
