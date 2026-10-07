# Encrypted payload first-stage experiment

This experiment changes no production code. `EncryptedPayload.ts` is a concrete
typed candidate API against installed Effect 4.0.0, not a package export.
`EncryptedPayload.test.ts` distinguishes native Schema behavior, encoded-side
projection, the current library boundary, and a test-only proposed retry adapter.

Run from the repository root with pinned Node 24.15.0 / Bun 1.4.2:

```sh
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd tests/postgresql
bun install --frozen-lockfile --cwd tests/qualification/d6-pg
bun run check
bunx oxlint --deny-warnings tests/poc
bunx oxfmt --config .oxfmtrc.json --check tests/poc
node node_modules/vitest/vitest.mjs run tests/poc/EncryptedPayload.test.ts
```

## Verified candidate contract

```ts
interface EncryptionCodec<Encoded, Envelope extends Schema.Codec<unknown>, RE, RD> {
  readonly envelope: Envelope
  readonly seal: (
    value: Encoded
  ) => Effect.Effect<Envelope["Type"], ProtectionFailure, RE>
  readonly open: (
    value: Envelope["Type"]
  ) => Effect.Effect<Encoded, ProtectionFailure, RD>
}

encrypted({ schema: Document, codec: ReceiptCodec })
// Schema.Codec<Document["Type"], Envelope["Encoded"],
//   Document["DecodingServices"] | RD,
//   Document["EncodingServices"] | RE>
```

The initial envelope contract is a service-free identity JSON schema with an own
`fingerprint`. Domain schemas may themselves transform: the fixture's numeric
amount encodes to a string before seal; open returns that string before domain
decode and validation. The codec produces the app-owned fingerprint in its
envelope; the queue compares the envelope's validated fingerprint, never the
encryption nonce. Fixture Layers provide independent ReceiptKeys and PersonalKeys.
Service lookup occurs inside seal/open Effects. Import and Job.make do not read
keys or start work. The native transformation combines both schema requirements
and the codec's separately inferred encoding/decoding requirements.

The token map is **stub encryption**. The HMAC uses a synthetic fixture key and
canonical encoded content. Random opaque tokens, app key identifiers, stable HMAC
keys, and separate per-field stores demonstrate control flow and rotation without
claiming encryption, authentication, KMS, context binding or security qualification.
The fixture has no secrets from an environment or external provider. Production
apps must authenticate envelopes, authorize key selection, preserve old keys,
and maintain fingerprint semantics for retained jobs. Equal encoded content is
not a general promise of domain equivalence for every custom schema transform.

## Observed versus desired

| Case                                                                 | Observed experiment                                                                                                                          | Production status / desired behavior                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Domain Type / encoded envelope / services                            | Type assertions and negative controls pass                                                                                                   | Candidate contract is implementable with native Schema                            |
| Valid envelope                                                       | Native decode returns validated domain fields; existing registry/worker unmarked control calls handler once and completes                    | Protected transform remains unsupported in the current standard codec             |
| Malformed envelope, tampered token, wrong key, invalid opened domain | Native rejects; existing worker controls isolate before handler                                                                              | Preserve permanent artifact isolation                                             |
| Transient key outage                                                 | Native SchemaError retains private issue identity; standard decoder erases it as invalid-schema; worker isolates and increments attemptsMade | Requires owner decision below                                                     |
| Keys return after isolation                                          | Expired recovery finds nothing; claim is Empty; handler remains uncalled                                                                     | Current behavior cannot recover this outage                                       |
| Random tokens / encryption key rotation                              | Encoded-side protected projection is identical for equal content; changed amount changes projection; old key remains readable                | App-owned fingerprint contract; actual DB duplicate handling is not tested here   |
| Independent fields                                                   | Both services are required; swapped envelopes fail in the independent stub stores                                                            | No general cross-field substitution/AAD guarantee                                 |
| Outer struct / nesting / optional / array / discriminated union      | Native round trip and direct encoded-side project pass, including public union branch                                                        | End-to-end standard codec support still needs implementation                      |
| Encrypted within encrypted                                           | Prototype rejects construction explicitly                                                                                                    | Keep rejection in v1; production AST annotation copying still needs qualification |
| Proposed transient Retry, maxAttempts=3                              | Existing lifecycle schedules fixed-delay retry, consumes one finalized attempt; restored keys allow completion on second attempt             | Test-only decoder adapter, pending approval                                       |
| Proposed transient Retry, maxAttempts=1                              | Existing lifecycle ends Dead immediately, no re-claim                                                                                        | Finite attempts, no unlimited retry promise                                       |

The current standard `prepareProjection` rejects protected markers crossing a
transformation before any encryption. Therefore the lifecycle controls deliberately
use an **unmarked** native schema to reach the current decoder. They do not pretend
to qualify encrypted protection end to end. Direct encoded-side `project` proves
a useful building block only; blindly relaxing prepareProjection would also leave
the decoded preprojection / union mapping problem unresolved.

## Focused decision requested

Approve a separate bounded `JobPayloadUnavailable` error through the encoder,
decoder and registry contract. Only an explicitly app-classified key-service
outage during decode becomes this error; invalid envelopes/domain data remain
JobPayloadCodecError. Producer failures stay typed enqueue failures and never
pretend a job was inserted. Native SchemaGetter only accepts SchemaIssue errors;
the prototype verifies safe private issue identity survives Schema wrapping.
Production classification must inspect Issue variants, preserve mixed causes,
and recognize only the library's private transient marker, without parsing
provider messages or flattening arbitrary schema failures.

For a **sole typed decode-unavailable failure before handler invocation**, approve
the worker requesting existing fenced Retry with code `payload_key_unavailable`.
This uses persisted FixedDelayV1 and maxAttempts, increments attemptsMade once on
confirmed finalization, and ends Dead on exhaustion. It consumes an attempt even
though the handler did not run. There is no new state, DB field, immediate retry
loop, handler replay, or lease renewal. Unknown finalization results retain the
existing reconciliation path. Defects, interruption, timeout and mixed Causes
retain existing unknown/expiry behavior; they are never inferred to be safe Retry.

The alternative existing Active/lease-recovery path consumes stalledCount and
eventually becomes Dead; silently choosing it would not satisfy a distinguished
transient contract. The recommended decision is bounded persisted Retry above.
No production lifecycle/error change is implemented until this explicit decision.

## Independent preparation for the seven-change continuation

| Scope                | Baseline / next implementation                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| extraIndexes         | Keep the Drizzle-specific option separate from core TableOptions; append actual typed IndexBuilder entries to existing jobs-table extras; require migration/snapshot proof                                                                                                                             |
| FailureCode          | Current Schema maximum is 64; factories take strings; lifecycle imports that Schema. SQL and Drizzle store last_failure_code as text without a length constraint. Expand runtime/storage Schema to 128, add literal-preserving branded catalogs and Result parser, migrate internal codes and fixtures |
| defaultPolicy        | Current make already constructs and deeply freezes new policy objects. Export one make() value; verify caller Duration options remain unfrozen                                                                                                                                                         |
| default version      | Preserve optional variable unions as runtime version or 1; literal omission and explicit override must have exact inferred types                                                                                                                                                                       |
| encrypted fields     | Recognize only the helper's supported encoded envelope boundary; preserve bounds and low-level protected use; resolve decoded preprojection and union branch mapping; decision above required                                                                                                          |
| default encoder      | Job imports the core codec with no backend imports; encoder service requirements remain from Payload.EncodingServices; handler decoder stays explicit                                                                                                                                                  |
| ambient / standalone | Current backend uses trusted ApplicationAdapter handles. New core enqueue service needs a qualified same-PgClient native adapter; standalone must reject ambient transaction and acknowledge commit before returning                                                                                   |

This preparation is not implementation or qualification of those six remaining
features. No reliance is placed on historical temporary transaction PoCs; archive
or reproduce them before using their evidence. Real PG, Drizzle-generated custom
migrations, installed/packed new API checks and full final local preflight remain
required for the later implementation. No CI workflow is tracked at this baseline;
package scripts define verify and separate backend/installed qualification gates.

The initial repository-wide lint invocation requires installed native-consumer
fixture modules populated by its qualification runner. A fresh root install alone
leaves unresolved effect-jobs / @effect/sql-pg fixture types and reports warnings.
Focused PoC lint is independent. This stage is not an ordinary push handoff and
does not claim complete local CI-equivalent acceptance.

## Read manifest

All recursive ai-docs files were read before writing the experiment:

```text
ai-docs/README.md
ai-docs/tsconfig.json
ai-docs/src/index.md
ai-docs/src/01_services/10_services-and-layers.ts
ai-docs/src/01_services/20_module-consumption.ts
ai-docs/src/01_services/30_layer-composition.ts
ai-docs/src/02_modeling/10_schema-tagged-match.ts
ai-docs/src/03_errors/10_errors-and-causes.ts
ai-docs/src/04_observability/10_operation-observability.ts
ai-docs/src/05_resources/10_resources-interruption-secrets.ts
ai-docs/src/06_persistence/10_mutation-boundaries.ts
ai-docs/src/07_transport/10_wire-errors.ts
ai-docs/src/08_style/10_visible-code-and-modules.ts
ai-docs/src/09_testing/10_testing-and-review.ts
ai-docs/src/10_boundaries/10_external-time-regex.ts
ai-docs/src/fixtures/Auth.ts
```

Also read: specs/core-contract.md, specs/architecture-decisions.md, canonical
UPVE-1020 workflow attachment; assigned and parent issue descriptions/comments;
all seven source descriptions/comment scans; both normative encrypted follow-ups;
installed Effect Schema/Getter/Issue implementations; current payload/projection,
definition, registry, worker execution/finalization, lifecycle artifact and harness
source; current policy/failure/backend declarations and qualification scripts.
