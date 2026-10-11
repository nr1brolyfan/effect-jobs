# Guarded application commands

This slice implements the frozen `Scenarios` contract as application orchestration,
strict transport decoding and a private transaction integration proposal. It does
not install authority, routes, migrations or a PostgreSQL implementation. The
default `CommandPersistence.unavailableLayer` refuses every operation. Production
capabilities must remain false until the authority and transaction dependencies
are qualified. Scripted test adapters are never durable persistence evidence.

`GuardedScenarios.layerNoDeps` requires `SandboxAuthority` and `CommandPersistence`.
It re-describes server-owned authority for every command and receipt, ignores
caller capability booleans, checks sandbox identity and expected generation, and
validates adapter results against the exact request. `describe` must enforce
persisted expiry with DB time. Receipt reads may target an older generation of
the same authenticated sandbox, allowing reconciliation after a reset whose
acknowledgment was lost. They cannot grant old-generation write authority.

`Persistence.layerNoDeps` provides `CommandPersistence`, requiring the proposed
`CommandTransactions`, the actual configured public `JobEnqueue`, and application
`DocumentKeys`. It uses actual `Plan.plan(command, ref, 0)` and `Plan.enqueue` APIs.
Enqueues and associations run sequentially in the owning application transaction;
no standalone enqueue, library lifecycle SQL or executor dispatch is used.
Deduplication deliberately enqueues each identical consequence twice and checks
the same ID/AlreadyPresent result. One command still consumes one batch quota.
Producer identity stays in the scenario author's sandbox/generation/request
namespace. Protected document keys must be stable for the retained evidence
lifetime; the scenario's ephemeral demo key layer is for local tests only.

The transaction owner must lock sandbox authority, check persisted DB-time expiry
and generation again, and then read the exact operation/generation/request receipt.
An existing receipt returns its original result without any quota, enqueue or
audit write. A changed scenario/count under the same request is invalid.
First writes reserve quota, enqueue jobs, associate metadata, record the finite
reason code, and save the complete immutable command/result receipt in the SAME
transaction. Success from `owned` means acknowledged COMMIT, not a joined result.
Integrity conflicts abort the entire owning transaction. Neither raw errors nor
free-form reasons enter audit, DTOs, logs or spans.

`CommandTransactionFailure` preserves NotCommitted versus Unknown. There is no
automatic retry. Unknown commit returns only the exact request reference; only
the read-only receipt operation can resolve it. A missing receipt returns
`OutcomeUnknown`, never a rollback claim. `tx.admission` must independently prove
a first submission; an unresolved previous submission with no receipt returns
Unknown without production. **Durable admission is an explicit unqualified
dependency/proposal**, not implemented by an in-memory request cache. The owner
must approve and qualify a first-submission/uncertainty fence and its crash
semantics before installing this transaction port. Receipt absence alone must
never be used to manufacture `Fresh`. The current frozen authority contract has
no such admission primitive, so this slice cannot enable durable commands itself.

Reset increments only application generation, refuses safe-integer overflow and
records its receipt/audit atomically. It retains jobs, associations, payloads and
old receipts. It does not cancel jobs, steal leases, clear quota or broadly delete
active/pending/isolated rows. Provider execution and result writes need their own
same-transaction generation guard. Reset's generation fence does not substitute
for the library's ownership protocol.

`retryJob`, `redriveJob` and `cancelJob` stay false. The explicit unsupported action
returns capability-unavailable. Corrected-job creation, operator state/version
checks, free-form remediation reasons and provider controls lack frozen command/
receipt contracts and qualified approval. They remain proposals in
`docs/playground-capabilities.md`, not ad-hoc commands or payload edits. An unknown
provider effect must be reconciled with its domain ledger before any replacement
or replay; this command slice never infers permission from a job DTO.

## Serial integration proposals

1. In `Services.ts`, compose `GuardedScenarios.layerNoDeps` with qualified authority
   and persistence. Until then provide `unavailableLayer`, advertise run/reset
   false, and keep the three operator flags false. Do not install both mock and
   guarded Scenarios outputs. No new package dependency/config is needed.
2. The authority/persistence owner supplies `CommandTransactions`. It must use the
   same exact active client as the configured producer, with finite acquisition,
   query, COMMIT/rollback/release bounds and preserved commit knowledge. Never
   fabricate a `JobsTransaction` or create a second pool/transaction manager.
   Lock order: authority/admission, exact request, quota, job association/receipt.
   Serialize competing reset/run commands on the sandbox lock. Receipt uniqueness
   includes sandbox ID, generation, operation type and exact request ID; immutable
   normalized command content detects request reuse. Retained job quota stays
   at 100 across resets; each scenario is at most 10. Coordinate all references
   with app-owned retention, including uncertain admissions. Concrete migrations
   and a durable admission fence need owner approval/qualification, not runtime DDL.
3. In `Routes.ts`, register authenticated same-origin POST routes for `run`,
   `reset`, `scenarioReceipt`, `resetReceipt`, then invoke
   `HttpCommands.handle(access, request, operation, trustedWebsiteOrigin)`.
   The origin must come from validated deployment configuration. The handler
   rejects absent/mismatched Origin, foreign Sec-Fetch-Site, URL query input,
   non-JSON content, unknown fields and bodies above 4096 actual bytes. Reading
   input has a two-second budget and cancels unread streams. Cleanup has a
   separate 100 ms budget; the lock is released even if native cancel never
   settles, and late cancellation rejection is observed. The registrar owns
   capability cookie authentication and global/per-sandbox rate limits first.
   No public route should be registered before those prerequisites exist.
4. Replies use no-store, bounded `{ code }` errors, 200 for acknowledged enqueue/
   reset/receipt, 202 for Unknown. Acknowledged enqueue does not imply execution
   success. HTTP inspects the full Cause before expected error recovery: interruption and
   companion reasons remain a failure; mixed defects produce only safe 503.
   Persistence also retains all lifecycle reasons with fresh sanitized defects;
   only a single expected Unknown failure becomes an exact-reference result. Do not replay a
   command when a transport response is missing; use its exact receipt endpoint.
5. UI/live owner: after committed scenario invalidate/re-fetch the current list
   and affected detail; after committed reset switch to returned current ref,
   discard old cursors/hints and re-read. After Unknown retain the original request
   ref and reconcile its receipt, then refresh from authoritative reads. Continue
   periodic five-second reconciliation even when notification hints are absent.
   This slice does not modify another author's UI/live files or shared schemas.
6. Add `apps/website/tests/commands` to the shared playground test script and add
   `node apps/website/tests/commands/QualifyPacked.mjs` to integration qualification.
   The existing foundation app builds bundle inert entrypoints; the packed runner
   additionally builds these actual command/persistence consumer paths.

## Local qualification

```sh
bun run playground:check
bun run playground:lint
bun x --no-install vitest run apps/website/tests/commands/Commands.test.ts
bun x --no-install oxfmt --config .oxfmtrc.json --check apps/website/src/server/commands apps/website/tests/commands apps/playground-worker/src/persistence/commands
bun run playground:build
node apps/website/tests/commands/QualifyPacked.mjs
# Accepted fixes may reuse the qualified unchanged library artifact:
node apps/website/tests/commands/QualifyPacked.mjs --artifact path/to/artifact.tgz
```

The packed runner requires committed inputs, compares immutable library dist to
the current build, copies exact app/contracts bytes into an independent consumer
outside repository ancestry, checks strict declarations, runs the original
scripted reproductions on Node/Bun and bundles actual HTTP/persistence modules.
Every subprocess has a ten-minute deadline. Receipts include input hashes, exact
head/tree, archive hash and pinned tools in `.toolchain/commands/packed-*`.
Real PG/DB-time/atomicity/races, durable admission, credential persistence,
provider restart reconciliation, registrar integration, workerd and hosting remain
NotTested. No resource, secret, container or remote publication is touched.

Read inputs: `AGENTS.md`, canonical UPVE-1020 workflow attachment,
`specs/multica-workflow.md`, `specs/architecture-decisions.md`,
`docs/playground-foundation.md`, `docs/playground-capabilities.md`, frozen
contract sources, scenario/provider exports and scenario/read READMEs, public
producer/transaction code, and all recursive AI documentation:

```text
ai-docs/README.md
ai-docs/tsconfig.json
ai-docs/src/index.md
ai-docs/src/fixtures/Auth.ts
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
```
