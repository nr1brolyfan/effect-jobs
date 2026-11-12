# Contract-first API redesign

Current integrated contract. Historical implementation/review receipts remain tied
to their original source commits and are not final integration qualification.
See api-refinements.md for lazy typed construction and retry-policy.md for the
persisted retry protocol.

## Responsibilities and names

| Module          | Responsibility                                                      |
| --------------- | ------------------------------------------------------------------- |
| `Job`           | Immutable, namespaced name/version and payload Schema contract.     |
| `JobGroup`      | Pure named collection of job definitions.                           |
| `JobApi`        | Pure immutable aggregate of named groups.                           |
| `JobApiBuilder` | Complete typed group handler installation.                          |
| `JobProducer`   | Immutable operation/slot bindings to job and default queue/policy.  |
| `JobWorker`     | Worker construction, queue concurrency and bounded `drain`.         |
| `JobPolling`    | Explicit scoped polling; independent of storage and migrations.     |
| `JobStorage`    | Portable configured execution store and its single response budget. |
| `JobSchedule`   | Read-only, bounded next-wakeup observations.                        |

Names are selected for the target API rather than retained for compatibility.
Persistence-specific entrypoints continue to be separate from portable contracts.
`JobRegistry`, `JobConsumer`, `JobPlan` and `JobWorkerRuntime` are not required
public concepts in the target. Internal helpers may remain when they have a real
responsibility; removal of public ceremony does not require rewriting the engine.

## Definitions, routing and identity

A job contract consists of namespaced name, version and payload Schema. Queue is
execution routing, not contract identity. Group keys are local implementation
aliases, not persisted job identities. Different versions can coexist in a group.

A producer declares its operation and consequence slots once. Each slot binds a
contract and resolved default policy to either a fixed `{ queue: JobQueue }` route
or an explicit closed `{ queues: [JobQueue, ...JobQueue[]] }` choice. Fixed enqueue
forbids a `queue` property, including `undefined`; selectable enqueue requires a
member queue-name string, even with one choice. There is no implicit/default choice.
Missing/both routing declarations, empty/invalid/duplicate lists and `defaultQueue`
fail through the typed error channel when setup executes. All three methods preserve per-slot payload/queue/
encoding-service correlation and accept independently optional complete `policy`
replacements. Configuration is copied without freezing caller objects; choice and
policy are captured before asynchronous encoding. Invalid routing reports typed
`InvalidJobInput.field = "catalog"` after authority/lifetime checks and before
encoding/insertion; invalid policy reports `"policy"`.
Dynamic IDs are rejected through the typed
enqueue error channel, not synchronous exceptions from a runtime-value builder.
Job and producer declarations validate lazily through their typed setup Effect.
Pure group/catalog declaration combinators remain synchronous.
`Job.make({ name, version?, payload })` returns a lazy Effect with
`InvalidJobDefinition`; the value contains only those contract fields.
`JobProducer.make(operation)` returns a lazy Effect starting with no slots; successive
`Producer.withSlot(name, job, { queue, policy? })` stages in `.pipe(...)` return
new producer Effects, retaining operation literals, per-slot payload and encoding
service inference. Each stage validates/snapshots its new binding and preserves
earlier bindings. Known duplicate names fail statically and every duplicate fails
through the typed setup channel at runtime, never replacing a slot. Empty declarations have no
legal typed enqueue slot. There is no `build`, replacement combinator or former
record-constructor overload. No constructor starts persistence work or codec services.

Deduplication remains scoped to one configured storage and keyed by
`(operation, operationId, slot)`. Duplicate semantic comparison includes name,
version and canonical payload/fingerprints. A matching duplicate retains the first
job ID, queue, policy and availability. A deployment routing change neither moves
an existing job nor creates another consequence. A changed semantic contract or
payload is still an integrity conflict. Moving production between databases or DO
instances does not preserve deduplication evidence automatically.

There is no mandatory tenant identity, per-tenant queue or DO topology. Shared
queues by work class are a supported application starting point; tenant authority,
globally unambiguous operation IDs, physical placement, fairness, DO alarm ownership
and any later tenant/shard routing remain application-owned. A logical queue name
does not create infrastructure or provide a storage/security/region boundary.

All actual migrations remain application-owned. Breaking source API changes do
not authorize reinterpretation or destruction of retained artifacts.

## Group handler contract

`JobGroup.make(name, { alias: definition, ... })` produces an immutable declaration.
The name distinguishes group service requirements statically; it is not a durable
job identity. Separately constructed groups have distinct runtime Context keys.
`JobApi.make(name).pipe(JobApi.addGroup(group), ...)` aggregates groups without
routing or infrastructure. Assembly snapshots declaration structure, retaining exact
Schema and installation identity, without freezing caller-owned values. Earlier and
sibling catalogs stay unchanged. Names must be unique; duplicate name/version pairs
across groups fail rather than selecting a handler. Repeated aliases and differing
versions are valid. An empty catalog can be assembled but cannot run a worker.

`JobApiBuilder.group(api, name, handlers => ...)` selects a declared literal group.
Chain `handlers.handle(alias, implementation)` for every alias exactly once; return
the complete builder directly or through an Effect. Builders are immutable. Unknown,
duplicate, missing and foreign implementations fail static checks where knowable
and typed Layer configuration validation for JavaScript/type bypass. A union-valued
alias does not establish that every possible member was implemented. Each handler
infers its exact decoded payload and context and returns `Effect<void, JobFailure, R>`.
Callback build E/R, handler R and Schema decoding services remain in Layer E/R.
Dependencies yielded by the callback are acquired once per Layer acquisition;
invocations retain individual Scopes. There is no public record installer or shim.

Worker construction accepts the complete catalog and requires every group's installed
service plus JobStorage. All groups share one execution engine and each configured
queue's permits across parallel drains. Group names/aliases add no prefix to durable
identity or artifacts. Separate same-shaped group declarations remain structurally
indistinguishable in TypeScript but have distinct runtime Context keys: supplying an
unrelated installation fails safely through worker configuration E. Reuse the exact
declaration used by the worker. Construction starts no polling, claim or migration.

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

## Transactions and persistence guarantees

Joined enqueue requires the exact application's active storage transaction, never
an implicit second connection or independently committed consequence. A callback
bridge supplies an invocation-bound producer based on its already validated
transaction. It must not advertise ambient production and then reject it because
the adapter only supports explicit handles. Escaped operations fail after callback
exit, before payload preparation. Standalone production remains explicit and
rejects active parent transactions.

Integrity conflicts must prevent committing partial business consequences even
when the typed conflict is caught. Persistence qualification must establish a real
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
different PostgreSQL/D1 database. No new persistence support claim follows from this
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
