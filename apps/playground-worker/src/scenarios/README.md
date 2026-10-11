# Deterministic synthetic scenarios

These modules are private application consumers of the public `effect-jobs`
package. They do not modify library runtime or the frozen shared contracts.
No import starts a worker, creates a database, reads an environment variable or
calls an email, payment or webhook service. All associations are synthetic.

`Plan.plan(command, authenticatedSandboxRef, serverSeed, availableAt?)` strictly
decodes the five frozen scenario commands. Version 1 plus a fixed unsigned
32-bit seed selects workloads and associations deterministically. The count is
bounded to ten. Changing generation or request ID changes the hashed producer
namespace; replaying the same request retains each consequence's slot/sequence.
The caller must authenticate and enforce expiry, quotas and exact-request
receipts before using the plan. Neither a matching reference nor a plan grants
write authority. A changed seed or scenario under an existing request must not
overwrite that request's receipt or payload.

The five commands map to success, confirmed rejection followed by success,
terminal rejection, accepted operation with response loss, and a success plan
that the command adapter can enqueue twice to demonstrate deduplication.
Isolated, delayed eligibility, unknown recovery and concurrent execution are
internal qualification profiles and fixtures, not additional public command IDs.
Pass `availableAt` only from application configuration; it delays eligibility,
not a promise of execution at that time. The current frozen HTTP command has
no user-specified seed or delay field.

Six definitions cover welcome email, image processing, webhook delivery,
private data export, catalog synchronization and simulated payment, across four
queues and six producer slots. The image provider uses a single interruptible
20 ms sleep instead of real conversion. The webhook has no URL field. None of
these providers invokes a real external operation.

`PrivateDocument.keysLayer` generates nonextractable ephemeral AES-256-GCM and
separate HMAC-SHA-256 keys through Web Crypto. `EncryptedDocument` uses the
library's actual encrypted Schema and canonical codec. Random nonces change
ciphertext while keyed fingerprints preserve semantic equality. The typed
document includes its synthetic subject and tenant; the export handler checks
them against the outer payload before accepting an effect. No keys, plaintext,
fingerprints or ciphertext enter dashboard DTOs or the ledger observation.
These ephemeral keys cannot reopen documents after a process restart. Durable
key custody and rotation are executor/deployment prerequisites, not implemented
by this local demonstration. JavaScript strings and crypto provider copies are
not claimed to be zeroized.

`FakeProviderLayer.layer` owns a fresh bounded ledger (100 identities). It
atomically compares semantic signatures and records acceptance in one
synchronous in-memory step. Concurrent matching calls produce one synthetic
effect; changed payloads return `PayloadConflict`. Retry rejection records zero
effects. Response loss records acceptance before returning `ResponseLost`;
replaying the same identity confirms success without another effect, even when
the library's attempt number repeats after recovery. `inspect(identity)` is a
read-only application observation labeled `source: "mock"`. It is neither a
durable receipt nor a library attempt history. The ledger does not survive a
restart, and there is no automatic deletion or cross-run exactly-once guarantee.

The executor owns sandbox generation/expiry fencing and ledger lifetime. Use a
single ledger and a single key Layer instance for the handlers in one admitted
sandbox execution context; refuse stale invocation before any provider/app
write. This layer has no database authority and cannot enforce DB-time reset
fencing by itself. Production observation/result persistence needs the app's
same-transaction generation guard and bounded retention adapter. The ledger is
not exposed through anonymous HTTP or a global listing method.

`Handlers.toJobFailure` exhaustively maps bounded provider failures to Retry,
Dead, Isolate or OutcomeUnknown. Defects/interruption are not inferred to be a
confirmed rejection. OutcomeUnknown never becomes a made-up durable state.
`Fixtures.dashboard` contains strictly decoded synthetic DTOs for every actual
state, plus delayed, unknown and recovered profiles. Fixture lifecycle versions
are illustrative, not historical evidence.

## Serial integration proposals

- In `apps/playground-worker/src/HandlerRegistry.ts`, import
  `scenarios/Handlers.ts` and expose/compose `layerNoDeps` together with the
  executor's shared JobRegistry, FakeProvider and DocumentKeys Layers. The six
  definitions' catalogs must be included in each matching queue's worker config.
- In the mutation slice, use `Plan.plan` with an authenticated reference and a
  fixed server-owned seed (0 for the initial deployment). Run `Plan.enqueue` in
  sequence inside the application's existing same-client transaction, alongside
  mapping, quota and exact-request receipt writes. Its results are provisional
  until that transaction commits. Propagate `JobIntegrityConflict`; never catch
  it to commit partial application writes. Receipt reconciliation owns unknown
  producer commits. This does not use or install the foundation's generic
  `ScenarioJob`; keep that declaration frozen and inert until serial integration.
- Add `apps/playground-worker/tests/scenarios` to `playground:test` in the root
  manifest. No dependency or shared DTO changes are needed. Internal profiles
  remain absent from the frozen public command enum.
- The executor must provide qualified durable provider ledger/result persistence
  and key custody before claiming restart-safe recovery. Its migrations and
  authority registrars remain outside this slice. No direct lifecycle SQL is
  proposed.

## Focused qualification

Run `bunx vitest run apps/playground-worker/tests/scenarios`,
`bun run playground:check`, `bun run playground:lint`, and
`bunx oxfmt --config .oxfmtrc.json --check apps/playground-worker/src/scenarios
apps/playground-worker/src/providers apps/playground-worker/tests/scenarios`.
After the foundation build/install steps, run
`node apps/playground-worker/tests/scenarios/Qualify.mjs` for the independent
packed consumer with strict declarations, Node tests, Node/Bun runtime smoke
and browser bundles. Each subprocess has a ten-minute timeout. This qualifies
local public library APIs and application bytes, not PostgreSQL, workerd,
Cloudflare hosting, durable reset fencing or worker execution in those runtimes.
