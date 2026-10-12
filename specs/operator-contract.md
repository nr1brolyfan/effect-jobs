# Manual job operator contract

`JobOperators` is a focused generic port. `JobOperatorsService<E, R>` preserves
provider errors and required services; `redrive` additionally requires the payload
Schema decoding services. The Context service uses the existing generic
`JobBackendError` vocabulary; backend methods retain typed PostgreSQL errors.
The public package export and PostgreSqlJobs composition are registered by the
central integration owner.

Every operation requires an active transaction of the configured qualified
application adapter. Missing, foreign or inactive context fails before artifact
decoding or writes. Operators never acquire a pool, begin/commit a transaction,
run migrations, execute a handler, or replay a mutation. Results are provisional
until the outer application commits. The application owns authorization,
current generation and expiry, scoped associations, duplicate-effects confirmation,
admission, receipts, audit and redrive lineage. Unknown commit outcomes require
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
transaction. The application MUST validate matching lineage before accepting an
AlreadyPresent result; it cannot assume the tuple proves source identity.

The library does not repair corrupted artifacts, reset a terminal job's budget,
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
