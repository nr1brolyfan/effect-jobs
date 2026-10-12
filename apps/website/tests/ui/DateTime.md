# Shared timestamp display

`DateTime({ value, seconds = true, label = "Timestamp" })` accepts authoritative
epoch milliseconds, including zero, or null/undefined. Import it from
`../../ui/DateTime.js` in the jobs feature. The essential local date, year and
time are always visible in a semantic `<time dateTime={iso}>`. A native button
trigger opens the sibling-owned shared Popover. The accessible name identifies
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

## Integration ownership and complete timestamp inventory

C owns only DateTime.tsx, DateTime.stylex.ts, DateTimeFormat.ts and these
date-specific tests/docs. B supplies `./Popover.js` exports Root, Trigger, Portal,
Positioner, Popup, Close and their compatible Base UI props. D owns Dashboard
wiring, after consuming all stream handoffs. Do not manufacture a replacement
Popover in B's tracked path or install dependencies from this stream.

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

Run from the repository root with the existing pinned toolchain; no installation:

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

Deferred integration gates: actual B Popover prop typecheck and bundle; keyboard,
touch and axe checks in Chromium; full production extraction/CSP/runtime matrix.
The isolated C branch cannot render the component before B's Popover is present.
No substitute or mock Popover evidence counts as satisfying this dependency.

Once B is integrated, use a synthetic timestamp `2026-10-25T00:30:00.123Z` and
Europe/Warsaw browser timezone. Tab to the trigger and open with Enter and Space;
assert the named popup contains 02:30:00.123 GMT+02:00 and UTC 00:30:00.123, and
`time[datetime]` retains the ISO value. Close with Escape and the Close button;
verify focus returns to the trigger. Test Tab traversal, outside dismissal and
multiple instances with unique heading associations. Repeat with touch at 390px:
tap opens details, close is reachable, trigger and Close targets are at least
44px tall, popup stays within viewport and ISO wraps. Test null/undefined/zero,
seconds=false, no duplicate nested controls, axe and no runtime errors. Capture
synthetic desktop/mobile evidence on the separate integration runtime, never the
owner's preview or private session.

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
