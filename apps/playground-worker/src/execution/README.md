# Bounded PostgreSQL executor

The shared registrar composes `Application.layerNoDeps(schema)` with the SAME
application-owned `PgClient@4.0.0`/`SqlClient`, `PostgreSqlNative` adapter and
`PostgreSqlJobs` backend (response budget 500 ms). The caller supplies stable
`DocumentKeys`, `WakeAlarm` and an internal `ExecutionHints` adapter. Imports do
not start workers, pools or migrations. The application owns one scoped client
per serialized Durable Object event; await `Executor.run(schema, queue)` before
closing that Scope. Do not retain transaction contexts or detach fibers.

There are four fixed DO/consumer identities, `Executor.queueNames`: communications,
media, commerce and private. Sandbox/job cardinality creates no new queue/DO.
Each event starts at most 10 claims with local concurrency 2 and considers at
most 10 recovery rows. The library recovery API is global, so recovery can touch
expired leases from another queue; all lifecycle writes remain library-owned.
Native alarm set/delete are hints. Prearming protects a bounded repair opportunity
on failure/interruption. A 5-second cycle deadline preserves the failure Cause;
it never proves rollback or cancels durable jobs. Background polling is absent.

`SandboxAuthority.issue` generates 32 random credential bytes and stores only a
SHA-256 verifier. Authentication checks PG time and returns current generation.
Only an authorized `describe` renews a 15-second viewer activation, bounded by
the original one-hour expiry; the integration HTTP boundary must call it on
viewer heartbeat/resumed viewing and kick ALL four existing queue DOs. It must
deliver the credential in the foundation's Secure/HttpOnly/SameSite=Strict
`__Host-` cookie and enforce origin, CSRF, request and deployment rate limits.
Those HTTP registrars belong to the integration owner, not this slice.

A global fixed queue remains awake while any sandbox has a valid viewer
activation. When no activation remains, each queue event clears its alarm without
claiming. Already admitted work from an unattended sandbox can complete while
another viewer keeps the shared queue active; no per-sandbox pause/cancel API is
invented. Reset/expiry still fence every synthetic provider write. The provider
locks the same sandbox row as reset, obtains fresh DB time AFTER the lock and
binds the producer tuple to the actual sandbox/generation/job association.
A reset that wins the lock prevents the late write; a provider commit that wins
happened in the old generation. Old observations never move into the new one.

Only communications generates: at most one synthetic job per event from one
due active sandbox, with a deterministic server request ID and 5-second cadence.
Job/association/audit/receipt and retained quota changes join one native producer
transaction. A separate first-admission journal is durable before that transaction;
an admitted request with no receipt stays OutcomeUnknown and cannot replay writes.
Control/query uncertainty remains Unknown; mixed Causes, defects and interrupts
are preserved internally. Commands reject an ambient transaction instead of
claiming Committed while an outer transaction can still roll back.

The durable provider ledger commits invocation/acceptance before returning the
synthetic Retry/Dead/Isolate/OutcomeUnknown failure. Matching concurrent replays
observe one accepted synthetic consequence; conflicting semantic projections are
isolated. There is no network, real payment/email or arbitrary outbound webhook.
`FakeProvider.inspect` returns no mock observation for durable storage; the read
adapter must project a separately typed local/workerd observation if desired.
The ledger is app evidence, never a library eventlog or attempt history.

Limits are 100 retained jobs and provider entries across ALL generations of one
sandbox, 200 admitted commands across all generations, 10 jobs per request and
one-hour expiry. Reset retains earlier jobs, associations, receipts and evidence;
it does not restore the quota. There is deliberately no cleanup adapter installed:
foreign keys protect evidence, and Pending/Active/Isolated rows are never deleted.
Terminal/domain-coordinated retention is a later explicit integration decision;
reset is visibility/admission revocation, not cancellation. `retryJob`, `redriveJob`
and `cancelJob` remain false.

## Shared integration requests

The serial foundation owner must:

- Reconcile `persistence/authority/Schema.proposal(schema)` with the read schema
  proposal instead of registering both (same `sandboxes`/`associations` names).
  `associations.relations` contains only `syntheticActor` and `syntheticOrderId`.
- Register six real scenario handlers via the Application composition, four
  fixed queue DOs, the scoped native PG backend and finite alarm adapters.
- Bind `CommandPersistence` through the existing guarded website commands,
  connect authority issuance/authentication, viewer renewal and queue activation.
- Supply one stable application-owned synthetic document key layer; per-event
  key generation would make retained encrypted jobs unreadable. Do not enable
  the ephemeral scenario fixture keys as a hosted default.
- Add runtime-only `@effect/sql-pg:4.0.0` and qualification scripts/pins to the
  private app manifest/lock as needed, without changing library dependencies.
- Connect `ExecutionHints.reconcile` to bounded internal invalidation. Missed
  hints/internal library transitions still require authoritative periodic reads.

Hosted runtime, actual scheduled alarm callbacks, Alchemy callback composition,
crash/network/CPU behavior and integrated browser preview remain NotTested here.
The qualification harness uses Miniflare/workerd + genuine PostgreSQL, not mocks.
