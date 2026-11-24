# Local DO SQLite JobStore qualification

Run from the repository root with Node 24.15.0, npm 11.12.1 and Bun 1.4.2.

```sh
bun install --frozen-lockfile --ignore-scripts
npm ci --prefix tests/qualification/do-sqlite-atomicity --ignore-scripts --no-audit --no-fund
npm run --prefix tests/qualification/do-sqlite-atomicity check
npm test --prefix tests/qualification/do-sqlite-atomicity
tests/qualification/do-sqlite-atomicity/node_modules/.bin/tsc -p tests/qualification/do-sqlite-jobstore/tsconfig.json
node --test --test-force-exit --test-timeout=25000 tests/qualification/do-sqlite-jobstore/Qualification.mjs
```

The lifecycle runner uses the atomicity harness's installed dependencies and lockfile.
It asserts Miniflare 5.20261006.1-alpha, workerd 1.20261006.1, Effect 4.1.3,
Alchemy and its Cloudflare module 2.0.0-beta.85, and compatibility date 2026-10-01.
It reports the actual executable and bundle hashes and checks that the bundle
resolves Effect from one installation. The atomicity suite remains a separate
regression gate for the asynchronous enqueue owner.

- **Application fixture.** The local Worker selects one named, SQLite-backed DO for
  both logical queues. The fixture installs its own schema and seeds synthetic
  jobs with the real producer, standard codec and joined capability in a native
  transaction. The seed endpoint performs inserts only. The host starts and stops
  Miniflare, isolates each test with a fresh `resourcePersistencePath` and reuses
  that path for controlled restarts. It bounds startup, requests, expiry polling
  and disposal, and removes the storage directory in cleanup.
- **Store fixture.** Every lifecycle request uses the existing `JobStoreService`
  shape and actual source validators, transition plans and reconciliation
  inspectors. Each transition uses one `transactionSync` callback and one SQLite
  clock snapshot. The update fences the exact ID, state, token, expiry and
  version, separately from validating the request's frozen before snapshot.
  Claim reads the matching payload in that transaction. The native output gate
  and native `storage.sync()` are the acknowledgment boundary.
  Claim conservatively charges elapsed local runtime time against the lease from
  SQL, and returns `Unknown` when it cannot confirm the response reserve.
- **Exact evidence.** In this fixture the last finalization request is written in
  the same row update as its transition. Reconciliation checks both this receipt
  and the observed lifecycle snapshot. This distinguishes commands that can
  reach an identical terminal row, including an exhausted Retry and an explicit
  Dead with the same code. This is a provisional internal representation. A later public storage contract
  requires a decision on durable evidence, retention and schema evolution.
- **Fault injection.** The fixture discards successful acknowledgments after the
  native barrier and exposes `Unknown` through the same port. It counts calls and
  dropped acknowledgments separately. The held-sync cases wrap the actual native
  `sync()`, wait for native success, and hold its returned
  promise until the host releases it. The DO records the phase at drop and at
  response construction. Those observations check ordering independently of HTTP
  delivery through the workerd output gate. The separate restart case uses the
  unwrapped native barrier. It reconciles using only read operations
  and the caller's original token or complete request. Distinct object epochs and
  identical object IDs and rows show reopen on the same local persistence path.
  A test-only write after those comparisons changes the persisted lifecycle version
  but retains the exact receipt and terminal state, and must defeat reconciliation.

The tests assert one winner across concurrent requests, unsupported catalog and queue
exclusion, before and after expiry against SQLite time, bounded queue-scoped
recovery, fresh fencing tokens, immutable policy and BLOBs, separate stall and
finalized-attempt counters, and rejection of stale or forged finalize requests.
Expiry polling checks a storage-clock condition. The timer only paces the reads.

Two focused recovery scenarios exercise different boundaries. The rollback case installs
a SQLite trigger that aborts an eligible second UPDATE once the preceding row in the
batch is already Pending. The test requires the port's Unknown error and compares the
entire persisted snapshot through a separate request. The exact-expiry case adjusts
three Active rows to expiry offsets of −1, 0, and +1 ms immediately after the port's
only SQLite clock read, inside the same transaction. The normal SQL predicate and
transition planner use that exact sample. Only the first two rows may be recovered.

## Negative controls

Run in a disposable copy using the same command as above. Each substitution is
independent. Restore the source between substitutions.

| Mutation in `src/internal/do-sqlite/Store.ts` | Expected rejecting assertion |
| --- | --- |
| Replace the `sync` Effect with `Effect.void` | Both held-sync cases return before the observer can release sync |
| Start `native.sync()` without waiting for its promise | Both held-sync cases construct an acknowledgment before release |
| In `transact`, replace `native.transactionSync(() => { … })` with `(() => { … })()`, keeping the identical callback, sentinel, and error mapping | Both recovery cases (SQL ABORT and zero-row UPDATE) preserve the expected port result and fail on `first update leaked from failed batch` |
| Replace `leaseExpiresAt <= ?` with `leaseExpiresAt < ?` | The −1 ms row recovers and the exact-equality row fails its recovery assertion |
| Populate `payloadBytes` from `row.projection` | The concurrent-claim artifact differs from the seeded payload |
| Remove `leaseExpiresAt <= ?` from recovery eligibility (use `? > 0` to retain the binding) | Recovery while a lease is still valid fails the expected zero |
| Bypass the finalize request ownership and before checks and plan with the row’s current ownership | An old request incorrectly finalizes the fresh claim |
| In finalization reconciliation, return `Applied` whenever the durable receipt exists and equals the query, before checking the observed transition | The exact request fails to reject the altered persisted version |
| Return the inspector's `Applied` without checking the receipt against the original command | The wrong before snapshot or equivalent terminal command falsely reconciles |

## Scope

This gate covers object-local persistence and lifecycle behavior on the pinned local
runtime. It uses synthetic acknowledgments and a graceful Miniflare restart. Hosted
durability, caller network failure, process-crash durability, automatic alarms,
handler dispatch and side effects, cross-object transactions, production schema and
cleanup are outside this qualification.
