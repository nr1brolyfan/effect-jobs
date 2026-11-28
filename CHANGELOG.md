# Changelog

## 0.1.0-alpha.6 (unpublished candidate)

- Add opt-in PostgreSQL worker finalization and lease-recovery history with an
  additive [migration and retention API](./specs/postgresql-attempt-history.md).

- Refresh the npm README with a Bun quick start, typed order jobs, and links to
  the PostgreSQL and Durable Object examples.
- Clarify that an operation with one slot still uses `JobProducer`.

## 0.1.0-alpha.5

- Expose `effect-jobs/DurableObjectSqlite` for atomic domain writes and enqueue
  inside one SQLite-backed Cloudflare Durable Object.
- Add a packed Worker example that checks commit, rollback and an explicit
  bounded drain. Applications own scheduling and reconciliation receipts.
- Retain Effect `4.1.3` and the exact optional Drizzle peer
  `1.0.0-rc.6-effect-jobs.1`.

## 0.1.0-alpha.4

- Require Effect `4.1.3`. Use the exact optional Drizzle peer
  `1.0.0-rc.6-effect-jobs.1` for integrations that use Drizzle. Install it from
  the immutable tarball in the [Drizzle compatibility guide](./specs/drizzle-compatibility.md) while
  [Drizzle #6728](https://github.com/drizzle-team/drizzle-orm/issues/6728) is open.
- Qualify optional-peer isolation and the installed Drizzle graph independently,
  with a blocking full declaration audit on TypeScript `7.0.2`.
- Retain the playground's `@effect/sql-pg@4.1.3` driver.

## 0.1.0-alpha.3 (previous local candidate)

Breaking prerelease changes since the published alpha.2 package:

- Require exact Effect/sql-pg `4.1.0` and optional Drizzle `1.0.0-rc.5`, replacing
  Effect/sql-pg `4.0.5` and the two hash-suffixed Drizzle snapshots. Node `24.15.0`
  and Bun `1.4.2` remain pinned; the local Alchemy example uses `2.0.0-beta.85`.
- Evaluate lazy `Job.make`, `JobProducer.make`, `JobPolicy.make` and
  `JobPayload.encrypted` setup in their typed Effect channels. Reuse one
  application-owned definitions Layer; do not hide setup in synchronous runners.
- Move routing and default policy from jobs into immutable producer slot bindings:
  `JobProducer.make(operation).pipe(JobProducer.withSlot(slot, job, { queue }))`.
  Enqueue now takes one object containing `slot`, `operationId` and `payload`.
  Fixed bindings forbid an enqueue queue; selectable `{ queues: [...] }` bindings
  require a declared queue-name string. Job-level enqueue and producer `identity`
  are removed. See [the API migration contract](./specs/api-refinements.md).
- Replace `JobRegistry`, `JobConsumer`, `JobWorkerRuntime` and `PollingJobWorker`
  public entrypoints with `JobGroup`, `JobApi`, `JobStorage`,
  `JobSchedule` and `JobPolling`. Declare complete catalog handlers and compose
  the shared worker/storage graph explicitly; old imports are not aliases.
- Yield `JobQueue.make`, `JobGroup.make` and catalog composition with
  `JobApi.make(...).pipe(JobApi.addGroup(...))` in setup. Install complete
  handlers with `JobGroup.handlers(group, build)` and reuse those group instances
  in worker catalogs. `JobApi.pick(catalog, ["group"])` selects an existing group
  through the same typed setup channel.
- Rename the public `JobIdentity.CatalogIdentity` type and Schema to
  `JobIdentity.JobAddress`. Existing values and deduplication are unchanged.
- Declare each producer slot with a single known name, a concrete payload
  contract, and a fixed route or a tuple of concrete selectable queues. Enqueue
  may still choose among the declared slots and queue names.
- Configure retries through `JobRetryPolicy` and `yield* JobPolicy.make({ retry })`.
  Replace `retryDelay`/`maxAttempts` options with `fixed`/`exponential`, optional
  cap/jitter, and `maxFinalizedAttempts`. Public counters use `finalizedAttempts`;
  stored `maxAttempts`/`attempts_made` keys are retained. Upgrade every reader
  before producing `BackoffV1`/`ProportionalV1` jobs; old readers cannot process
  them safely. Existing `FixedDelayV1` policies keep their semantics.
- Pass `DateTime.Utc` for producer `availableAt` and handler `retryBefore`.
  Validate dynamic epoch milliseconds with `JobPolicy.EpochMillis` before
  constructing the instant. Omitting `availableAt` uses database time at first
  insert. Omitting `retryBefore` leaves no additional retry cutoff.
- Pass Effect `Duration` values to `JobPolling.layer` as `idlePoll` and
  `shutdownGrace`, replacing `idlePollMillis` and `shutdownGraceMillis`.
  Replace `recoveryRetryIntervalMillis: n` with
  `recoveryRetryInterval: Duration.millis(n)`. Omitting it uses
  `Duration.seconds(30)`.
  Storage constructors take `operationResponseBudget` and the native
  PostgreSQL adapter takes `operationTimeout`. Use `Duration.millis(oldValue)`
  for existing constants. Resolved storage budgets and persisted time fields
  remain in milliseconds.
- Call `JobFailures.OutcomeUnknown()` with no arguments. Keep any diagnostics
  associated with a lost response in application code.
- Use `JobRetryPolicy.none` to allow one finalized attempt with no scheduled
  retry. Expired-lease recovery still follows `maxStalledCount`.
- Adapt encrypted codecs to the lazy Schema-native transformation, with explicit
  independent seal/open services. Already-protected envelopes remain supported.
  The application still owns encryption, keys and stable keyed fingerprints.

Also included: read-only bounded scheduling, nullable creation metadata and its
application-owned `creationTimeMigration`, focused PostgreSQL implementation
subpaths behind the unchanged public PostgreSQL export names, and bounded
observability with application-owned exporters. Review schema readiness and
apply required migrations before starting readers; runtime never migrates or
resets an installation. See [retry rollout](./specs/retry-policy.md) and the
[PostgreSQL contract](./specs/postgresql-jobs.md).

This entry describes prepared source, not publication or a fresh qualification
PASS. The release handoff binds actual commands, exceptions and cleanup to one
immutable archive. Completed retention remains 90 days. Website/playground source
is excluded from npm; no deployment or production guarantee is implied.

## 0.1.0-alpha.2 (published)

Breaking prerelease changes since alpha.1:

- Rename public `Job.make({ kind })` to `{ name }`, definition/catalog and handler
  context access from `.kind` to `.name`, and `JobIdentity.JobKind` to
  `JobIdentity.JobName`. The public Drizzle jobs-column property also becomes
  `.name`, including `extraIndexes` callbacks. Keep existing name values and
  catalog versions: the physical PostgreSQL column is still `kind`, so this
  rename alone needs no column rename, data rewrite/reset or migration. See
  [the API migration contract](./specs/api-refinements.md).
- Require exact Effect `4.0.5`; the qualified native PostgreSQL companion is
  `@effect/sql-pg@4.0.5`. Optional Drizzle peers are the exact snapshots
  `1.0.0-rc.5-ab785fc` and `1.0.0-rc.5-169397b`.
- Bind producer slots to definitions with inferred enqueue inputs and explicit
  application-owned transaction/service composition.
- Extend the PostgreSQL schema/readiness contract for Cancelled jobs, guarded
  operators, corrected redrive and durable repair lineage. Applications own
  migration review and execution; runtime does not migrate old installations.

Also included:

- Focused `JobOperators` support for guarded retry acceleration, cancellation and
  redrive; corrected redrive creates a new job and preserves source evidence.
- Current Astro documentation, runnable application examples and the local
  playground. The npm package excludes the website/playground implementation.
- PostgreSQL Node/Bun CI, real-process crash/recovery tests, and a bounded manual
  soak harness. These are scoped synthetic qualification, not production or
  exactly-once guarantees.

Completed retention remains 90 days by default. Upstream Drizzle full-declaration
checks retain their documented known-failure exceptions; successful own-code
checks do not mean upstream full strict PASS. The registry contains this release
with Effect `4.0.5` and the two Drizzle snapshots; current source is not identical
to those published bytes. Deployment is not established by registry publication.

## 0.1.0-alpha.1-effect.4.0.5.local.2 (local only)

- Qualify exact Drizzle snapshots `1.0.0-rc.5-ab785fc` and `1.0.0-rc.5-169397b`
  with Effect/sql-pg 4.0.5; use `ab785fc` for the Alchemy beta.83 peer graph.
- Preserve native PgClient transaction ownership and production runtime bytes.
- Keep the narrowly approved seven upstream declaration diagnostics as separate
  C FAIL; require independent A+B source and negative controls for both snapshots.

## 0.1.0-alpha.1

Breaking prerelease API changes since alpha.0:

- Resolve ambient `enqueue` through `JobEnqueue` on the same active PgClient;
  use `enqueueStandalone` for an explicitly owned transaction.
- Use immutable `JobPolicy.defaultPolicy` and validated typed `FailureCode` catalogs.
- Bind `JobPayload.encrypted` to a domain Schema and application key service.
- Default job version to 1 and infer the standard encoder; add optional Drizzle
  `extraIndexes` without changing the required baseline.
- Preserve mixed codec Causes and qualify the revised README against the exact
  package, pinned Alchemy declarations, Node/Bun and native PostgreSQL fixtures.

Cloudflare external PostgreSQL and deployment remain NotTested. This changelog
describes the release candidate; registry publication is a separate owner action.

## 0.1.0-alpha.0

Initial alpha extraction of the Effect-native durable jobs mechanism from
MIT-licensed effect-auth, with application-owned domains and infrastructure.

- Schema-defined catalogs, typed producer slots and library-generated job IDs.
- Transaction-bound production and immutable semantic duplicate comparison.
- PostgreSQL two-table storage, fixed leases, fencing, retry and bounded recovery.
- Explicit scoped workers, bounded cleanup and protected-payload projection.
- Focused ESM exports and optional effect-native Drizzle migration declarations.

This is an alpha, not a production qualification claim. Exact versions and
unsupported cases are listed in README and the release qualification document.
No registry publication or cryptographic build provenance is claimed by this file.
