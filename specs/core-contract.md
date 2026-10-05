# Shared core contracts

Implemented serial prerequisite for UPVE-1031, against accepted D1–D8 at
`0e10e8a5a0b21101c00ea064e87ac641b73743c3`. The earlier
`core-contract-proposal.md` is historical, not a merge input. This document freezes
the contracts consumed by definitions/producer, lifecycle/store and codec units.
It does not implement or qualify their runtimes or activate those tasks.

## Modules and import directions

The package exports these exact public subpaths (ESM and declarations):

```text
effect-jobs/JobId
effect-jobs/JobIdentity
effect-jobs/JobPolicy
effect-jobs/JobFailure
effect-jobs/JobContract
effect-jobs/JobTransaction
```

The root remains empty, not an all-modules barrel. No subpath imports auth,
PostgreSQL, Drizzle, environment configuration, pools, workers or registry Layers.
No import starts work. The backend must not enter core through a default Layer.

```text
Effect <- JobId / JobIdentity / JobPolicy
JobPolicy <- JobFailure
JobId + JobIdentity + JobPolicy <- JobContract
JobContract <- JobTransaction (public opaque capability and errors)
JobContract + JobTransaction <- internal/JobTransaction (lifetime mechanics)
JobContract + JobIdentity + JobPolicy + internal/JobTransaction <- later Job/JobProducer
JobContract <- later JobPayload/JobPayloadCodec
JobContract + JobFailure + JobPolicy <- later JobStore/internal/JobLifecycle
shared contracts + qualified active application handle <- later backend bridges
```

`JobTransaction` has only a **type-only** reference to the internal symbol; the
internal leaf imports its public errors at runtime. There is no runtime cycle.
Only the later definition implementation and qualified backend bridges consume
the internal leaf. `internal/*` is not a package export or custom-adapter API.
The transaction declaration references the internal symbol declaration; that file
must remain in the build artifact even though package export resolution denies
runtime deep imports. Do not duplicate symbols, brands or errors in later units.

## Identity and synchronous declaration validation

`JobId.JobId` is a nonempty string Schema branded `effect-jobs/JobId`; the Schema
and its inferred type share the name. IDs are library-assigned; their generation
and uniqueness are backend obligations. No UUID algorithm or caller ID override
is selected here. Schema decoding brands persisted IDs; it is not production.

`JobIdentity` exports Schemas `QueueName`, `JobKind`, `JobVersion`, `OperationName`,
`SlotName`, `OperationId`, `CatalogIdentity` and `ProducerIdentity`. The last two
also have literal-preserving structural interfaces:

```ts
interface CatalogIdentity<
  Q extends string = string,
  K extends string = string,
  V extends number = number
> {
  readonly queue: Q
  readonly kind: K
  readonly version: V
}
interface ProducerIdentity<O extends string = string, S extends string = string> {
  readonly operation: O
  readonly operationId: string
  readonly slot: S
}
```

Queue names are 1–64 characters; kind/operation/slot names 1–128, all ASCII
`^[a-z][a-z0-9.-]*$`. Version is integer 1–32,767. These preserve source bounds.
Operation IDs are valid scalar strings without NUL, 1–256 UTF-8 bytes, with exact
equality: no trimming, normalization or case folding. Application-branded strings
are accepted. Durable collation/equality must preserve this behavior.

`validateOperationId(value: string): void` throws `InvalidOperationId` with only
`rule: "unicode-scalars" | "no-nul" | "utf8-length"` and length-rule
`byteLength`. It never includes the supplied ID. Untrusted non-string values use
Schema validation at the consumer boundary; do not export raw Schema diagnostics
containing sensitive inputs as enqueue errors.

`validateProducerDeclaration({ operation: string, slots: ReadonlyArray<string> }):
void` validates names, nonempty slots and uniqueness synchronously. It throws
`JobDeclarationError` containing `field` (`operation`, `slots`, or `slots[index]`),
the invalid declaration `value` where applicable, and actionable `expected` text.
The producer unit **must call this before returning its immutable declaration**;
there is no producer implementation here. It must preserve inferred operation and
slot literals, reject undeclared slots, and copy/freeze its slot array. No global
registry or mutable builder is needed.

## Complete immutable policy

Use `import * as JobPolicy from "effect-jobs/JobPolicy"` and
`JobPolicy.make(options?: JobPolicyOptions): JobPolicy.JobPolicy`.
Every public input field is optional:

| Field              | Input                                | Default         |
| ------------------ | ------------------------------------ | --------------- |
| leaseDuration      | Effect Duration                      | 90 seconds      |
| attemptTimeout     | Effect Duration                      | 30 seconds      |
| retryDelay         | Effect Duration                      | fixed 5 seconds |
| maxAttempts        | integer                              | 3               |
| maxStalledCount    | integer                              | 1               |
| completedRetention | Effect Duration or Duration.infinity | 90 days         |
| deadRetention      | Effect Duration or Duration.infinity | infinity        |

No raw millisecond input or hand-written `_tag` is required publicly. `make` is a
synchronous configuration factory and throws `JobPolicyConfigurationError` with
the exact `field` and `expected` constraint. Counters retain source limits:
maxAttempts 1–100, maxStalledCount 0–100. Finite durations must resolve to integer
milliseconds 1–253,402,300,799,999; no rounding, truncation or clamping. Zero,
negative, fractional-millisecond and negative-infinity retention are rejected.
Only positive infinity is Forever, and only for retention.

`attemptTimeoutMillis < leaseDurationMillis` is mandatory. Response budget is
backend configuration, not a policy field; later backend qualification must
ensure the stored lease can support timeout plus its budget.

The returned object and every nested configuration object are frozen:

```ts
interface JobPolicy {
  readonly leaseDurationMillis: number
  readonly attemptTimeoutMillis: number
  readonly maxAttempts: number
  readonly maxStalledCount: number
  readonly retrySchedule: { readonly _tag: "FixedDelayV1"; readonly delayMillis: number }
  readonly completedRetention: JobRetention
  readonly deadRetention: JobRetention
}
type JobRetention =
  { readonly _tag: "Forever" } | { readonly _tag: "Duration"; readonly millis: number }
```

`PersistedJobPolicy`, `FixedDelayV1`, `JobRetention`, `PositiveMillis` and
`EpochMillis` are runtime Schemas. Persisted decode requires the **complete**
resolved configuration and the cross-field constraint; it never fills current
defaults into old rows. The layout is the V1 policy representation; concrete
backend storage/version discriminator belongs to its schema task. Updated
deployment defaults cannot rewrite retained rows.

`EpochMillis` preserves the source positive integer bound 1–253,402,300,799,999
for availableAt/notAfter; accepting epoch zero would be a policy change, not
silently inferred from the superseded proposal. Ordinary past positive timestamps
are valid. The backend must validate computed timestamp additions against the
same bound rather than overflowing/clamping. No database-time arithmetic is
implemented in this unit.

## Handler and enqueue contracts

`JobContract.HandlerInput<Payload>` is `{ readonly payload: Payload; readonly
context: HandlerContext }`. Context contains exactly jobId, catalog, producer and
attemptNumber, all readonly. No client, lease token, transaction, finalizer or
ambient handler dependency service is exposed.

attemptNumber is `attemptsMade + 1`. Claim/release do not increment attempts;
confirmed fenced Complete/Retry/Dead/Isolate increments exactly once. Unknown
leaves attempts unchanged; stalled recovery has its own counter. Consequently
attempt numbers may repeat and are not external idempotency keys or invocation
counts. Enforcing those transitions belongs to the lifecycle unit.

`JobFailure` is a Schema/type union. `JobFailures` supplies checked frozen factories:

```ts
JobFailures.Retry({ code: string, notAfter?: number })
JobFailures.Dead({ code: string })
JobFailures.Isolate({ code: string })
JobFailures.OutcomeUnknown({ code: string })
```

Codes are 1–64 characters matching `^[a-z0-9][a-z0-9_-]*$`; cutoffs use
EpochMillis. Invalid factories throw `InvalidJobFailure { field: "code" |
"notAfter" }`, without recording input text. Domain errors are mapped by ordinary
Effect composition. Unknown is not a seventh lifecycle state; mixed causes,
defects, interruption or timeout never imply known-safe Retry. Runtime boundaries
must validate even structurally constructed failure values with `JobFailure`.

`EnqueueInput<Payload>` has required producer, decoded payload, resolved policy
and optional availableAt. No job ID is supplied. `EnqueueResults` is a
`Data.taggedEnum` factory for `Inserted { jobId } | AlreadyPresent { jobId }`.
Results remain provisional until application commit.

For matching producer tuples, duplicate equality compares catalog and validated
canonical semantic payload/fingerprints only. It excludes generated IDs, policy,
initial/current availability, ciphertext randomness and lifecycle state. Matching
duplicates return the original ID and retain first policy/availability. Omitted
availability uses DB time only on first insertion. Conflicts are typed
`JobIntegrityConflict` with no raw payload/identifiers; they cannot be swallowed
to commit partial application writes.

`InvalidJobInput { field }` and `JobPayloadCodecError { reason }` are bounded
operation-owned errors. `JobTransaction.JobEnqueueError` unites those with
JobIntegrityConflict and JobsTransactionClosed. Provider errors stay in the
backend's explicit E channel, not raw public diagnostic strings.

## Codec and prepared-payload seam

`EncodedJobPayload` contains `formatVersion: 1`, `payloadBytes: Uint8Array` and
`semanticProjectionBytes: Uint8Array`. `PreparedJob` contains catalog, producer,
complete policy, optional availableAt and encoded. It has no generated candidate
ID. Readonly byte properties **do not make Uint8Array immutable**: the codec owns
its output buffers, and a receiver must copy before retaining them. Internal
forwarding deliberately does not implement serialization or pretend to validate
fake byte fixtures.

Shared constants: payload and projection each 65,536 bytes; maximum depth 32;
maximum protected subtrees 16; maximum UTF-8 schema path 256 bytes; formatVersion 1.
The codec implements exported function-type contracts:

```ts
type JobPayloadEncoder = <S extends Schema.Top>(
  schema: S,
  payload: S["Type"]
) => Effect.Effect<EncodedJobPayload, JobPayloadCodecError, S["EncodingServices"]>
type JobPayloadDecoder = <S extends Schema.Top>(
  schema: S,
  encoded: EncodedJobPayload
) => Effect.Effect<S["Type"], JobPayloadCodecError, S["DecodingServices"]>
```

The later codec exposes matching encode/decode functions; definitions must carry
encoding services into enqueue and capture decoding/handler services through
ordinary Layers. No `EncodingServices: never` limitation or hidden provisioning.

Protected markers describe application-owned envelope/fingerprint Schemas.
Require an **own** fingerprint with validated canonical JSON representation;
semantic projection excludes the remainder of that subtree. Marking proves no
encryption/authenticity. No projection callbacks, mandated crypto envelope, keys,
automatic encryption or generic AAD are introduced here. Full marker/codec runtime
and own-field checks belong to UPVE-857, not a parallel stub in contracts.

Codec qualification must cover finite fractional JSON numbers, nonfinite rejects,
locale-independent object order, meaningful array order, supported structs/arrays/
optionals/unions and explicit unsupported transformed/recursive mapping. Decode
validates format, bounds, UTF-8, schema and projection consistency before dispatch.
Canonical projection comparison is not an authenticity proof.

## Scoped explicit transaction seam

`JobsTransaction<E = never, R = never>` is an opaque callback capability. It has
no public constructor, arbitrary insert callback, query client, transaction
runner, savepoint, commit, rollback or replay. Its symbol is internal only.

The internal `withJoinedTransaction(insertOrCompare, body)` is a lifetime helper
for **qualified backend callbacks**, not a generic public extension point:

```ts
withJoinedTransaction<A, E, R, BackendError, BackendRequirements>(
  insertOrCompare: (prepared: PreparedJob) =>
    Effect.Effect<EnqueueResult, BackendError | JobIntegrityConflict, BackendRequirements>,
  body: (tx: JobsTransaction<BackendError, BackendRequirements>) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R>

insertPrepared<E, R>(tx: JobsTransaction<E, R>, prepared: PreparedJob):
  Effect.Effect<EnqueueResult, E | JobIntegrityConflict | JobsTransactionClosed, R>
```

It allocates a fresh frozen capability per Effect execution, scopes the callback
and invalidates it at callback exit on success, typed failure, defect, synchronous
throw or interruption. Deferred/escaped enqueue Effects check liveness when run,
before invoking the backend. Closed failure carries reason `callback-exited` and
an actionable message directing enqueue into the joinTransaction callback.
Callback-scoped fibers are scoped normally; unscoped escaping fibers and concurrent
transaction operations are not supported. Branding/lifetime checks are atomicity
correctness, not a sandbox against trusted application code or casts.

The backend must bind the supplied exact active connection/source. The helper
cannot prove connection provenance, insert correctness, rollback or durable
atomicity, and these tests do not claim that it can. Custom adapters need a later
explicit qualified backend extension contract, not a public re-export of this
helper. No Effect SQL/Drizzle/pg compatibility claim exists yet.

`JobTransactionsService<ManagerError, ManagerRequirements = never>` is the explicit
configured manager integration contract, not an implementation or Context tag:

```ts
withTransaction<A, E, R>(
  body: (tx: JobsTransaction<ManagerError>) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | ManagerError, R | ManagerRequirements>
```

A qualified integration delegates join-or-establish to the application's manager;
it must not instantiate a second engine/pool. Explicit backend join must never
open a new connection/transaction/savepoint, or independently commit/replay.
Application owner retains whole-operation commit knowledge and replay authority.

## Qualification and ownership

Tests under `tests/core` exercise identity diagnostics, defaults and policy bounds,
strict timeout edge, failure bounds, forwarding and capability lifetimes.
`tests/types/contracts.ts` is included by the existing strict compiler gate,
using positive assertions, checked `@ts-expect-error` cases and type-level
service/error-negative assertions. Tests cover distinct Schema encode/decode
requirements against real Effect 4.0.0 declarations.

Source reference inspected read-only at auth revision
`5c2e2b81c1aabb102d71894ecb6977611028b78a`: JobQueue, AuthJobs, AuthJobData and
JobPayloadCodec bounds. Auth remains independent and untouched.

This serial unit owns these six public contract modules, their internal
transaction leaf, tests/core and tests/types/contracts, this specification and
required package/root export integration. Later units must not edit shared
contracts, package/lock/config or exports concurrently; request serial changes.
No dependency/toolchain upgrade, worker, store, producer/registry, full codec,
generic crypto, migration or backend is included.

The current repository has no tracked `.github` workflow or extra gate scripts.
The actual local CI-equivalent gate is package `verify`: check, lint, whole-tree
format check, build and tests. Harness-generated untracked files are not owned:
if whole-tree format fails on them, report that failure and independently check
tracked/owned files without modifying runtime files. Exact command results,
tool versions, read manifest and immutable base/head/tree are delivered in the
issue report; this document does not invent successful future receipts.

No PG or packed worker/backend qualification, database operation, push, PR,
publication, runtime modification or merge is authorized. Temporal runtime edges
(due `<=`, owned `>`, expiry `<=`, usable lease `>= timeout + budget`, retry cutoff
`>= notAfter`, one DB-time snapshot) remain accepted obligations of later units;
contract tests qualify only the policy inequality, not those unimplemented writes.
