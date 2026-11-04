# Contract-first API redesign

## Integrated qualification correction: portable group declarations

Real local workerd qualification found that using `crypto.randomUUID()` for a
group's Context key violates the Workers global-scope restriction when groups
are declared at module scope. Group construction now allocates a realm-local
sequence key synchronously, sharing the sequence across module copies without
sharing installed handlers. The key is neither durable identity nor random
security material. A regression disables global crypto and constructs groups
through separate module instances; the existing handler-isolation test remains.
Focused Node group/worker tests passed (21 tests). Final archive and real
workerd/browser qualification must be rerun on this correction before handoff;
the preceding snapshot's failed runtime receipts remain historical evidence.

## Authorization and delivery boundary

The owner authorized a direct breaking redesign following the API assessment of
`a467fc9e14c01d3d22a3dce7d516e3e5bd8b6a6a`. The selected direction is contract-first
typed operation groups (variant B), not a transitional handler-first API.
Deprecated exports, compatibility aliases, dual public APIs and legacy call
signatures are not delivery requirements. Names may change where that improves
the resulting API. This authorization does not permit database resets, dropping
owner data, cross-project edits, publication, deployment, push or merge.

This document records the target and implementation acceptance criteria. It does
not claim that the APIs below already exist or that any backend is qualified.
Existing implementation and qualification documents describe the baseline until
their affected sections are updated with the implementation. No partly migrated
snapshot is a release candidate.

## Responsibilities and names

| Module        | Responsibility                                                           |
| ------------- | ------------------------------------------------------------------------ |
| `Job`         | Immutable, namespaced kind/version and payload Schema contract.          |
| `JobGroup`    | Named collection of definitions and complete typed handler installation. |
| `JobProducer` | Immutable operation/slot bindings to job, queue and default policy.      |
| `JobWorker`   | Worker construction, queue concurrency and bounded `drain`.              |
| `JobPolling`  | Explicit scoped polling; independent of storage and migrations.          |
| `JobStorage`  | Portable configured execution store and its single response budget.      |
| `JobSchedule` | Read-only, bounded next-wakeup observations.                             |

Names are selected for the target API rather than retained for compatibility.
Backend-specific entrypoints continue to be separate from portable contracts.
`JobRegistry`, `JobConsumer`, `JobPlan` and `JobWorkerRuntime` are not required
public concepts in the target. Internal helpers may remain when they have a real
responsibility; removal of public ceremony does not require rewriting the engine.

## Definitions, routing and identity

A job contract consists of namespaced kind, version and payload Schema. Queue is
execution routing, not contract identity. Group keys are local implementation
aliases, not persisted job identities. Different versions can coexist in a group.

A producer declares its operation and consequence slots once. Each slot binds a
definition to a queue and resolved default policy. Production supplies the stable
operation ID and decoded payload. Dynamic IDs are rejected through the typed
enqueue error channel, not synchronous exceptions from a runtime-value builder.
Static malformed declarations may still fail synchronously.

Deduplication remains scoped to one configured storage and keyed by
`(operation, operationId, slot)`. Duplicate semantic comparison includes kind,
version and canonical payload/fingerprints. A matching duplicate retains the first
job ID, queue, policy and availability. A deployment routing change neither moves
an existing job nor creates another consequence. A changed semantic contract or
payload is still an integrity conflict. Moving production between databases or DO
instances does not preserve deduplication evidence automatically.

All actual migrations remain application-owned. Breaking source API changes do
not authorize reinterpretation or destruction of retained artifacts.

## Group handler contract

`JobGroup.make(name, { alias: definition, ... })` produces an immutable declaration.
The name distinguishes group service requirements statically; it is not a durable
job identity. Separately constructed groups have distinct runtime Context keys.
Its `toLayer` accepts a complete handler object (or an Effect constructing one).
Each handler's decoded payload is inferred from its corresponding definition.
Missing handlers are compile-time errors. Schema decoding services, handler
services and construction errors remain explicit in the resulting Layer types.

Handler installation produces a group-specific typed service required by worker
construction. It must not rely only on a mutable shared registry and `Layer<never>`
to demonstrate completeness. Two independently constructed groups must not
accidentally share handlers. Duplicate durable identities are rejected with safe,
actionable declaration diagnostics. Runtime checks remain necessary for dynamic
input and persisted artifacts.

An application's selected group must be complete before the worker is built.
Partial deployments select their own explicit group; they do not silently ignore
missing handlers. Building a worker starts no polling, claim or migration.

## Worker and execution limits

Queue concurrency belongs to the worker instance and is shared across concurrent
drains of that instance. Drain options describe a single invocation: bounded
claims and bounded recovery. Concurrency is not set by the first drain call and
cannot be changed accidentally by a later call.

Recovery invoked by a queue drain is scoped to that queue. Any global maintenance
operation is separate and explicit. Existing ownership fencing, original-token
reconciliation and bounded unknown-outcome handling remain mandatory.

Graceful shutdown stops new claims and awaits existing executions within a finite
grace period. Forced shutdown may leave unknown outcomes for lease recovery. No
shutdown result promises that external side effects did not happen.

`JobPolling.layer` owns graceful shutdown through its application Scope. It first
quiesces admission loops, then gives started executions one shared
`shutdownGraceMillis` (default 30,000; integer 0–300,000). Zero requests immediate
interruption. After expiry, remaining execution fibers are interrupted before
provided worker resources close. Admission/control/release and handler finalizers
must be finitely bounded and interruption-cooperative; no timer hard-kills arbitrary
uninterruptible or native code. In-flight claims can remain unknown. Direct bounded
drain interruption keeps its immediate scoped-interruption behavior.

## Policy, codecs and errors

The configured storage owns one finite response budget. Worker construction uses
that same budget, not a second caller-supplied copy. New jobs are rejected before
insertion when policy cannot reserve attempt timeout plus response budget.
Historical configuration incompatibility is distinguished from payload corruption.
Any automatically derived lease includes meaningful headroom for claim/commit and
scheduling; simple equality with timeout plus reserve is not sufficient.

The artifact codec is library-owned. Custom domain encoding and encryption use
Schema transformations with explicit services. Remove per-definition artifact
encoder overrides and per-handler decoder arguments rather than preserving an
extension point that operators do not honor. Enqueue, execution and operator
redrive use the same artifact semantics.

Static unsupported Schema structures are diagnosed while declaring or building
the group, before accepting production traffic. Errors distinguish unsupported
declarations, invalid input and invalid durable artifacts. Diagnostics can expose
static Schema paths and declaration names, never private payload values.

Use `retryBefore` for the retry-scheduling cutoff, not an apparent execution
deadline. Use `finalizedAttempts`, `maxFinalizedAttempts` and
`nextFinalizationNumber` rather than claiming to count every handler invocation.
The ordinal is `finalizedAttempts + 1` and may repeat after unknown outcomes.
Retain physical `attempts_made` and JSON `maxAttempts` through the storage codec.
Preserve counter arithmetic and recovery semantics;
do not add or change a delivery budget merely as a naming cleanup.

## Transactions and backend guarantees

Joined enqueue requires the exact application's active storage transaction, never
an implicit second connection or independently committed consequence. A callback
bridge supplies an invocation-bound producer based on its already validated
transaction. It must not advertise ambient production and then reject it because
the adapter only supports explicit handles. Escaped operations fail after callback
exit, before payload preparation. Standalone production remains explicit and
rejects active parent transactions.

Integrity conflicts must prevent committing partial business consequences even
when the typed conflict is caught. Backend qualification must establish a real
rollback-only mechanism or equivalent transaction-owner enforcement. PostgreSQL's
deliberate SQL error is not a portable SQLite implementation. Unknown commits
remain unknown; absence of a receipt never authorizes replay.

## Wakeups and future storage

`JobSchedule` provides bounded observations of the next availability and expired
lease recovery time using the storage's authoritative clock. These are hints, not
proof that no concurrent insertion can occur. External wake notifications require
a repair mechanism. Alarm ownership remains explicit and exclusive.

SQLite and DO SQLite require separate transaction and runtime qualification.
DO `transactionSync` cannot run arbitrary asynchronous Schema services; the async
storage transaction route or a separately prepared synchronous write route must
be tested. A job in DO SQLite cannot atomically accompany business writes in a
different PostgreSQL/D1 database. No new backend support claim follows from this
redesign alone.

## Delivery checks

- Compile-time positive and negative group completeness/payload/service tests.
- Group acquisition, sharing, isolation and failure cleanup tests.
- Full caller migration: library tests, qualification fixtures, playground,
  authored examples, documentation and package exports; no deprecated aliases.
- Policy reserve validation before writes and compatible retained-job behavior.
- Queue-scoped recovery and shared per-worker concurrency under parallel drains.
- Transaction callback lifetime, same-source atomicity, conflict rollback and
  unknown commit behavior, including supported explicit-handle integrations.
- Standard codec behavior across enqueue, execution and both redrive forms.
- Scoped polling shutdown and bounded wakeup observations.
- Actual local verification and installed-artifact checks for the final snapshot.
- Independent review required by the repository workflow before integration.

## Preparation record

Implementation worktree: `jobs-api-redesign`, created from the assessment baseline.
Before implementation, all files under `ai-docs/` were read recursively: README,
index, all service/model/error/observability/resource/persistence/transport/style/
testing/boundary examples, fixtures and both TypeScript configurations. Relevant
stored traits and the applicable workflow/architecture contracts must also be
reviewed before editing their corresponding implementation areas.

## Implementation checkpoint: group foundation

`src/JobGroup.ts` now implements the named declaration, complete typed handler
Layer, per-construction Context identity, standard artifact decoding and startup
Schema support checks. Each invocation has its own Scope rather than retaining
the installation Scope. Construction errors and independent Schema/handler
service requirements are preserved in types.

The module is exported and used by the public worker constructor. This remains an
implementation checkpoint of the target redesign, not a finished release.
The current migration status and remaining work are recorded below.

On 2026-11-04 the toolchain blocker was resolved: Node 24.15.0 was installed and
selected through fnm, and Bun 1.4.2 was installed from the official release after
verifying its published asset digest. The existing global fnm default was not
changed. Worktree-local `bun install --frozen-lockfile` and `bun run check` passed
without changing dependency pins or the lockfile. All 648 core tests, including
seven new group tests, passed again on Node 24.15.0. Focused lint passed at the
preceding implementation checkpoint; full final-release qualification remains
outstanding. Traits subsequently became available; the expanded changed-file
inventory has now been assessed and findings manually triaged against full files.

## Implementation checkpoint: shared execution engine

`src/internal/worker/Runtime.ts` now owns the existing execution protocol. The
current entrypoint delegates to this same engine; its claim, release, fencing,
finalization and reconciliation behavior is not replaced by a parallel engine.

`src/internal/worker/GroupWorker.ts` binds the complete group-specific handler
service to that engine without mutable registry installation. Explicit queue
configuration fixes concurrency before exposing the worker. Drain accepts bounded
job/recovery limits, rejects per-call concurrency and unknown options, and rejects
unconfigured queues before storage activity. The response budget comes from its
configured storage input, not a duplicate queue/worker option. `JobWorker.make`
and `layer` now accept `(group, storage, options)`; `JobWorker.drain(queue, limits)`
is the public finite execution entrypoint. `JobWorkerRuntime` is removed, without
a compatibility export.

On Node 24.15.0 / Bun 1.4.2, `bun run check`, focused lint and all 657 core tests
passed. Nine added worker tests cover inert construction, shared permits under
parallel drains, queue-independent contracts, invalid configuration and limits,
and reconciliation of a lost finalization response without handler replay.
Type tests retain the group's handler service and provider requirements.

## Implementation checkpoint: public worker, polling and recovery

`JobPolling.layer(queues, options)` replaces `PollingJobWorker.layerForPlan`.
It resolves concurrency from the constructed worker, validates every queue and
bounded option before spawning loops, and retains the existing scoped shutdown
and infrastructure backoff behavior. No legacy polling export remains.
Graceful draining with a finite shutdown grace period is still outstanding;
current Scope closure interrupts active execution as before.

The portable store now requires `recoverExpired(queue, limit)`. Runtime batching
preserves that queue on every batch; PostgreSQL filters before ordering, limiting
and locking rows. A deterministic public-worker test proves another queue's
expired ownership remains untouched. The corresponding real-PG test now passes
against source and installed package bytes on Node and Bun.

Playground construction and scenario handlers now use the complete shared group.
README worker/polling fences, their source/packed runtime fixtures, JSDoc examples,
and release/observability/Cloudflare execution fixtures have been migrated.
Protocol regression tests use an explicitly test-only engine adapter rather than
a production compatibility constructor. Some app-local consumer configurations
and older normative documents still require the remaining concept-removal pass.

## Implementation checkpoint: public producer and transaction lifetime

`src/JobProducer.ts` implements the public slot-bound producer. A slot binds a queue-independent contract,
queue and resolved default policy. Production accepts slot, operation ID, inferred
decoded payload and optional availability. The standard codec is fixed; encoding
services remain slot-specific. Type tests reject undeclared slots, mismatched
payloads and per-call routing. Runtime IDs fail in the Effect error channel.
Declarations snapshot routing/contract/policy, and validated identity/availability
are snapshotted before asynchronous encoding.

The old slot-array constructor and `.identity` are removed. Playground producers,
qualification fixtures, type tests, README and JSDoc examples use the public slot
record. Encoding services remain slot-specific; runtime operation-ID failures use
bounded `InvalidOperationId` diagnostics without echoing the input.

The PostgreSQL producer now compares kind/version and canonical semantic payload,
not queue routing. Matching duplicates preserve the complete original row,
including routing, policy, availability and ID. Real-PG tests cover a retry after
a routing change and concurrent producers with different routes; changed content
still aborts the parent transaction even if the typed conflict is caught.

`joinTransaction` now supplies an invocation-bound `JobEnqueue`, including for
qualified adapters without a native ambient port. `withTransaction` uses the same
callback lifetime for native and explicit-handle paths. Explicit enqueue checks
the lifetime before preparation and again at insertion; escaped callback services
also reject before encryption. Standalone production cannot independently commit
inside the callback. Tests cover escape before preparation, callback exit during
asynchronous preparation, both bridge forms and unchanged Effect service/error
requirements. This does not authorize retaining transaction contexts or promising
that external asynchronous preparation effects can be undone.

## Implementation checkpoint: storage admission and qualification

PostgreSQL admits new policies only when their lease reserves the attempt timeout
plus the storage response budget and stays within the bounded database clock.
The conditional parent insertion inserts neither job nor payload for an
incompatible new policy; the Effect fails with `JobPolicyIncompatible`. A matching
retained duplicate bypasses new-policy admission and retains its first route,
policy, availability, ID and artifact bytes. Semantic conflicts still poison the
PostgreSQL transaction, preventing a caught conflict from committing domain writes.

A valid retained policy incompatible with the current deployment causes claim
backoff without isolating or modifying the row. Operator redrive reports
`policy-incompatible`, distinct from invalid artifacts. Equality and neighboring
reserve values, bounded-clock overflow, all three production forms and restoration
of a compatible deployment have regression coverage.

Tagged-enum runtime factories now share their type names, including
`EnqueueResult.Inserted`, `ClaimResult.Claimed`, `FinalizationResult.Applied` and
`DrainResult.Idle`; plural factory exports are removed rather than aliased.

The JSDoc qualification gate creates a fresh consumer for every run, avoiding
reuse of stale same-version package bytes. Root `@effect/sql-pg: "4.1.0"` resolves
the previous native-fixture inference/lint blocker without changing its version.

Current checkpoint evidence on Node 24.15.0 / Bun 1.4.2:

- Full `verify` passes: types, lint, formatting, build, 1,034 tests (91 skipped),
  Field/Theme checks, release import guards, JSDoc/API source/packed consumers and
  the maintained observability example. Skipped PG suites are not backend evidence.
- `playground:check`, `playground:lint`, README source/packed qualification and
  `git diff --check` pass.
- Source-current PostgreSQL passes 38 tests on each runtime, with 35 tests skipped
  because their separate setup is not selected. The backend suite uses the actual
  public group-backed worker rather than the test-only protocol adapter.
- Installed PostgreSQL and native Drizzle A+B/runtime gates pass on the same packed
  artifact. The separate full foreign-declaration audit remains diagnostic FAIL;
  it is not claimed as passing or repaired by the lint dependency fix.
- PostgreSQL evidence and cleanup receipt:
  `/tmp/opencode/jobs-redesign-pg-4ks9qg79/`. The exact owned container was removed,
  absence verified and its private environment file deleted. Packed artifact
  SHA-256: `6e2daf37a56b382b09b5c0f03544291af36c56cb4e31ac0963c3fb2bb2d3ed57`.
- Traits assessed the expanded TypeScript scope and corrected files. Findings were
  manually triaged against exact rules and surrounding source; confirmed tagged
  recovery and factory-name issues were fixed and rechecked. Raw automated
  findings are retained, not represented as an automated all-clean pass.

Remaining implementation after the checkpoints below: accepted retry/counter naming and finite
graceful shutdown. Final caller/documentation migration, qualification of that
final snapshot and one independent review remain required. This checkpoint is
not a release candidate. The owner authorized local checkpoint commits before
continuing implementation. No push, merge, publication or deployment is authorized
or has been performed.

## Implementation checkpoint: contract-only operator inputs

The preceding worker/producer/admission checkpoint is committed locally as
`1faa200` on `refactor/jobs-api-redesign` in the dedicated worktree.

`JobOperators.redrive` and `correctedRedrive` now accept only kind/version/payload
contract fields rather than a queue-bound catalog. They validate kind/version
against the locked source and inherit its retained queue; current deployment
routing cannot move a successor. Both paths still authenticate the standard
artifact semantics, preserve Schema service requirements, and leave the source
unchanged. The playground repair caller and operator fixtures use this contract.
Negative type tests reject catalog-only inputs. This is the operator dependency
cutover, not completion of the pure public `Job` constructor migration.

Evidence: full `verify` passes 1,036 tests with 93 skipped, plus Field/Theme,
release import, JSDoc and observability checks. Source PostgreSQL now also enables
the dedicated operator suite: 69 passed and 6 skipped on each runtime. Installed
PostgreSQL passes 46 tests on each runtime, including both queue-independent
redrive regressions. Evidence and exact-container cleanup receipt:
`/tmp/opencode/jobs-redesign-pg-ixkj3fhj/`; both private configuration files were
removed. Earlier failed fixture attempts are not successful qualification.
Native Drizzle's separate checkpoint evidence above is not a fresh run for this
operator slice. Traits findings are manually triaged, not an automated clean pass.

## Implementation checkpoint: pure Job contracts

The operator cutover is committed locally as `4fb4881`. `Job.make` now returns a
frozen kind/version/payload contract only. Routing, direct production, handler
installation and artifact encoder overrides are removed from this public API,
without compatibility aliases. Omitted/optional version inference is preserved;
invalid identities, superseded runtime options and unsupported static Schema
structures fail at declaration without acquiring encoding services.
`JobGroup` and producer bindings share `JobDefinition` rather than a second
definition interface.

Real PostgreSQL/native Drizzle, installed API consumers, playground, website read
projections, README, JSDoc, observability and Cloudflare fixtures use pure contracts
and explicit producer routing. Native post-COMMIT response-loss injection uses a
Schema encoding transformation, not a public codec override. Application-owned
routing inventories remain distinct from contract identity.

`tests/core/definitions/ProtocolJob.ts` is explicitly test-only scaffolding for
low-level protocol/custom-codec failure controls. It is not exported or copied
into installed consumers; public API/type and backend qualification use actual
producers and complete groups. Eight new contract tests cover frozen snapshots,
invalid declarations and one serviceful Schema shared across two routes.

Evidence on Node 24.15.0 / Bun 1.4.2:

- Full `verify`: 1,044 passed, 93 skipped, plus Field/Theme, release imports,
  JSDoc source/packed consumers and the maintained observability example.
- README source/packed qualification and playground typecheck pass.
- Real source PostgreSQL: all 75 tests pass on each runtime, including operator
  and creation-time suites. Installed PostgreSQL: 46 tests pass per runtime.
- Packed native Drizzle A+B/runtime and installed public API qualification pass.
  The separate full foreign-declaration audit remains diagnostic FAIL, not repaired.
- Evidence and cleanup receipt: `/tmp/opencode/jobs-redesign-pg-y_kl2rxy/`.
  The exact owned container's absence was verified and private configurations
  removed. Packed artifact SHA-256:
  `f1ccde3deb9630314bdaacb8b9f450dc63f0d0bf695f3a3fae870fba13cc7489`.
- Current changed TypeScript was assessed by Traits; the subsequent comment-only
  test-helper edit was checked again. Findings were manually compared with exact
  rule scope and surrounding source, not reported as an automated clean pass.

Still outstanding after the checkpoints below: retry/counter naming, finite
graceful shutdown, final caller/documentation migration, integrated qualification
and one independent review. This is a local implementation checkpoint, not a
finished redesign or release candidate. No push, merge, publication or deployment
has occurred.

## Implementation checkpoint: no public mutable registry

The pure-contract cutover is committed locally as `4b31369`.
`JobRegistry` is removed from package exports and production source. The engine
depends only on internal `JobHandler`/`HandlerLookup` ports; group-backed worker
construction supplies its captured complete handlers. No public alias or mutable
installation path remains. Protocol failure controls retain a test-owned
`ProtocolRegistry`, which is not part of the built library. Package import tests
and the installed public API consumer reject the removed registry subpath.

This is a surface/type-dependency change, not a new execution engine or changed
transaction/fencing protocol. Earlier real-PG evidence belongs to the preceding
pure-contract snapshot; final integrated backend qualification and the single
independent review are still required.

Current evidence: full `verify` passes (1,044 tests, 93 skipped; 27 public subpaths
in the JSDoc source/packed gate), playground typecheck passes, and installed API
qualification passes on Node/Bun. The archive contains neither the removed
`JobRegistry` output nor the test registry. Evidence:
`/tmp/opencode/jobs-registry-removal-verify.log`,
`/tmp/opencode/jobs-registry-removal-8hkc73rf/` and
`/tmp/opencode/effect-jobs-public-api-OZkyyY/`. The first installed negative-import
assertion was corrected to account for Bun's `ERR_MODULE_NOT_FOUND` versus Node's
`ERR_PACKAGE_PATH_NOT_EXPORTED`; both prove the removed export is inaccessible.
Traits findings were manually triaged against their exact scope and source, with
no confirmed applicable violation remaining; raw findings are retained separately.

## Implementation checkpoint: queues and bounded drains without consumer plans

The registry cutover is committed locally as `775f14e`. `JobConsumer` and its
`JobPlan` are now removed from production source and exports, without aliases.
`JobWorker` fixes queue concurrency at construction; `drain(queue, limits)` and
`JobPolling.layer(queues, options)` resolve the internal `QueueRun` directly from
validated invocation limits and that fixed concurrency. The durable engine and
shared semaphores are unchanged. Internal permit acquisition needs only queue and
concurrency, not invented per-run limits during construction.

Playground execution exposes its fixed queue inventory, not consumer Effects.
Cloudflare wake cycles accept a queue and use their own finite claim/recovery
limits; callers configure worker concurrency separately. Real-PG probes and
workerd fixtures use these forms. The application-owned scenario `Plan` remains
domain workload planning, not a generic public execution plan.

Direct protocol fixtures retain a test-only `ProtocolConsumer.make`; generic plan
construction is deleted, not copied to tests. Obsolete consumer/plan-only tests
are replaced by actual public-worker boundary coverage: invalid/fractional limits,
concurrency bounds including NaN/infinity, upper limits, no storage activity on
rejection and no per-drain concurrency. Existing duplicate/empty queue and shared
parallel-drain tests remain. Type tests reject old consumer-shaped polling input.
Source and installed import tests reject all three removed subpaths. The packed
artifact contains neither obsolete production outputs nor protocol fixtures.

Current evidence on Node 24.15.0 / Bun 1.4.2:

- Full `verify`: 1,037 passed and 93 skipped; the lower count removes tests of the
  deleted plan implementation rather than weakening public-worker oracles.
- Eight JSDoc examples and 26 current public subpaths qualify against source and
  packed bytes on both runtimes. README source/packed qualification passes.
- Playground typecheck and lint pass. Mock finite wake-cycle tests pass in the
  full suite; workerd/hosted app execution is not newly qualified by these results.
- Source PostgreSQL: 75 tests pass on each runtime. Installed PostgreSQL: 46 pass
  per runtime. Native Drizzle A+B/runtime and installed public API gates pass.
  The separate full foreign-declaration audit remains diagnostic FAIL.
- Backend evidence and exact-container cleanup receipt:
  `/tmp/opencode/jobs-redesign-pg-araurqd9/`; private configuration files removed.
  Packed artifact SHA-256:
  `8d7627593c9621ff6528ed119a50ceef995f2ca027857ccb1971614642529934`.
- Changed authored TypeScript was assessed by Traits; a needless custom Schema
  error mapping in the test-only helper was removed and rechecked. Remaining
  findings were manually triaged against exact applicability and source, not
  represented as an automated clean report.

Still outstanding after the checkpoints below: accepted
retry/counter naming, finite graceful shutdown, final integrated documentation and
qualification, and the single independent review. No release, push, merge,
publication or deployment is authorized or performed by this checkpoint.

## Implementation checkpoint: configured JobStorage service

The consumer/plan removal is committed locally as `207c0a8`.
`JobWorker.make(group, options)` and `layer(group, options)` now require the
portable `JobStorage` Context service and complete group handlers. The explicit
backend argument and `JobWorker.Storage` type are removed, not overloaded or
aliased. Worker/drain options cannot supply a second response budget.

`JobStorage.make/layer` validate a positive bounded response reserve and capture
the raw store's provider requirements at construction. Construction performs no
readiness, database borrowing, migrations, cleanup, polling or pool ownership.
The service freezes its budget and exposes captured per-operation ports. Typed
provider failures become a safe `JobStorageUnavailable`, never a rollback proof;
operation-specific protocol, ownership and policy-admission errors retain their
identities. Explicit Unknown results, defects, interruptions and mixed cause
structure are preserved, with no mutation replay. Native low-level backend ports
retain their original typed errors for callers that need them.

PostgreSQL validates that one budget through storage assembly, uses it for
admission and execution, and exposes the captured service as `backend.storage`.
`PostgreSqlJobs.layerNoDeps` provides that same service alongside PostgreSqlJobs,
JobEnqueue and JobOperators. Readiness and source lifetime remain explicit.
Real-PG coverage proves the Layer supplies the identical service to a group worker,
construction borrows nothing, and a bounded drain durably completes the job.

Callers, README/JSDoc, native/installed execution fixtures, observability fixtures,
playground and Cloudflare probes use Context/Layer composition. New unit tests
exercise invalid budgets, inert construction, dependency capture and budget
snapshots, exact argument/result forwarding, sanitized errors without raw-port
mutation, no replay, policy/ownership/protocol identity, composite causes and
application-owned resource release. Type tests retain storage/provider/group
requirements and reject the removed signature. Those type consumers and an inert
storage-backed drain are also qualified from the installed package.

Current evidence on Node 24.15.0 / Bun 1.4.2:

- Full `verify`: 1,048 passed, 94 skipped; eight JSDoc examples against source and
  packed bytes, with 27 current public subpaths. The additional skipped test is the
  real-PG service-composition case, qualified separately below.
- Playground typecheck/lint and README source/packed qualification pass.
- Real source PostgreSQL: 76 tests pass per runtime. Installed PostgreSQL: 47 pass
  per runtime, including the new storage-service composition regression.
- Installed public API strict types/runtime and native Drizzle A+B/runtime pass.
  The separate full foreign-declaration audit remains diagnostic FAIL.
- Backend logs and exact-container cleanup receipt:
  `/tmp/opencode/jobs-redesign-pg-alm6_w1z/`; private configurations removed.
  Packed artifact SHA-256:
  `7ce01fcf1c7b3dee2c199b7b225753446a25c2686bf898d2143ad4420d67c4c3`.
- Standalone sustained observability qualification passes slow/offline loopback
  transport cases on Node/Bun, including actual storage-backed handler completion:
  `/tmp/opencode/jobs-storage-sustained-node.json` and
  `/tmp/opencode/jobs-storage-sustained-bun.json`.
- Current changed TypeScript was checked against all stored traits; findings were
  manually triaged against actual operation channels, trust boundaries and source.
  This is not an automated clean report. Maintained observability code typechecks;
  full collector/workerd/hosted qualification is not claimed for this checkpoint.

Remaining after the checkpoint below: accepted retry/counter naming, finite
graceful shutdown, final integrated documentation/qualification and one independent
review. This local checkpoint is not a finished redesign or release candidate.
No push, merge, publication or deployment has occurred.

## Implementation checkpoint: bounded JobSchedule observations

The configured-storage cutover is committed locally as `d8ec557`.
`JobSchedule.observe(group, queue, { limit })` now provides explicit read-only wake
hints through a separately configured Context service. Observation needs neither
installed handlers nor a worker, and Schema decoding dependencies do not leak into
its requirements. PostgreSQL exposes `backend.schedule` with native errors;
`PostgreSqlJobs.layerNoDeps` also provides the captured portable schedule service.
Imports and construction start no reads, alarms, polling, claims or migrations.

The PostgreSQL reader uses one SELECT with a materialized authoritative clock and
a single statement snapshot. It returns only time/kind/version metadata from a
queue's Pending/RetryScheduled head, capped at the requested 1–500 rows plus one
lookahead row. Supported contracts are matched within that sample. Recovery is the
earliest Active lease in the same queue, including other contracts, matching drain
recovery. No payload bytes, producer identities or lease tokens are selected;
there are no lifecycle mutations or row locks.

The result contains `observedAt`, nullable `nextAvailableAt` and `nextRecoveryAt`,
and `saturated`. Null availability with saturation is explicitly inconclusive,
never an assertion that the queue has no supported jobs. Even unsaturated hints
can become stale after observation. Applications calculate relative delays from
database time, retain finite repair wakeups and own authorization, activation
expiry and exclusive alarm responsibility. The row cap does not claim a bound on
total query work; the qualified adapter's finite deadlines bound source latency.
Requests are snapshotted before asynchronous work; malformed options, selections
or stored metadata produce bounded errors without exposing values.

The playground's existing observation intentionally remains application-owned:
it additionally scopes live sandbox/generation authority and traffic-generation
wakeups. A storage-wide hint cannot replace those predicates. No new SQLite/DO
backend or hosted alarm support is claimed.

Evidence on Node 24.15.0 / Bun 1.4.2:

- Full `verify`: 1,068 passed, 96 skipped; eight source/packed JSDoc examples and
  28 public subpaths. Twenty added unit cases cover empty/saturated samples,
  unsupported versions, snapshotting, invalid input/output, safe errors and cause
  preservation. Type tests prove observations need no handlers/decoding services.
- README source/packed qualification and playground typecheck/lint pass.
- Real source PostgreSQL: 78 tests pass per runtime. Installed PostgreSQL: 49 pass
  per runtime. New oracles prove authoritative-clock bounds, future retry hints,
  queue-scoped recovery, exact row preservation, no locking/mutation SQL, input
  rejection before borrowing and rejection inside an ambient business transaction.
- Native Drizzle A+B/runtime and installed API/type/runtime gates pass, including
  a native schedule read and ambient-ownership negative control. The separate full
  foreign-declaration audit remains diagnostic FAIL, not repaired by this work.
- Backend logs and exact-container cleanup receipt:
  `/tmp/opencode/jobs-redesign-pg-8pkcgbd3/`; private configurations removed.
  Packed artifact SHA-256:
  `1f720d40ad77c5a338ec784039aeba76fe4097a0b8a44a5fd302fdb2306114a2`.
- Changed authored TypeScript was assessed against all traits and raw findings
  manually triaged against exact applicability/source. This is not an automated
  all-clean report or a substitute for the final independent integrated review.

Remaining implementation: accepted retry/counter naming and finite graceful
shutdown, then final integrated documentation/qualification and one independent
review. This is a local checkpoint, not a release candidate. No push, merge,
publication or deployment has occurred.

## Implementation checkpoint: retry-scheduling cutoff naming

The bounded schedule checkpoint is committed locally as `1a4c177`.
Retry failures and finalization commands now expose only `retryBefore`, replacing
`notAfter` directly without aliases. `InvalidJobFailure.field` uses the new name.
It is a retry-scheduling cutoff, not a handler deadline or initial-availability
constraint: computed next availability `>= retryBefore` still becomes Dead.

Only runtime command data and its callers/documentation changed. Persisted policy
JSON (`maxAttempts`), physical counters (`attempts_made`), immutable artifacts,
budgets, retry arithmetic and unknown-outcome recovery retain their existing
representation and behavior. Counter/limit/ordinal naming remains a separate
unfinished implementation phase; this checkpoint does not claim it is completed.

Negative strict type tests reject the removed constructor field. Runtime schema
and failure-adapter tests reject the old spelling; the new cutoff survives the
handler-failure-to-finalization boundary. Equality and +/-1 neighbor oracles also
assert unchanged finalized counts, stalled counts and resolved policy.

Node 24.15.0 qualification: full `verify` passes 1,069 tests (96 skipped), with
eight source/packed JSDoc examples and 28 subpaths. README source/packed and
playground type checks pass. Real PostgreSQL passes 78 source tests and 49 installed
tests per Node/Bun runtime; native Drizzle A+B/runtime and installed public API/type
gates pass. The separate full foreign-declaration audit remains diagnostic FAIL.
Receipts: `/tmp/opencode/jobs-redesign-pg-s5isazga/`; the exact disposable container
was removed and private configuration deleted. Changed TypeScript was checked
against all traits and raw findings manually triaged; no confirmed applicable
violation remained. Read scope included all files recursively under `ai-docs/`,
plus repository workflow, architecture decisions and affected contract specs.

Remaining: finalized-counter/limit/ordinal naming, finite graceful shutdown, then
final integrated qualification/documentation and one independent review. No push,
merge, publication or deployment has occurred.

## Implementation checkpoint: finalized-attempt model names

The cutoff rename is committed locally as `3790b35`.
Public model names now state the existing protocol precisely:

- `JobSnapshot.finalizedAttempts` counts confirmed fenced Complete/Retry/Dead/Isolate
  transitions. Claim/release, unknown outcomes and expiry recovery do not increment it.
- `JobRetryPolicy.maxFinalizedAttempts(n)` and resolved
  `JobPolicy.maxFinalizedAttempts` bound those finalizations, including the first.
- Handler `context.nextFinalizationNumber` and the lifecycle helper of that name
  expose `finalizedAttempts + 1`. Recovery can repeat this ordinal; it is not an
  invocation counter or external idempotency key.

Removed source names have no compatibility aliases. Strict negative type tests
reject the old builder, resolved field, snapshot counter and context ordinal.
Existing lifecycle, retry/jitter, unknown/reconciliation, worker, operators and
real callers have been migrated without changing arithmetic or budgets.

Durable representation is deliberately unchanged. `PersistedJobPolicy` is now a
bidirectional Schema codec mapping retained JSON `maxAttempts` to the resolved
field and back, without applying defaults. `JobPolicy` is the separate resolved
schema used for in-memory snapshots/prepared artifacts and producer validation.
PostgreSQL reads decode stored policy before lifecycle validation; claims reuse
that decoded value, and inserts encode policy before serialization. Physical
`attempts_made`, SQL constraints/indexes, retained payload bytes and first-write-wins
policy semantics are unchanged. Public Drizzle properties use the new counter name
while mapping to the same physical column.

Playground shared/wire models use resolved policy, SQL detail reads decode policy
at their storage boundary, and repair reconciliation decodes retained policy before
snapshot validation. UI projections and test fixtures use the new counter names;
provider invocation counts remain distinct. Packed playground qualification also
now explicitly permits the two already-published observability documents in its
package inventory, matching the existing manifest rather than a stale allowlist.

Qualification: full `verify` passes 1,074 tests (96 skipped), eight source/packed
JSDoc examples and 28 subpaths. Five new regression cases cover retained FixedDelayV1,
BackoffV1 Full/ProportionalV1 round-trips, physical-to-public mappings, no default
filling, and unchanged claim/recovery/finalization counter separation. README
source/packed, playground types/lint and packed contracts qualification pass.
PostgreSQL passes 78 source tests and 49 installed tests per Node/Bun runtime;
native Drizzle A+B/runtime and installed public API/type gates pass. The separate
full foreign-declaration audit remains diagnostic FAIL. Disposable PG receipt:
`/tmp/opencode/jobs-redesign-pg-nspkftx_/`; its exact container and private
configuration were removed. All changed authored TS/TSX was assessed against all
traits, with manual triage and a minimal named-schema fixture correction; raw
findings are not represented as an automated clean pass.

Remaining implementation: finite graceful shutdown, then final integrated
documentation/qualification and one independent review. This is not a release
candidate. No push, merge, publication or deployment has occurred.

## Implementation checkpoint: finite graceful polling shutdown

Finalized-attempt naming is committed locally as `a6c0088`.
`JobPolling.layer` now accepts `shutdownGraceMillis`: integer 0–300,000, default
30,000. Application Scope closure first interrupts admission loops (including
permit waits, recovery and in-flight claims), then gives already-started executions
one shared grace interval. Zero requests immediate interruption. At grace expiry
remaining executions are interrupted before provided worker dependencies close.
Direct bounded drains retain their existing immediate scoped-interruption path.

Polling owns separate admission/execution FiberSets inside a private Scope and
one acquireRelease finalizer. Ambient parallel finalizers cannot race the internal
grace sequence. The shutdown finalizer stays masked while its wait/timer race
children are interruptible, so an actual application interruption does not skip
grace or erase the original interrupted exit. Completed fibers are removed by the
FiberSet rather than accumulated over the polling lifetime. Construction remains
inert, imports start no activity, and no global worker/alarm owner is introduced.

No handler is rerun or executing job released as safely unexecuted on forced
shutdown. Lost claim/finalization responses and external effects retain their
unknown-outcome semantics for fencing/recovery. Counter arithmetic, retry policy,
storage bytes and provider transaction ownership are unchanged. Grace starts after
admission quiescence; qualified storage acquisition/control/release and handler
finalizers must still be finitely bounded and interruption-cooperative. This is not
a hard-kill guarantee for arbitrary native/uninterruptible user code.

Qualification on Node 24.15.0 / Bun 1.4.2:

- Full `verify`: 1,083 passed, 97 skipped; eight source/packed JSDoc examples and
  28 public subpaths. Nine added deterministic shutdown cases prove successful
  finalization, one global deadline across queues, blocked-permit admission stop,
  default grace, actual parent interruption with graceful/forced completion, lost
  claim/finalization responses, and provided-resource lifetime. Existing polling
  tests prove zero grace and malformed options before any storage activity.
- Real PostgreSQL: 79 source tests and 50 installed tests pass per runtime. The new
  shutdown oracle proves graceful completion increments the durable finalized
  counter once while a forced running handler remains Active with count zero.
- Installed public API/type/runtime and native Drizzle A+B/runtime gates pass.
  The separate full foreign-declaration audit remains diagnostic FAIL.
- README source/packed and playground typecheck/lint pass. Exact-container cleanup
  and backend receipts: `/tmp/opencode/jobs-redesign-pg-dkqkveg8/`; private
  configuration removed. Changed authored TypeScript was checked against all
  traits and raw findings manually triaged, not reported as an automated clean pass.

Planned implementation phases are complete. Final integrated documentation and
qualification consolidation, freezing the complete redesign snapshot, and one
independent review remain. This is not a release candidate or integration approval.
No push, merge, publication or deployment has occurred.
