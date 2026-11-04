# Contract-first API redesign

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
deadline. Counter names must express finalized attempts rather than claiming to
count every handler invocation. Preserve counter arithmetic and recovery semantics;
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

Remaining implementation after the checkpoints below: configured `JobStorage` service
composition, `JobSchedule` observations, accepted retry/counter naming and finite
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

Still outstanding after the checkpoints below: configured `JobStorage`
service composition, `JobSchedule` observations, retry/counter naming, finite
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

Still outstanding: configured `JobStorage`, `JobSchedule` observations, accepted
retry/counter naming, finite graceful shutdown, final integrated documentation and
qualification, and the single independent review. No release, push, merge,
publication or deployment is authorized or performed by this checkpoint.
