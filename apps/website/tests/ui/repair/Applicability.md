# Job action applicability

This matrix describes existing server semantics at base
`78b0cd802ac76ef2b63fdceaac57cd98778b606b`, consumed by the UI. It grants no
new lifecycle transitions or permissions. `Applicability.test.ts` checks the
source projection; `Applicability.browser.mjs` checks production components/CSS
with controlled HTTP snapshots. `Applicability.real.mjs` exercises real
producer, worker, command, encrypted payload and reconciliation paths.

| Selected lifecycle     | Retry now | Cancel  | Redrive / corrected redrive | Reconcile applied / close problem |
| ---------------------- | --------- | ------- | --------------------------- | --------------------------------- |
| Pending                | absent    | present | absent                      | only retained unresolved problem  |
| RetryScheduled, future | present   | present | absent                      | only retained unresolved problem  |
| RetryScheduled, due    | absent    | present | absent                      | only retained unresolved problem  |
| Active                 | absent    | absent  | absent                      | only retained unresolved problem  |
| Completed              | absent    | absent  | absent                      | only retained unresolved problem  |
| Dead                   | absent    | absent  | conditional below           | only retained unresolved problem  |
| Isolated               | absent    | absent  | conditional below           | only retained unresolved problem  |
| Cancelled              | absent    | absent  | absent                      | only retained unresolved problem  |

Completed/Cancelled with no unresolved problem render neither operators nor a
repair card. Resolution is chain-level: a selected lifecycle alone does not
establish or prohibit an operator assertion about an existing unresolved chain.
The server does not restrict reconcile-applied to Unknown outcome alone.

| Resolution | Redrive / correction of Dead or Isolated                             | Reconcile applied / close           |
| ---------- | -------------------------------------------------------------------- | ----------------------------------- |
| No problem | source projection may allow repair; server establishes implicit Open | absent until a problem is projected |
| Open       | only current chain member, subject to artifact/catalog checks        | present                             |
| InProgress | absent                                                               | present                             |
| Resolved   | absent                                                               | absent                              |

The normal read query projects an implicit Open problem for untracked Dead and
Isolated sources. A stored problem can belong to a related selected job; both
resolution commands target its root/version, not the selected job's lifecycle.

| Payload / authority                             | Plain redrive                      | Correct and redrive                                                            |
| ----------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| Supported valid plain artifact                  | present when source/chain eligible | present when source/chain eligible                                             |
| Plain missing/corrupt artifact                  | absent                             | source projection may allow replacement; editor validates complete replacement |
| Unsupported catalog                             | absent                             | absent                                                                         |
| Compatible private encrypted artifact           | present when source/chain eligible | absent (server does not support correction)                                    |
| Compatible synthetic encrypted artifact, locked | present when source/chain eligible | visible, disabled; unlock prerequisite shown                                   |
| Same synthetic artifact, unlocked               | present when source/chain eligible | enabled subject to busy/validation                                             |
| Synthetic artifact unavailable                  | absent                             | absent                                                                         |
| Public read-only                                | absent                             | absent; resolution and operator cards also absent                              |

Busy/loading, pending commands, crypto work and invalid form inputs affect
**enabled state**, not semantic applicability. Pending repair identity/receipt
remains visible and other applicable controls remain disabled. Unknown outcome
never authorizes replay. Isolated investigation and duplicate-effect confirmation
remain mandatory. Unknown manual closure retains its explicit acknowledgment.
Server-side scope, DB-time, source/version, artifact and permission checks remain
unchanged. The applicability metadata cannot predict every concurrent server
rejection or future expiry.

Source evidence (paths and lines at the implementation handoff):

- `src/JobLifecycle.ts:484`: exact snapshot validation; retry/cancel state and
  DB-time `already-due` rejection at 501–508.
- `src/internal/postgresql/Operators.ts:80`: source/version validation;
  Dead/Isolated redrive at 146, canonical source and policy checks afterward.
- `apps/website/src/server/read/JobDetailsProjection.ts:91`: source/chain common
  refusal; plain artifact checks at 105; supported correction/encryption at 112.
- `apps/playground-worker/src/persistence/commands/RepairPersistence.ts:90`:
  resolution version, Resolved, InProgress and current member refusal.
  Lines 155–205: implicit problem, unresolved resolution assertions and unknown
  manual-close acknowledgment. No lifecycle-specific restriction on a stored
  unresolved problem is added by the browser.
- `apps/playground-worker/src/persistence/commands/RepairSource.ts:206`:
  known-failure evidence and investigation; replacement catalog, authenticated
  synthetic envelope and immutable relations checks below.
- `apps/website/src/server/read/PostgreSqlRead.ts:291`: projected problem,
  payload and eligibility. `apps/playground-worker/src/persistence/read/Queries.ts`
  projects implicit failures and retained chain membership.
- `apps/website/src/features/jobs/OperatorEligibility.ts:11`: private capabilities
  and state/time eligibility; `repairApplicability` consumes server repair metadata.
- `packages/playground-contracts/src/Jobs.ts:213` and
  `apps/website/src/server/read/JobDetailsProjection.ts:134`: result has only
  Unavailable/not-stored. There is no stored handler result to relocate. Retained
  provider/history evidence continues in the existing overview/timeline; no dummy
  result section is rendered in the payload panel.

Qualification commands from repository root:

```sh
bun run playground:test
node apps/playground-worker/tests/integration/Build.mjs
node apps/website/tests/ui/repair/Applicability.browser.mjs
bun apps/website/tests/ui/repair/Browser.mjs
python3 apps/website/tests/ui/repair/ApplicabilityOwned.py
```

The owned runner provisions only a fresh pinned PostgreSQL 16.15 tmpfs container,
uses docker.exe if the Linux daemon is unavailable, writes random credentials to
a mode-0600 file, runs the real test within five minutes, and removes that exact
container/config. The real test disposes its Chromium, workerd and PG pool.
Evidence is runtime-local under `.multica/task/real`; deliver it as attachments.
No existing preview, private config or owner database is used. No fake lifecycle
SQL, hosted deployment or full unchanged historical qualification matrix.
