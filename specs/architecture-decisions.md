# Architecture decisions

D1–D8 are accepted. This document is the canonical extraction contract, including
later refinements recorded within the decisions. Earlier Multica proposals and
auth specifications are historical reference where they conflict with it.
Statements about downstream gates describe dependencies, not unaccepted choices
now that all eight decisions are recorded. Exact API spellings and supported
adapter coverage still need specification and qualification.

Decision acceptance alone did not dispatch implementation. The owner subsequently
authorized continuing the extraction and committing these decisions. Execution
must still follow task dependencies, isolated ownership, and the agreed review
workflow; this does not authorize push, publication, database resets, or changes
to unrelated auth work.

## D1 — focused initial scope and package boundary

Status: accepted by the owner on 2026-10-04. Tracked in Multica as UPVE-849.

### Decision

Choose variant A: extract and generalize the existing durable jobs substrate
before adding new queue features. The first release is an alpha, not a claim of
production qualification.

Ship one npm package, `effect-jobs`, with focused public subpaths. Keep the core
independent of PostgreSQL and Drizzle imports; isolate PostgreSQL persistence
behind a backend subpath with optional backend peers. Do not split core, worker,
and PostgreSQL into separate npm packages for the initial release.

The catalog supports application-defined jobs from the outset. This does not
require effect-auth to expose its own catalog to arbitrary application jobs.

### Initial scope

- Schema-defined, versioned jobs (omitted version means 1) and logical queues.
- Application-defined catalogs and handler installation.
- Atomic enqueue within an application-owned transaction.
- Semantic deduplication and the existing durable lifecycle guarantees.
- Fixed leases, ownership fencing, and bounded unknown-outcome reconciliation.
- Persisted retries, bounded recovery, and retention.
- PostgreSQL persistence with application-owned migrations.
- Bounded worker drain and explicit scoped Node/Bun polling.

Imports must not start workers. Applications explicitly compose persistence,
handler, and runtime Layers. Core imports must work without backend peers.

### Ownership boundary

`effect-jobs` owns the generic durable execution mechanism and never depends on
`effect-auth`. `effect-auth` retains domain schemas, job definitions, handlers,
authority, providers, producer transactions, and domain receipt/retention rules.
There is one durable lifecycle and authority, not a second auth-specific runtime
or a dual-write migration.

### Deferred features

Additional backends, recurring schedules,
dashboards, flows, pause/resume/cancel/redrive APIs, and a ready-made Cloudflare
coordinator are outside the first release. Bounded drain alone is not a
Cloudflare support claim.

### Proposed module shape

The following illustrates the accepted packaging direction, not implemented
exports or finalized symbol names:

```ts
import { Job } from "effect-jobs/Job"
import { JobQueue } from "effect-jobs/JobQueue"
import * as JobWorker from "effect-jobs/JobWorker"
import * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
```

### Rationale and downstream gates

A focused extraction limits simultaneous protocol changes and preserves the
existing transaction-bound producer guarantees. A single package avoids
premature release/version coordination while subpaths isolate backend loading.

D1 approves scope and ownership, not the illustrative method signatures from
the discussion. Envelope and handler inputs, IDs/deduplication, failure policy,
payload protection, transaction bridge/driver, physical storage compatibility,
and retention contracts remain gated by D2–D8. Baseline and regression
qualification tasks remain required. Acceptance does not dispatch agents or
authorize implementation, merge, push, or publication.

## D2 — domain payload, envelope, and handler input

Status: accepted by the owner on 2026-10-04 after clarification of the existing
auth API. Tracked in Multica as UPVE-851.

Choose variant B: a definition's payload Schema describes domain data only.
The library owns the standard envelope Schema, separate from mutable lifecycle
state. Enqueue resolves the configured producer service within an active same-client transaction and accepts input containing producer
identity, policy, optional initial availability, and decoded domain payload. D3 refines
the original job-ID example: the library assigns the job ID rather than requiring
the caller to preserve it across production retries.

Handlers receive `{ payload, context }`. The proposed minimal context exposes
job ID, catalog identity (queue/kind/version), producer identity, and current
attempt number. Exact field names and attempt counting semantics must be
specified before implementation. It does not expose a database client, lease
token, or ack/retry/complete capabilities; the worker owns lifecycle transitions.
Handler service dependencies remain ordinary Effect/Layer requirements, not an
ambient execution-context service.

Auth subject/actor/event fields remain domain-owned rather than mandatory
generic envelope fields. Auth retains any necessary cross-field validation when
adapting its definitions. The existing auth `Job.make` payload option points to
a full claimed-job Schema; that is an API modeling fact, not a claim that every
envelope field is physically stored in a payload blob.

Producers use decoded Schema types; durable encoding is bounded and workers
validate persisted artifacts before handlers receive decoded payloads. Required
encoding/decoding services must remain explicit in types and Layer composition.
Protected payload behavior remains gated by D5. The suggested existing 64 KiB
payload/projection limits are a starting point, not separately finalized here.

This separation makes the generic API clearer without changing transaction
atomicity or allowing handlers to own finalization. D3 still determines IDs and
deduplication; D4 determines failure outcomes; D6 determines the transaction
bridge. No runtime exports or implementation are introduced by this decision.

## D3 — producer identity, IDs, and semantic deduplication

Status: accepted by the owner on 2026-10-04. Tracked in Multica as UPVE-852.

### Producer identity and declaration

Deduplicate by the required tuple `(operation, operationId, slot)` within one
configured jobs storage, not separately per job kind or version. `operation`
names the business operation, `operationId` identifies its particular instance,
and `slot` identifies one consequence. Multiple slots may produce the same job
kind. Applications should namespace operation names.

Declare a producer once in an application-owned domain module and import it from
all callers. The accepted API direction is:

```ts
export const IssueInvoiceProducer = JobProducer.make({
  operation: "billing.issue-invoice",
  slots: ["generate-pdf", "send-email"]
})

const producer = IssueInvoiceProducer.identity({
  operationId,
  slot: "generate-pdf"
})
```

The factory is immutable configuration, not a service or running producer.
`operation` retains its literal type; `slot` is inferred as the union of declared
literals. `operationId` is a bounded opaque string; application-branded strings
are accepted without requiring an additional library brand. Validate external
values at boundaries.

The owner subsequently accepted these identifier boundaries and diagnostics:

- `operationId` is 1–256 UTF-8 bytes, contains valid Unicode scalar values and
  no NUL, and is compared exactly without trimming, case folding or normalization.
- `operation` and each `slot` are 1–128 ASCII characters matching
  `^[a-z][a-z0-9.-]*$`. The simple regular expression is accepted.
- Invalid declaration names fail immediately when creating the producer, not
  later during enqueue. Ordinary TypeScript string types do not validate this
  grammar; inferred slot unions still reject undeclared slots statically.
- Configuration errors identify the exact field (including a slot index), the
  invalid declaration name, and the expected length/format so callers can fix it.
  Invalid operation IDs report the violated rule and, for length violations, the
  actual UTF-8 byte length without echoing the potentially sensitive value.
- Tests must cover these boundaries and actionable diagnostics. These accepted
  rules do not claim that runtime validation has already been implemented.

Start with `identity({ operationId, slot })`; fluent `forOperation(...).slot(...)`
is not required for the initial implementation. Do not introduce a mutable
builder or global registry to detect semantically similar names. Where multiple
callers share the same production logic, use an ordinary application-domain
function to bind producer slot, job definition, and input construction. Such
wrappers are not mandatory for every enqueue.

### Job IDs and enqueue results

The library assigns a unique opaque branded `JobId` on first production. The
caller is not required to supply or preserve a job ID. A matching duplicate
returns the existing ID:

```ts
type EnqueueResult =
  | { readonly _tag: "Inserted"; readonly jobId: JobId }
  | { readonly _tag: "AlreadyPresent"; readonly jobId: JobId }
```

This supersedes the earlier proposal requiring stable caller-supplied job IDs
and rejecting production retries solely because a newly generated ID differs.
An explicit caller-ID override is not approved by this decision. There is no
mandatory generic event ID; event IDs remain domain-owned.

### Equality and transaction guarantees

For the same producer identity, compare catalog identity and domain payload
semantics, including protected-field fingerprints. Changed catalog identity or
content produces a typed integrity error. The library-generated job ID is not a
new candidate input to compare. There is no payload overwrite, debounce, or
last-write-wins behavior.

Exclude mutable lifecycle state, counters, leases, rescheduled availability,
and encryption randomness/raw ciphertext from semantic equality. Protected-field
equality remains subject to D5.

The owner subsequently refined D3: policy and initial availability are immutable
after creation but are not part of duplicate semantic equality. For a matching
duplicate, retain the first stored policy and availability, even if the caller
supplies different values on a production retry. This is first-write-wins for
execution configuration only, not for payload content. Changed deployment
defaults must not mutate existing jobs or turn otherwise matching retries into
integrity conflicts.

`availableAt` is optional. If omitted on first insertion, the backend assigns it
using database time. A matching duplicate never resets it to a new current time.
A supplied past timestamp is valid and makes the job immediately eligible;
a future timestamp postpones eligibility, not guarantees execution at that time.
Availability is not a domain expiration deadline.

Policy is validated when creating the job and persisted durably. Re-enqueue is
not an API for rescheduling or changing policy. Such an operation would need a
separate contract, outside the current initial scope. A new producer identity
denotes a new consequence, not an update of the old job. This refinement
supersedes earlier discussion requiring callers to retain identical scheduling
timestamps and policy across production retries.

Storage uniqueness and conflict handling must enforce this behavior under
concurrent enqueue, not merely a pre-insert lookup. Enqueue remains inside the
application-owned transaction; integrity conflicts must not be swallowed to
commit the remaining domain writes. Results are provisional until commit.

### Application responsibilities and limits

Applications supply a stable operation ID across retries, for example an
idempotency key or durable operation/event ID. A new operation ID denotes a new
operation even if payload or job kind matches. Sharing producer declarations
across endpoints does not deduplicate requests with different operation IDs.

Retrying execution or recovering an existing job preserves its job ID; that is
distinct from retrying the business operation that produces a job. Deduplication
lasts only while durable identity evidence is retained; D8 determines retention.
It does not imply exactly-once external handler effects.

Auth should adapt its existing operation/consequence tuple through a shared
domain declaration. Its former job/event ID binding requires explicit adaptation
and must not be blindly copied. Exact storage representation is gated by D7.
This decision records a contract, not implementation or dispatch authorization.

## D4 — handler error adapter and execution outcomes

Status: accepted by the owner on 2026-10-04, including the clarified
`OutcomeUnknown` name and separation from durable lifecycle status. Tracked in
Multica as UPVE-854.

Choose ordinary Effect composition in the handler adapter rather than a separate
`classifyError` callback in handler configuration. Domain services retain their
domain errors. The application-owned adapter maps those errors into explicit job
failures, for example using `Effect.mapError` and exhaustive matching, before
installing the handler through `handlerLayer(execute)`.

Both proposed variants can preserve exhaustive typing, shared mapping, and
domain independence. Variant A avoids an extra library classification mechanism
and stays closer to the existing implementation. Mapping must not require
domain services to depend on the queue library. Handler service requirements
remain ordinary Effect/Layer requirements; the worker still owns durable
transitions.

### Outcome semantics

- Success: the worker attempts fenced completion.
- `Retry`: request a persisted retry according to policy and within its limits.
- `Dead`: a known terminal failure without another retry.
- `Isolate`: an invalid artifact or violated invariant requiring investigation,
  rather than an ordinary business rejection.
- `OutcomeUnknown`: the operation may have executed, but its outcome cannot be
  confirmed. This supersedes the proposed name `Unresolved`.

`OutcomeUnknown` is an attempt outcome, not a new durable lifecycle status.
Absent confirmed finalization, the row remains Active pending reconciliation or
fenced lease expiry/recovery. Recovery can invoke the handler again, so external
effects still need idempotency or domain reconciliation. Unknown does not mean
not executed and does not provide exactly-once execution.

For example, an explicit temporary provider rejection can be mapped to Retry;
a lost response after sending a request can be mapped to OutcomeUnknown.
Defects, interruptions, composite causes, and uncertain timeouts must not be
automatically interpreted as known-safe retries or successful completion.
An unknown finalization-write result requires storage reconciliation, not an
immediate rerun of the handler.

Only explicit bounded failure codes are persisted, not arbitrary error messages
or raw `Cause.pretty`. Preserve the existing persisted FixedDelayV1 retry and
bounded recovery protocol during extraction rather than adding exponential retry.
The owner subsequently accepted preserving the existing attempt-counting protocol:
`context.attemptNumber = attemptsMade + 1`. Claim/release do not increment
`attemptsMade`; a confirmed, fenced Complete/Retry/Dead/Isolate transition
increments it exactly once. An unknown outcome leaves it unchanged; recovery
uses a separate `stalledCount` and limit. Thus the exposed one-based attempt number
may repeat after an unknown outcome and recovery. It is neither an external
idempotency key nor a count of all handler invocations. `maxAttempts` bounds
finalized attempts, while `maxStalledCount` separately bounds uncertain recovery.
This accepts counter semantics, not unpresented exact time-boundary comparisons.

The owner subsequently accepted preserving these exact time boundaries:

- A job is due when `availableAt <= dbNow`.
- Fenced owned writes require `leaseExpiresAt > dbNow`; expiry recovery is
  eligible when `leaseExpiresAt <= dbNow`.
- `attemptTimeoutMillis < leaseDurationMillis` is required.
- A claim or reconciled lease is usable only with remaining lease time
  `>= attemptTimeoutMillis + operationResponseBudgetMillis`.
- A retry whose computed next availability is `>= notAfter` becomes Dead rather
  than being scheduled. `notAfter` limits retry scheduling, not handler execution
  or initial availability.
- Durable transitions use one database-time snapshot rather than process time.
  Tests must exercise equality and immediately neighboring values.

Exact constructor spellings and remaining boundary details must be specified,
and the accepted behavior must be qualified before implementation; no unbounded retry or
new lifecycle status is approved. Acceptance does not authorize dispatch.

### Accepted policy input refinement

The owner accepted `JobPolicy.make` with all configuration fields optional and
documented defaults, including retention. Public callers do not manually write
internal tagged retry/retention objects or use choice callbacks.

- Counters use integer numbers.
- Timeout, lease duration and fixed retry delay use finite Effect `Duration`
  values. Exact valid numeric ranges and execution defaults still need explicit
  specification and qualification; example values are not approved defaults.
- Completed and Dead retention accept finite Effect `Duration` values or
  `Duration.infinity`. Default Completed retention is 90 days; default Dead
  retention is infinite. Retention is measured from terminal completion, not an
  absolute timestamp. `availableAt` remains a separate enqueue input.
- The helper resolves a complete validated policy, including cross-field checks,
  and the backend persists those resolved values in its versioned internal
  representation. Updated defaults do not alter already stored jobs.
- Purging Completed jobs can remove deduplication evidence after the retention
  period. Infinite retention avoids automatic expiry but can grow storage.

Illustrative public input:

```ts
const policy = JobPolicy.make({
  maxAttempts: 3,
  retryDelay: Duration.seconds(5),
  completedRetention: Duration.days(90),
  deadRetention: Duration.infinity
})
```

`JobPolicy.make()` also resolves the documented defaults. This decision changes
the earlier proposal requiring explicit retention; it does not introduce
exponential retry, automatic Isolated cleanup, or unlimited Pending/Active cleanup.

The owner accepted these execution defaults (public names remain illustrative):

```ts
{
  leaseDuration: Duration.seconds(90),
  attemptTimeout: Duration.seconds(30),
  retryDelay: Duration.seconds(5),
  maxAttempts: 3,
  maxStalledCount: 1
}
```

The attempt limit includes the first finalized attempt, not three additional
retries. One stalled recovery is permitted by default; a subsequent recovery
exceeding the stored limit ends the job as Dead. Unknown outcomes can repeat an
attempt number and lead to additional handler invocations. An attempt timeout
does not prove that external effects did not occur.

The owner reaffirmed fixed-delay retry for this extraction. Exponential backoff
with jitter is recorded as a future strategy, not activated implementation scope.
Its multiplier, cap, jitter distribution and persisted/versioned representation
must be specified and qualified separately before adding it.

## D5 — explicit application-owned protection and codec boundaries

Status: accepted by the owner on 2026-10-04, including variant A, the separate-key
contract, deferred generic binding, and codec/equality direction. Tracked in
Multica as UPVE-856.

Choose explicit application-owned protection rather than automatic encryption
of Schema-marked subtrees. Producers call a protection service to seal sensitive
data before enqueue; handler adapters call it to open protected data. The
payload Schema describes the protected representation, not plaintext that the
queue would automatically encrypt.

Use `JobPayload.protected(...)` as the proposed honest marker name. The marker
identifies an already-protected envelope and keyed semantic fingerprint for the
codec; it does not encrypt, authenticate, or decrypt by itself. An arbitrary
plaintext value with a marker is not a valid substitute for the protected
representation. Domain services and protection adapters remain application-owned.

The queue core persists protected bytes and compares semantic fingerprints
without requiring key access. Application producers and handler adapters need
the protection service and its key configuration via ordinary Effect/Layer
composition. They may run in the same process as the queue; this is a dependency
and responsibility boundary, not a physical security isolation claim.

The owner subsequently selected protected representation option A: the
application defines the envelope and fingerprint Schemas. The protected marker
requires an own `fingerprint` field with a validated canonical JSON
representation; semantic equality uses that fingerprint and excludes the rest
of the marked subtree, including randomized ciphertext. The library does not
mandate a fixed encrypted-envelope format or a caller-supplied fingerprint
projection callback. The application remains responsible for sealing, opening
and cryptographic validation; the marker does not prove protection.

```ts
const Protected = JobPayload.protected(
  Schema.Struct({
    envelope: MyEncryptedEnvelope,
    fingerprint: MyFingerprint
  })
)
```

This API spelling is illustrative until implementation qualification. Existing
codec support and explicit unsupported-shape requirements below still apply.

Rationale: explicit encryption/decryption points, application control of keyring
or KMS, reusable protection services, and less new generic crypto machinery in
the focused extraction. The trade-off is additional producer/handler adapter
code; this choice is not inherently more secure than correctly implemented
automatic protection.

This refines D2: decoded domain payload does not mean automatically decrypted
plaintext. For protected fields, handlers receive the decoded protected envelope
and explicitly open it. The library must not silently persist plaintext under an
encryption marker. Existing auth protection is reference code, not a generic
implementation that can be copied unchanged.

Authenticated context binding (AAD) is deferred by explicit owner decision; it
is not a requirement of the generic library or its V1 protection API. Keep the
idea as a reference, not an implementation task. Codec boundaries are specified
below. The reproduced protected-subtree Union bug remains a required
regression fix. Automatic generic encryption is not required for the first
release. No implementation or agent dispatch is authorized by this choice.

### Deferred reference: authenticated context binding (AAD)

The owner found insufficient incremental value to justify introducing generic
context binding during extraction. Proposed scenarios included misassigned
ciphertexts during migrations and ciphertext substitution by a database writer
without key access. These were not accepted as sufficient motivation for added
library complexity. AAD does not protect against arbitrary database compromise
and is not a substitute for domain authority checks.

The following illustrates the deferred idea only, not an approved or existing
API. An application protection service could authenticate a canonical encoding
of context alongside ciphertext, using the same encryption key across jobs:

```ts
const example = Effect.gen(function* () {
  const protectedCode = yield* protection.seal({
    plaintext: otpCode,
    aad: { purpose: "otp-delivery", challengeId: "challenge-A" }
  })

  const code = yield* protection.open({
    protected: protectedCode,
    aad: { purpose: "otp-delivery", challengeId: "challenge-A" }
  }) // Matching context: succeeds.

  yield* protection.open({
    protected: protectedCode,
    aad: { purpose: "otp-delivery", challengeId: "challenge-B" }
  }) // Different expected context: authentication fails.
})
```

Any benefit requires the expected context to be independently trustworthy;
copying ciphertext and all its expected context together defeats that check.
Deferring generic AAD does not disable authenticated encryption or remove
existing auth protections. In particular, do not silently strip the existing
OTP binding or break decryption of existing artifacts; any such consumer change
needs its own explicit decision and compatibility qualification. No new generic
AAD binding is to be added as part of this extraction.

### Separate encryption and fingerprint keys

The owner accepted two independent application-managed secrets: one for
encryption and one for keyed semantic fingerprints. A fingerprint is not the
deduplication identity: the producer tuple locates a duplicate, and fingerprints
help detect changed protected content under that same identity without giving
the queue access to decryption keys.

The fingerprint key stays stable while retained jobs must be compared with new
production attempts. Routine encryption-key rotation must not change it. All
producers that need to compare within that storage/protection namespace use
compatible fingerprint configuration. Applications may provide secrets through
environment configuration or a secret manager; storage contains key identifiers
and fingerprints, never the secret keys. No particular environment variable names
or key-management implementation are mandated by this decision.

Preserve old decryption keys for as long as retained encrypted artifacts require
them. Changing a fingerprint key does not erase data, but without compatibility
handling the same plaintext yields a different fingerprint and can be rejected
as a semantic conflict instead of AlreadyPresent. Removing required encryption
keys can independently make old ciphertext unreadable.

Automatic fingerprint-key rotation with cross-key semantic comparison is not a
V1 requirement. Key compromise or deliberate fingerprint-key replacement needs
an explicit operational procedure; no transparent transition is promised.
Deriving purpose-separated keys from a single master secret is not inherently
unsafe, but it is not the selected V1 configuration because master rotation
couples the two key lifecycles. Auth's existing envelope/keyring implementation
still requires adaptation and qualification rather than an unreviewed rewrite.

### Codec and equality contract

Allow finite JavaScript numbers, including fractional values, rather than
retaining the existing codec's safe-integer-only restriction. Reject NaN and
positive/negative Infinity before persistence. This does not provide exact
decimal arithmetic or approximate equality; applications can use integer minor
units or string-encoded decimal types when required.

Domain types may differ from persisted types (for example dates or bigints
encoded as strings). Support them only through Schemas with a persistable encoded
representation, not by silently coercing arbitrary JavaScript values. Encoding
and decoding service requirements remain explicit.

Use a deterministic canonical representation: object property order is
irrelevant, key ordering must not depend on locale, and array order is meaningful.
Compare an explicitly defined validated semantic representation, not mutable
lifecycle state or raw ciphertext. Decoded-domain equivalence and encoded-value
equivalence must not be silently interchanged across transformations.

Prefer Effect's `Schema.toEquivalence` where a structural comparator is needed,
with controlled fingerprint equivalence for protected values, rather than a
custom deep-equality implementation. Comparing correctly generated canonical
semantic-projection bytes also remains valid; this decision does not require
replacing that existing mechanism or honoring arbitrary user overrides that
ignore immutable fields. Equivalence is not serialization or validation.

Local runtime probes against Effect 4.0.0 confirmed order-independent struct
comparison, fractional-number equality, and fingerprint-only overrides inside
a tested Union. These probes do not qualify every Schema shape or repair the
existing projection traversal bug.

Support structs, arrays, optional fields, and unions with correct protected-field
handling. Transformations are supported only where encoded-side handling and
protected-field mapping can be made correct. Do not promise arbitrary custom or
recursive Schemas; unsupported shapes must fail explicitly rather than silently
skip protection. The known protected-subtree Union regression must be fixed.

Retain initial bounds: 64 KiB each for payload and semantic projection, depth 32,
at most 16 protected subtrees, and the existing 256-byte UTF-8 schema-path bound.
Exact supported-transform diagnostics and service provisioning must be specified
and tested before implementation is considered qualified. No new runtime API,
implementation, or agent dispatch is authorized by acceptance.

## D6 — native ambient transactions and explicit standalone production

Current owner-approved API refinement replaces the earlier mandatory callback
capability ceremony for the qualified Effect-native PostgreSQL/Drizzle path.
The owner explicitly accepted this complete scope; no compatibility/migration or
deprecation machinery is required. Other D1–D8 safety properties remain in force.

`definition.enqueue(input)` resolves the generic `JobEnqueue` Effect service.
The configured native adapter uses the exact application's `PgClient.transactionService`.
An active transaction of that SAME client is required; missing/foreign context
fails before preparation. There is no implicit BEGIN, second connection, commit,
savepoint or replay. Connection strings and a Drizzle `tx` object do not prove binding.
Native Drizzle and the Effect client manager both establish the supported context.

`PostgreSqlJobs.layerNoDeps` provides storage plus this producer service.
`backend.withTransaction(() => definition.enqueue(input))` delegates explicit
join-or-establish behavior to the application's manager and supplies the service.
`definition.enqueueStandalone(input)` owns a bounded transaction for preparation,
job/payload insertion and deduplication, and resolves after acknowledged commit.
It rejects an active transaction of the configured client and never independently
commits a consequence inside its parent's business transaction.

The outer business owner controls commit, rollback, reconciliation and replay.
Joined results are provisional. Unknown native control/commit outcomes stay Unknown;
no whole-operation replay or rollback inference from interruption/timeouts is added.
Actual source-current real-PG qualification covers atomic commit/rollback, same
connection/xid, concurrent isolation/deduplication, caller interruption, wrong source,
standalone failure/active rejection and synthetic response loss after durable COMMIT.
This is not a network/server-crash guarantee.

Only `PgClient@4.0.0` with native Drizzle `1.0.0-rc.5-169397b` is qualified by the
native adapter. Its structural client type is an integration port, not a blanket
guarantee for other drivers. The application owns pool lifetime, migrations and
finite native acquisition/control/release timeouts. Retaining/forking transaction
contexts past the owner's callback is unsupported; there is no invented `tx` identity proof.
Workers and cleanup retain their existing owned-transaction protocols.

The focused `enqueueInTransaction(tx, input)` primitive and explicit-handle bridge
remain independently useful for qualified custom adapters and their scoped lifetime
checks. They are not required ceremony for native application calls. Core imports
contain no PG/Drizzle dependency and do not start database or worker activity.

## D7 — new generic PostgreSQL storage without legacy compatibility

Status: accepted by the owner on 2026-10-04. Tracked in Multica as UPVE-859.
The owner confirmed effect-auth has no users or data requiring preservation.

Choose variant B: design the generic storage directly, without an auth-specific
legacy adapter, historical-data backfill, dual reader/writer, or parallel queue
runtime. This is a breaking alpha storage change for new installations, not
authorization to delete data or reset a database.

### Storage structure

Use two generic relations:

- `jobs`: generated job ID, producer identity, catalog identity, persisted policy,
  availability, and mutable lifecycle state, counters, and lease ownership.
- `job_payloads`: immutable encoded payload and its semantic projection, linked
  to the parent job. Lifecycle attempts do not rewrite the payload.

Do not add auth-specific user/challenge/event fields to the generic table.
Domain data remains in the application payload or application-owned relations.
Auth keeps its domain authority, definitions, handlers, receipts, and transactions
that atomically compose domain, audit, job, and receipt writes.

### Schema integration and migration ownership

Provide optional Drizzle schema declarations with configurable namespace and
table names. The library defines required columns, constraints, and indexes;
arbitrary per-column remapping is not required. Core does not depend on Drizzle.
Backend and migration configuration must agree on the same storage mapping.

Proposed API direction, not existing or finalized exports:

```ts
import { makeJobTables } from "effect-jobs/PostgreSqlDrizzleSchema"

export const jobTables = makeJobTables({
  schema: "public",
  jobsTable: "jobs",
  payloadsTable: "job_payloads"
})

const JobsLayer = PostgreSqlJobs.layer({
  connectionSource,
  tables: jobTables
})
```

Applications generate and run migrations. Runtime must not create, migrate, or
rebuild tables automatically. Concrete DDL, schema readiness checks, mapping
types, and backend constructors still need specification and qualification.
Optional Drizzle integration must not impose Drizzle on applications using a
different migration tool.

### Compatibility and qualification

There is no obligation to migrate historical Pending/Active/Completed/Dead/
Isolated rows or old receipts under the confirmed deployment profile. A physical
storage change alone does not change a job's catalog version; changes to its
semantic contract must be evaluated separately.

Tests must still qualify atomicity, concurrent production, conflict handling,
ownership fencing, recovery, packed imports, and migration/readiness behavior.
Absence of existing consumers removes upgrade machinery, not correctness
requirements. Acceptance does not authorize implementation, agent dispatch,
database resets, commit, push, or publication.

## D8 — replaceable cleanup with application-domain retention integration

Status: variant A and terminal-state rules accepted by the owner on 2026-10-04.
Tracked in Multica as UPVE-862.

### Decision and ownership

Provide a replaceable `JobCleanup` port with a bounded cleanup operation. Provide
a generic PostgreSQL implementation for installations without additional domain
references, and an application-owned implementation for domains that need to
coordinate jobs with receipts or other relations. Exact service and constructor
names are proposed, not existing exports.

Effect-auth retains a PostgreSQL cleanup adapter that understands registration
receipts and OTP challenge/issue-receipt relationships while using the generic
jobs storage. Do not move auth-specific cleanup SQL into the generic package or
install generic cleanup alongside the auth adapter in a way that bypasses its
retention checks. An application with domain references must supply a coordinated
adapter rather than assume generic cleanup knows those references.

Do not introduce generic retention holds or their additional persistence and
lifecycle machinery in V1. The adapter is a qualified backend integration, not
an arbitrary SQL callback claimed to be safe merely because it implements a port.

### Terminal-state rules

- Pending and Active jobs are never cleanup candidates.
- Completed jobs can be removed after their persisted retention period and
  applicable domain protection conditions are satisfied.
- Dead jobs require explicit retention policy; do not infer a deletion period.
- Isolated jobs are never automatically purged.

Retention supports explicit duration or Forever choices where applicable. The
illustrative 30-day duration is not an approved mandatory default. Retention is
persisted execution configuration subject to D3's first-write-wins rule, not a
value silently replaced by a new deployment or duplicate enqueue.

### Deduplication and reference safety

Retention must cover the application's required deduplication window. Once all
durable evidence of a producer identity is removed, re-enqueue can create a new
job; no permanent deduplication guarantee is made. Receipts still needed for
reconciliation or idempotent response replay must protect associated jobs for
their required lifetime.

Coordinate eligibility checks, applicable expired-receipt removal, and terminal
job deletion atomically, with a specified lock order and structural referential
integrity. Do not check references separately and later delete without guarding
the intervening race. The current auth cleanup SQL is prior art and must be
adapted and qualified rather than blindly copied.

### Maintenance and qualification

Applications explicitly invoke cleanup, for example through a scheduled
maintenance program; imports and handler installation do not start deletion.
The operation is bounded by a caller-supplied limit. Proposed composition:

```ts
const maintenance = Effect.gen(function* () {
  const cleanup = yield* JobCleanup
  return yield* cleanup.cleanup({ limit: 100 })
})
```

Applications select the generic PostgreSQL implementation or their domain
implementation through ordinary Layer composition, not two independent cleanup
paths over the same protected jobs. Maintenance must use database time and the
configured connection infrastructure.

Before qualification, specify exact retention fields, deletion authority, lock
order, and adapter setup. Test cleanup racing with producer retries, receipt
protection/expiry, bounded deletion, payload-parent deletion, and exclusion of
Active/Pending/Isolated jobs. Acceptance closes the architecture decision, not
runtime qualification, and does not authorize implementation or agent dispatch.
