# Job API refinements

`Job.make` declares only kind/version/payload and defaults omitted version to
exactly `1`. Producers use pure immutable pipeable assembly:
`JobProducer.make(operation).pipe(JobProducer.withSlot(slot, job, { queue, policy? }), ...)`.
The empty declaration is valid but has no legal typed enqueue slot. Each addition
validates and snapshots only its new binding, preserves earlier bindings, and
rejects duplicate names statically when known and synchronously at runtime.
There is no record-constructor overload, `build()` or `replaceSlot`.
Routing and resolved policy belong to `JobProducer` slots. `{ queue }` fixes the
route and forbids any enqueue `queue` field. `{ queues: [first, ...rest] }` declares
a nonempty closed choice and requires a member queue-name string on every enqueue,
even for singleton lists. Missing/both declarations, duplicate names and
`defaultQueue` are invalid. All three methods preserve per-slot payload/routing/
Schema-service correlation and accept an independent complete-policy replacement.
Matching duplicates preserve the first stored execution configuration and artifacts;
complete handlers are installed through `JobGroup.toLayer`. The standard artifact
codec is fixed; domain transformations and encryption belong in Schema, with no
per-definition encoder override or per-handler decoder parameter. Static
unsupported Schema structures fail during declaration/group setup before traffic.
Returned identity always contains a validated concrete version. Literal inference preserves omission and explicit versions;
optional version variables conservatively include `1`. Incompatible payload
changes need an explicit new version and its Schema. `JobPolicy.defaultPolicy` is deeply frozen and readonly; `make()` has the
same defaults and never freezes/mutates caller options.

## Diagnostic codes

Import `* as FailureCode` from `effect-jobs/FailureCode`. Define application
catalogs before startup with `FailureCode.define({ busy: "provider_busy" })`.
Values retain their literals and the validated `FailureCode` brand; outcome
constructors take branded codes and do not repeat code validation. Retry cutoff
validation is independent. `FailureCode.parse(dynamic)` returns an explicit Result.
Catalog definition reports the offending entry and expected grammar without the
supplied value. Grammar is 1–128 ASCII characters `^[a-z0-9][a-z0-9_-]*$`.
Codes are diagnostic identifiers, not provider messages or private identifiers;
syntax validation cannot prove privacy. Stored codes are validated independently
of current catalog membership. Existing SQL/Drizzle fields are unconstrained text;
no database migration is needed for the expanded Schema boundary.

## Schema-bound encryption

`JobPayload.encrypted({ schema, codec })` is a native Effect Schema transformation.
The app codec declares an identity JSON envelope Schema with an own required
`fingerprint`, and these operations:

```ts
interface EncryptionCodec<Encoded, Envelope extends Schema.Codec<unknown>, RE, RD> {
  readonly envelope: Envelope
  readonly seal: (
    value: Encoded
  ) => Effect.Effect<Envelope["Type"], JobEncryptionError, RE>
  readonly open: (
    value: Envelope["Type"]
  ) => Effect.Effect<Encoded, JobEncryptionError, RD>
}
```

Domain validation/encoding precedes seal. Open returns encoded domain data before
Schema decoding/validation. The helper propagates independent encoding/decoding
services. Multiple fields may have independent codecs/key Layers. Native structs,
arrays, optionals and unions are supported; recursive schemas, encrypted-within-
encrypted and unsupported protected mappings reject explicitly. Envelope transforms,
records and tuples are unsupported. The decoded handler receives domain fields,
never an envelope or codec wrapper. All encrypted fields open before invocation;
this provides no selective authorization. Admin/listing paths do not decode.

Encryption, allowlisted key selection, authenticated envelopes, canonical content
and stable keyed fingerprints are application responsibilities. No library crypto
algorithm, unkeyed sensitive-content hash or automatic key rotation is supplied.
Separate encryption and fingerprint key lifecycles; keep the fingerprint key
stable and retain old decryption keys while retained artifacts need them.
The fixture qualifies local AES-256-GCM/HMAC behavior, not all application codecs.
No cryptographic correctness or cross-field/AAD binding follows from this helper.

The first version uses application Layers loading/validating env/config keys before
worker startup. Missing/invalid configuration fails app initialization. Modules and
`Job.make` do no key lookup. Seal/open resolve typed services lazily. Remote KMS
unavailability/retry is outside this contract; no `JobPayloadUnavailable`, persisted
Retry or pre-handler infrastructure attempt consumption is introduced. Malformed/
tampered artifacts and invalid opened domain data follow existing bounded decode/
isolation semantics. Defects, interruption and timeouts keep existing worker behavior.

Encoded ciphertext and semantic projection each retain the 64 KiB bound, depth 32,
16 protected subtrees and 256-byte schema paths. Projection excludes encrypted
content/randomness and uses only the app fingerprint; it is not authentication.
Local encryption may run inside the owning transaction: apps must keep codec work
bounded and account for lock duration. `protected(schema)` remains independently
useful for already-protected envelopes and custom codecs.

## Native transactions

`PostgreSqlNative.layer({ client, operationTimeoutMillis })` supplies the adapter
for the application's SAME native `PgClient@4.1.0`. `PostgreSqlJobs.layerNoDeps`
provides `PostgreSqlJobs`, `JobEnqueue`, `JobOperators`, `JobStorage` and `JobSchedule`. Public
`client.withTransaction(body)` owns the transaction; Drizzle schema/queries run
in that same client/Context. `db.transaction` retains its upstream type limitation
and is excluded from positive qualification, without a local type correction. `producer.enqueue(input)` requires it; it has no transaction
argument or implicit fallback. Jobs/domain/receipts must share the same source.

`jobs.withTransaction(() => producer.enqueue(input))` delegates explicit manager
join-or-establish and supplies the producer service. `enqueueStandalone(input)`
owns bounded preparation plus atomic job/payload/dedup insertion, rejects an active
configured-client transaction and resolves after acknowledged commit. Unknown
outcomes remain unknown, without replay. The application owns pool, migrations,
and finite native control/release timeouts. The library body/query deadlines do not
promise a network timeout for an uninterruptible native transaction finalizer.
Escaping the owning callback with retained/forked context is unsupported.
Nested transactions/options/isolation are not automatically Drizzle-equivalent.
A+B strict/exactOptional source checks use approved dependency skipLibCheck:true;
C remains separately recorded known upstream FAIL and is nonblocking.

Generic producer errors are bounded `JobPersistenceError` values with transaction
misuse reason and `NotCommitted | Unknown` knowledge. Schema services remain in
E/R composition. The native adapter's structural input type does not qualify other
SQL drivers. Explicit-handle adapters retain `enqueueInTransaction` and their
invocation-scoped bridge, independently of native convenience. Worker ownership,
fencing, attempts, recovery and cleanup remain unchanged.

## Application-owned Drizzle indexes

`makeJobTables({ extraIndexes: jobs => [index(...).on(jobs.state, jobs.id)] })`
accepts only IndexBuilder entries and actual typed required jobs columns. Partial
indexes, order and supported expressions use the pinned Drizzle API. Library
columns/constraints/default indexes remain present; payloads are not extended.
`mapping` remains names-only. Application index names must be unique schema-wide;
neither the library callback nor `getTableConfig` promises fail-fast name collision
validation. Drizzle/application migration generation owns these extra indexes.
`PostgreSqlSchema.migration` remains baseline-only and readiness does not require
application indexes. No dashboard/query/index performance recommendation is implied.

The earlier index qualification used ORM `1.0.0-rc.5-169397b` and migration tool
`drizzle-kit@1.0.0-rc.5-5935859`: generated DDL/snapshot contains custom and mandatory
indexes; unchanged repeated generation proposes no drop. Upstream full strict
Drizzle declaration failure remains separately reported, not declared fixed.

## Finite local qualification

The existing `verify`, persistence, installed and release guards remain required.
`qualify:drizzle:native` adds packed native ambient/standalone real-PG checks on
Node and Bun; `qualify:drizzle:indexes` records migration/snapshot evidence;
`qualify:api:installed` checks new public types and local encrypted service behavior.
README/JSDoc gates consume source and the current immutable packed artifact;
a historical published alpha is not a compatibility target for this breaking API.
The first-stage PoC snapshot/artifacts remain historical evidence; no second PoC
or review round is required. No release/version publication or data migration is
part of this work.
