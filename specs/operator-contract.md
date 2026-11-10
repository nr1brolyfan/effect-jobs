# Manual job operator contract

`JobOperators` is a focused generic port. `JobOperatorsService<E, R>` preserves
provider errors and required services; `redrive` additionally requires the payload
Schema decoding services; `correctedRedrive` requires encoding and decoding services. The Context service uses the existing generic
`JobBackendError` vocabulary; backend methods retain typed PostgreSQL errors.
The public package export and PostgreSqlJobs composition are registered by the
central integration owner.

Every operation requires an active transaction of the configured qualified
application adapter. Missing, foreign or inactive context fails before artifact
decoding or writes. Operators never acquire a pool, begin/commit a transaction,
run migrations, execute a handler, or replay a mutation. Results are provisional
until the outer application commits. The application owns authorization,
current generation and expiry, scoped associations, duplicate-effects confirmation,
admission, receipts and audit. Core persists immediate-source lineage atomically with each successor. Unknown commit outcomes require
lookup of the original application receipt; receipt absence does not grant replay.

| Source                             | retryNow             | cancel    | redrive         |
| ---------------------------------- | -------------------- | --------- | --------------- |
| Pending                            | refused              | Cancelled | refused         |
| future RetryScheduled              | availableAt = DB-now | Cancelled | refused         |
| due RetryScheduled                 | already-due          | Cancelled | refused         |
| Active                             | refused              | refused   | refused         |
| Completed / Cancelled              | refused              | refused   | refused         |
| Dead / valid investigated Isolated | refused              | refused   | new Pending job |

All actions lock the source and validate complete snapshot and exact expected
job/state/version. Retry and cancellation use a final CAS with null ownership
and safe version increment. DB time is sampled after lock waits and validation.
Accepted transitions expose it as `after.updatedAt`; redrive exposes `dbNow`.
The application must revalidate expiry after waiting/decoding and before commit,
rolling back the entire operator/receipt transaction when authority expires.

Retry strictly accelerates a future stored retry, preserving policy, attempts,
stalls, failure and artifacts. A previously scheduled availability below
`Retry.notAfter` remains below that scheduling cutoff under strict acceleration.
Already-due retries are refused, preventing postponement.

Cancellation preserves availability, counters, failure and artifacts, increments
version once, and records a terminal timestamp. Cancelled retention is Forever:
cleanup_at is null; claims, recovery and cleanup exclude it. Active cancellation
is unavailable because no handler interruption contract exists. Cancelling future
execution cannot undo an earlier external effect.

Redrive validates the supported catalog, complete stored policy/metadata,
configured lease response reserve, canonical payload/projection and corresponding
payload Schema without invoking a handler. Buffers are copied before asynchronous
decoding. It copies exact valid artifacts and first policy into a library-assigned
new ID, with fresh zero counters/version and DB-now initial availability. The
original is unchanged. The original producer tuple is refused. A new producer
tuple uses the existing global deduplication/integrity mechanism: matching catalog
and semantic projection return AlreadyPresent, conflicting semantics poison the
transaction. Both forms compare durable source identity and redrive kind before accepting a
matching tuple. Absent, inconsistent or different lineage causes the typed
`lineage-conflict` rejection and poisons the transaction even if caught. Changed
payload/catalog still produces `JobIntegrityConflict`. Ordinary enqueue does not
acquire an operator edge or claim an existing operator successor.

`correctedRedrive(definition, { expected, producer, payload })` accepts a full decoded
replacement, encodes it with `encodeJobPayload`, then validates its canonical
artifact/projection and decodes it using the exact source catalog. A missing or
invalid old payload may be replaced; complete source lifecycle, policy, producer,
initial availability and lineage must still be valid. Plain redrive continues to
validate and copy the original encoded bytes. Neither form changes source rows,
policy or catalog version. No reasons, app resolution or receipt service enter core.

`JobRedriveResult` includes `lineage: JobLineage`: durable `originalSourceJobId`,
nullable live `sourceJobId`, and kind `Redrive` or `CorrectedRedrive`. This is an
immediate edge, not an inferred chain root. Result lineage is provisional creation
evidence; current detail reads must use the stored nullable reference.

The library does not repair lifecycle/policy metadata, reset a terminal job's budget,
prove missing external effects or validate app-specific subject/tenant authority.
Every redrive requires explicit application duplicate-effects confirmation. A
fresh confirmed request may deliberately produce a different successor.

`PostgreSqlSchema.migration` and optional Drizzle declarations admit Cancelled
and require its terminal timestamp. `operatorMigration(mapping)` obtains an
exclusive table lock, identifies exactly the known legacy/current state and
terminal-timestamp CHECK expressions, and replaces only those two constraints.
Unexpected or ambiguous constraints cause failure; all rows, indexes and
unrelated constraints remain intact. SQL-generated and Drizzle-named CHECKs are
supported. The application owns running the migration in its migration transaction.
Readiness rejects the old six-state schema. Historical migration SQL/checksums
must be frozen before switching to the updated fresh generator.

Internal integration: `makeOperators(adapter, jobs, payloads,
operationResponseBudgetMillis)` uses the same adapter, quoted relations and
response reserve as the backend. `insertOrCompareAt` reuses the final operator
clock sample; ordinary enqueue continues sampling its own DB time.

`PostgreSqlSchema.lineageMigration(mapping)` is an additive, application-owned,
one-time migration for existing tables. It adds three nullable text fields with
no guessed backfill, four checks (presence, kind, distinct child ID, matching live
reference), a self FK `ON DELETE SET NULL` and a partial source index. The durable
original ID has no FK. Fresh SQL and Drizzle declarations use the same constraints,
custom table mapping and bounded names. Readiness checks nullable text columns,
constraint expressions, the actual mapped SET NULL target and the partial index;
it rejects unmigrated storage and never runs DDL. Source deletion removes only
that source's payload and nulls successors' live references, retaining their jobs,
payloads and original identities. Application associations still own scoped
reference validation, audit and domain retention. Freeze historical migration
bytes/checksums before using changed fresh DDL in a registry.
