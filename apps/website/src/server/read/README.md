# PostgreSQL read slice

This is an application-owned read-only SQL adapter for the frozen playground
contracts, not a library admin API. `JobStoreService` only exposes worker claim,
release/finalization/reconciliation/recovery; `PostgreSqlJobs.Backend` adds
producer, readiness and cleanup. None supplies a sandbox list/detail read model.
There are no lifecycle writes, payload table reads or automatic decryption here.

`PostgreSqlRead.layerNoDeps(mapping)` provides `JobsRead`, requiring
`ReadDatabase` and `CursorCodec`. `NativeReadDatabase.layerNoDeps` supplies the
former from the application's Effect `SqlClient`; it creates no pool. The CF
owner must qualify its actual driver. A two-second Effect query budget bounds
response work; the pool owner must separately configure finite acquisition,
server statement/control/release timeouts and cancellation. Use SELECT-only
runtime privileges. No imports execute SQL or create keys/resources.

`CursorCodec.layer(key)` needs an application-supplied HMAC SHA-256 secret key
of at least 256 bits with sign/verify usages. Keep the same key across instances
if cursors must survive instance changes. Rotation invalidates old cursors.
Tests use an explicitly synthetic key; runtime does not generate, read or copy
keys. Canonical base64url, authenticated JSON and strict bounded Schemas reject
malformed/tampered cursors. The body is readable metadata, not confidentiality.
It contains only sandbox/generation, state/kind filters, format version and last
ID. Page size may change; filter/ref changes require restarting. The app bounds
IDs to 128 characters (current PostgreSQL producer uses UUIDs); a different ID
backend needs a cursor/detail limit compatibility decision.

The query joins library jobs with application-owned associations. A single
statement checks the persisted sandbox generation/expiry with DB time and reads
the corresponding associations. Foreign/missing details both return not-found.
A reset committed before statement start revokes the old generation; a commit
racing after statement start is observed by the next reconciliation. Current
keyset reads use ascending ID under deterministic `COLLATE "C"`, with one
lookahead row, default HTTP limit 25, maximum 50. This is not a historical
snapshot: state changes can move rows into/out of a filtered page, insertions
behind the last ID can be missed until restarting, and deletions disappear.
Reconcile by replacing the active list every five seconds and after reset/hints.
`JobPage.filteredTotal` counts matching scoped rows before the keyset predicate,
using the same authority/association statement snapshot as items and global stats.
It applies both state and kind filters; global stats intentionally apply neither.
An empty cursor page still returns its complete matching count. The SQL casts the
count to double precision for a decoded nonnegative integer wire field (the bounded
sandbox dataset fits exactly); it is not a driver bigint string. The dashboard's
20/50 page ceiling comes from this filtered count, not global stats or visited
cursor history. Counts do not supply arbitrary random-access anchors. See
`tests/ui/CursorPagination.md` for concurrent-arrival and bounded recovery semantics.
No result cache is used; HTTP replies use `Cache-Control: no-store`.

Detail exposes producer, persisted policy and allowlisted synthetic relations.
It never exposes ciphertext, fingerprints, tokens, private documents or arbitrary
payload previews. DB output is decoded with excess-property rejection, including
nested relations. No observation is inferred from lifecycle state: fake provider
ledger/observations require their separate app-owned adapter and explicit source.
Historical timeline, attempt history, progress and createdAt are unavailable.
`available_at <= dbNow` denotes due Pending/RetryScheduled rows, not guaranteed
execution; `lease_expires_at <= dbNow` identifies expiry candidates for Active,
not permission to recover/write. Neither lease values nor extra views are in
the frozen DTO. Likewise counters have no frozen public schema/port.

## Serial registrar proposals

These are integration requests, not applied shared changes:

1. Reconcile the app mapping with the authority/scenarios authors, then register
   `SchemaProposal.proposal(mapping)` through the app migration owner. It is
   NEVER called by runtime. Sandbox has `sandbox_id`, `generation`, `expires_at`;
   associations have `(sandbox_id,generation,job_id)` primary key, globally unique
   job reference/FK and `relations` JSONB. Relations must follow the frozen
   `ApplicationRelations` allowlist. Authority may add its credential-verifier
   fields; this read proposal does not implement credential storage/issuance.
   Association, producer job and receipt writes belong in the SAME producer
   transaction. Only the producer/authority authors write these tables.
2. Retain old association generations for receipt/retention coordination. Do not
   FK association generation to mutable current generation or reset by deleting
   jobs. Job references use restrictive deletion; app-owned cleanup must remove
   eligible references/receipts atomically. No generic cleanup bypass.
3. Add `JobsRead` to `Services.ts` using the adapter and native DB/cursor layers.
   Choose one app-owned client/pool, explicit validated table mapping, budgets
   and HMAC key custody. No new runtime dependency is required by this slice.
4. Register authenticated GET list/detail routes in `Routes.ts`, then call
   `HttpRead.handle(access, request, operation)`. Path matching, credential
   authentication and global rate limits belong to that owner. `access` is
   server-owned, not a body/query field. Parameters assert expected sandbox;
   duplicates/unknown parameters and unsupported methods are rejected. HTTP
   sanitizes defects but preserves interruption. Wire no public route beforehand.
5. Add `apps/website/tests/read/Read.test.ts` to the shared playground test script;
   the existing script only discovers contract tests. No shared config changed.
6. Future contract proposals: queue/version/producer tuple/failure-code filters,
   synthetic actor/order filters (user/tenant absent), exact ID list filtering,
   allowlisted stored-field sorts and bounded counters/due/expiry views. Current
   frozen list permits ONLY state/kind and ascending ID; exact ID is detail.
   New filters must bind signed cursors, use parameters and scoped associations.
   No full-text search or created timestamp is available. Do not silently expose
   historical requested filters through unregistered ad-hoc HTTP parameters.

Private `/jobs` local testing no longer has a lifetime100 association quota.
Public demo retains its independent 20,000-job bound. Existing association PK,
unique job FK, sandbox PK and library jobs PK support scoped lookup and pagination.
The historical seed harness measured 100 jobs per sandbox; those EXPLAIN results
are not a performance claim for larger local histories. Scale/index work requires
actual query plans rather than an assumed extra global index.

## Qualification

```sh
bun run playground:check
bun run playground:lint
bun x vitest run apps/website/tests/read/Read.test.ts packages/playground-contracts/tests
bun x oxfmt --config .oxfmtrc.json --check apps/website/src/server/read apps/website/tests/read apps/playground-worker/src/persistence/read
bun run playground:build
node apps/website/tests/read/QualifyPacked.mjs
```

Packed qualification copies exact app and private contract source into an
independent npm consumer, uses the immutable packed library (no source aliases),
checks packed/root dist equality, strict declarations, Node/Bun signed cursors,
mocked SQL/HTTP results and bundles. Each subprocess has a ten-minute deadline.
Receipts/logs/hashes live in `.toolchain/read/packed-*`. No packed backend peers
are installed. This does not qualify SQL execution or the native driver.

`apps/website/tests/read/PostgreSqlQualification.ts` exports `qualify` for an
explicitly authorized disposable PG connection and a fresh schema name. It
never reads env/DSNs, installs a driver or starts a database/container. It creates
seed tables within one rollback-only transaction, seeds 100 jobs in each of two
sandboxes, checks unique paging/scoping/detail/filter/DB expiry/generation and
returns an actual EXPLAIN plan. It refuses absent explicit disposable authorization.
Run only after the owner supplies permission and a connection. Real PostgreSQL,
seed/EXPLAIN, cross-connection races, CF/workerd/hosted runtime and registrar
integration remain NotTested until their actual dependencies are supplied.
