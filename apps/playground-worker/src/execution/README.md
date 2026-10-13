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

Only communications generates: at most one mixed synthetic job per event from one
due active private sandbox, with a deterministic server request ID and 5-second cadence.
Internal generation locks the sandbox and commits its schedule, job, association,
admission, audit, receipt and retained quota together in one native transaction.
Manual commands retain their separate durable first-admission journal; an admitted
manual request with no receipt stays OutcomeUnknown and cannot replay writes.
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

Private `/jobs` is for local testing. Explicit trusted `LOCAL_PRIVATE="true"`
configuration supplies `LocalPrivate` through `Event.run`; requests, Host and
Origin headers cannot enable it. Local sandboxes have no retained-job, provider
identity or command-admission lifetime quota. Counters remain safe integer numbers:
v5 widens retained_jobs to bigint with a 0..Number.MAX_SAFE_INTEGER check. Queries
avoid PostgreSQL int count casts and reservations refuse representation overflow.
The default bounded mode retains 100 jobs/identities and 200 admissions.
Ten jobs per request, one-hour expiry, viewer activation, HTTP rate limits, finite
worker claims/recovery and paced arrivals remain enforced in either mode.
Reset preserves the same ID, advances generation once and seeds six real jobs;
old jobs, associations, admissions, receipts, audit and provider evidence remain.
There is no cleanup adapter or automatic redrive replenishment. `retryJob`,
`redriveJob` and `cancelJob` retain their accepted private operator eligibility.
Public demo keeps its separate 20,000-job bound, rotation and retention behavior.

Future hosting remains a separate task: host public read-only `/demo` alongside
docs, and exclude private sandbox/mutation routes server-side. Hiding navigation
is insufficient. This local change does not implement or authorize hosting.

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

## Actionable private traffic

Private authority issuance now enqueues six real starter jobs inside its native
transaction. Authorized describe can initialize an unseeded existing generation
once, serialized by the sandbox row lock and the `PrivateTraffic/starter-v1`
receipt. Reset enqueues the same bounded set in the generation-advance transaction.
All retained jobs, associations, receipts and provider evidence remain untouched.
Starter enqueue, quota, admission, receipt and audit are atomic. An internal
producer namespace separates generated consequences from manual request IDs.

Private arrivals rotate through success, delayed success, retry, terminal failure,
valid isolation and deduplication. Initial Pending availability and fixed retry
waits are 120 seconds, leaving time for cancel/retry-now. The existing synthetic
provider and worker produce every lifecycle transition; no lifecycle SQL seed is
used. Dead/Isolated successors retain their source behavior, so redrive can fail
again. Nothing automatically redrives or replenishes terminal sources. Manual
`delayed-success` and `isolated` controls expose the same repeatable cases.
Public demo scheduling, policies and read-only authority remain independent.

Capacity metadata identifies `local` or `bounded` mode and reports retained jobs
and admissions across generations. The local UI explains that reset preserves
history and adds six starters; old counts never disable local scenario/reset
controls. Existing bounded-mode capacity checks remain visible and enforced.
`playground-local-private-v5` is an explicit additive app migration; v1–v4 bytes
and checksums remain unchanged, and demo-owned rows keep their existing bound.
Apply it before running the new executor. The preview launcher explicitly enables
local mode and creates its own fresh resources; it does not reuse prior configs.

Finite local qualification: build with
`PLAYGROUND_EVIDENCE_DIRECTORY=.multica/actionable node apps/playground-worker/tests/integration/Build.mjs`,
bundle `ActionableProbe.ts` to that directory (external Effect/library imports),
then run `python3 apps/playground-worker/tests/integration/ActionableRunOwned.py`.
The runner owns a fresh loopback PG16.15 tmpfs container, private random credentials,
workerd and Chromium; it removes its exact container/config and process group.
It never reads an existing private config or touches a running preview.
