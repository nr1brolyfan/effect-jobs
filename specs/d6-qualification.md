# D6 pg exact-connection qualification (phase A)

This is a local qualification prototype, not the PostgreSQL backend/store.
No public exports, root dependencies, migrations or auth code are changed.
Phase B remains gated on coordinator consumption of this evidence.

## Frozen inputs and coverage

- Jobs base: `082fbcfecbf4835f5d6cdbeac24162f4da276e4c`;
  base tree: `b4e8852dc2cdb0e787390ba4b34ee4b98fa6faf0`.
- Fixture: `tests/qualification/d6-pg/`; exclusive document: this file.
- Driver `pg@8.23.0`, Effect `4.0.0`, `@types/pg@8.20.0`;
  fixture-local `bun.lock` pins transitive inputs.
- Node `24.15.0`, Bun `1.4.2`, Vitest `4.1.11`, TypeScript `7.0.2`,
  `@effect/tsgo@0.48.0`, oxlint `1.86.0`, oxfmt `0.71.0`.
- Real server: task-owned PostgreSQL `16.15`, image
  `sha256:bb3e1a57e5407e0a5280b4211980a5e537f4abd234a87014ac979849a78dd825`.
- Qualified coverage is only the concrete fixture pg manager and its bridge.
  Auth executor, Drizzle, and Effect SQL are **not runtime-qualified adapters**.
  Do not turn the fixture into a universal query-object constructor.

## Concrete contract and Layer composition

`ApplicationTransactions.source(pool)` captures a concrete `pg.Pool`. The
application owns its configuration, readiness, migrations and closing. Source
identity is object identity, not DSN equality, nor even Pool equality. A second
source wrapping the same Pool is foreign.

`ApplicationTransactions.transaction(source, callback)` is an application-owned
manager, not library code. It acquires one PoolClient, establishes BEGIN, and
registers a frozen handle in a private WeakMap. The registration binds source,
exact client, and active invocation lifetime. Its query closure can only use that
client; expired handles cannot query. Queries are sequenced by the caller.
Acquisition and controls are bounded by the application's pg timeouts. The
interruptible callback runs inside an uninterruptible acquire/control/release
boundary. The application manager rolls back failed, defective or interrupted
callbacks and owns commit/release. Failed/uncertain connections are destroyed
rather than reused. It never replays the business operation.

`PgBridge.ApplicationSource` is a Context service; `PgBridge.layerNoDeps` produces
`JobTransactions` and requires that service. Application composition is:

```ts
const integrationLayer = PgBridge.layerNoDeps.pipe(
  Layer.provide(Layer.succeed(PgBridge.ApplicationSource, applicationSource))
)
```

Construction is pure: zero pool borrows, workers, DDL or pool shutdown. A Layer
captures only the source/manager integration, never an invocation-lifetime handle.

`JobTransactions.join(handle, callback)` first checks the private manager
registration, exact source identity and active lifetime. Query-only objects,
foreign sources and inactive handles fail with `InvalidHandle`; no fallback
connection is borrowed. After validation, it calls the existing internal
`withJoinedTransaction` capability factory. The callback receives a fresh
`JobsTransaction`; definition enqueue uses that capability and the real
`PreparedJob`/codec seam. Callback exit invalidates it on success, typed failure,
defect and interruption. Nested callback lifetimes are independent. A capability
cannot be kept in an application-lifetime Layer. This is correctness for trusted
application code, not a sandbox or cryptographic authorization boundary.

`JobTransactions.withTransaction(callback)` delegates to the application
manager's `withTransaction`: a compatible active handle joins, an absent handle
establishes a transaction, and an incompatible active source is rejected. Joining
performs no BEGIN/savepoint, borrow, independent commit, replay or reconciliation.
The manager, not the bridge, decides whether establishment is needed. Callback
success is provisional until the outer owner commits. Values, typed errors,
defects, interruption and ordinary Context requirements remain caller-owned.

The internal capability constructor remains internal; the prototype is not a
public arbitrary-query adapter API. A future auth adapter must explicitly obtain
its actual source-bound active handle from the owning executor and prove this
same contract before claiming support. Merely supplying its public `query`
service or calling a nested SQL `withTransaction` is insufficient.

## Read-only auth mechanism analysis

Read committed files with `git show` at
`e22d1f250516c12a6aec21f8a3640955d9bd8ca7`, without changing auth:

- `src/server/postgresql/PostgreSqlExecutor.ts` re-exports the focused manager.
- `src/server/postgresql/PostgreSqlTransaction.ts` keeps invocation-local runtime
  services in Context References and compares `runtime.source === source`.
  `runNested` provides the already-owned transaction/connection services and
  executes the nested body directly: no nested SQL transaction wrapper/savepoint.
  The source-keyed transaction service exposes the actual current connection to
  `query`, not a newly borrowed client. The outer execution manages BEGIN,
  database timeouts, commit knowledge, rollback and release.
- `src/server/postgresql/PostgreSqlConnectionSource.ts` defines acquisition and
  release with a destroy flag; it is infrastructure, not a transaction proof.
- `src/server/drizzle-postgresql/PostgreSqlDrizzleJobProducer.ts` performs
  insert/deduplicate/compare and immutable payload insertion through the passed
  transaction query service. Its old structural query-only bridge and unscoped
  constructor are **not** adopted as D6 qualification evidence.

Important difference: the existing auth executor opens an independent operation
on a foreign active source. The fixture's explicit join contract rejects that
case instead of silently falling back. Auth's whole executor was not copied and
effect-jobs does not depend on effect-auth. This source analysis is not PG PASS
for the auth integration itself or its full retry/reconciliation policies.

## Real database fixtures and least privilege

Credentials are read in-process from the coordinator's private resource directory
and are never embedded in argv, output or committed files. Ownership is checked
against exact container ID
`68404a1de0f5646ec885d62351a2c7b981e5513347617b4974d4b51219d83c84`.
The fixture connects only to its published loopback endpoint, using the separately
provisioned `effect_jobs_d6` database. No other container environment is inspected.

The application setup creates only role `d6_fixture_runtime`, schema `d6_fixture`
and four relations: `invoices`, `jobs`, `job_payloads`, `operation_receipts`.
There are primary keys, producer tuple UNIQUE and payload/receipt foreign keys.
Real CHECK constraints inject failure separately at every insert boundary.
Runtime uses only the runtime login, with CONNECT, schema USAGE and table
SELECT/INSERT/UPDATE/DELETE. It has no superuser, CREATEDB, CREATEROLE, replication,
bypass-RLS, schema CREATE or TRUNCATE authority. Because PostgreSQL's default
PUBLIC TEMP grant otherwise permits temporary-table DDL, application setup
temporarily revokes **only that grant on the dedicated task database**, recording
whether it existed and restoring it at cleanup. Permanent and temporary CREATE
and TRUNCATE are tested with runtime login and must return `42501`.

Setup refuses existing role/schema names rather than resetting them. Cleanup
tracks which objects it actually created, closes both runtime pools, removes
only its schema/owned grants/role, restores its temporary privilege change and
verifies role/schema absence. The admin pool closes in finally. Container
lifecycle belongs to the coordinator and is preserved for dependent work.

## Behavioral evidence and negative controls

The finite suite checks:

- Actual test-process runtime and installed driver/Effect pins, plus server pin.
- Pure imports/construction/Layer scope; application pool remains usable.
- Invoice + real definition enqueue + encoded immutable payload + receipt commit
  together; exactly one borrow/BEGIN/COMMIT and no savepoint or DDL.
- Actual PG CHECK failures at invoice, jobs, payload and receipt insert boundaries
  roll back all prior writes; callback is invoked exactly once.
- Failure after receipt insertion rolls everything back and preserves the exact
  caller error. A semantic duplicate returns the original job ID and leaves
  first policy/payload bytes unchanged; conflicting payload rolls back parent.
- Compatible outer transaction sees the same handle and server PID, no inner
  control statements, and no extra borrow. Inner success remains invisible to an
  independent observer; outer rejection rolls back all four rows.
- Foreign source (even same Pool), query-only handle and inactive handle reject
  without borrowing. Expired capabilities reject without SQL on all four exit
  channels. Nested capability lifetime does not revoke another active callback.
- Interruption after all four writes rolls back through the application manager,
  retaining interruption and invalidating the capability.
- Before-send and after-durable-COMMIT response fault injection yields Unknown,
  one callback invocation and exactly seven manager SQL statements with no
  reconciliation queries. Independent reads confirm no rows before send and all
  four rows after durable commit. No bridge replay or response reconciliation.
- Negative control deliberately runs an independently scoped same-DSN operation:
  different server PID, job/payload committed while invoice rolls back. This
  proves DSN matching is insufficient, rather than only asserting source equality.
- Held single-slot pool fails acquisition within the 500 ms connection bound,
  leaves no waiters and remains usable afterwards; no hidden DDL/worker startup.
- Invalid runtime credentials fail bounded application readiness without BEGIN,
  invoking the callback or retaining a waiter. This negative pool is also closed
  by the application.

Fault injection deliberately discards responses at the application manager's
commit boundary. It is not a TCP proxy, actual server crash, or exhaustive pg
network-fault qualification. SQL counters cover the manager path; application
setup, observers and explicit privilege checks are separate and excluded.

The insert/compare implementation is deliberately fixture-local and minimal.
It does not qualify the eventual complete D7 schema, availability, worker claims,
leases/fencing, recovery, cleanup, concurrent producer races, arbitrary catalogs,
custom mappings or installed backend exports. Those are phase-B gates. No
production backend support or publication is claimed by this phase.

## Reproduction and gates

Use pinned Node/Bun, put Node 24.15.0 on PATH for repository tools, and run
serially: the two runtimes share this task's exclusive fixture names.

```sh
timeout 60s bun install --frozen-lockfile
(cd tests/qualification/d6-pg && timeout 60s bun install --frozen-lockfile)
export D6_RESOURCE_DIRECTORY=/path/to/coordinator-private-resource-directory
export D6_EXPECT_RUNTIME=node
timeout 180s node node_modules/vitest/vitest.mjs run tests/qualification/d6-pg/qualification.test.ts --reporter=verbose
export D6_EXPECT_RUNTIME=bun
timeout 180s bun --bun node_modules/vitest/vitest.mjs run tests/qualification/d6-pg/qualification.test.ts --reporter=verbose
timeout 180s bun run check
timeout 180s bun run lint
timeout 60s bun run format:check
timeout 180s bun run build
```

Optional `D6_EVIDENCE_FILE` writes a sanitized runtime/server/pins, SQL-count,
physical-PID and cleanup receipt. Never set it to a credentials file. No PG env
means this optional suite is skipped by unrelated root runs; that is NotTested,
not PASS. `D6_EXPECT_RUNTIME` is mandatory for actual qualification so the Bun
runner cannot silently execute tests under Node.

Final receipts report each gate separately. Unchanged historical core/worker
runtime matrices are not repeated. Any failed root gate remains a push blocker;
do not edit coordinator-owned/shared files or weaken checks to conceal it.

## Documentation read manifest

All 16 files were read before implementation:

- `ai-docs/README.md`
- `ai-docs/tsconfig.json`
- `ai-docs/src/index.md`
- `ai-docs/src/01_services/10_services-and-layers.ts`
- `ai-docs/src/01_services/20_module-consumption.ts`
- `ai-docs/src/01_services/30_layer-composition.ts`
- `ai-docs/src/02_modeling/10_schema-tagged-match.ts`
- `ai-docs/src/03_errors/10_errors-and-causes.ts`
- `ai-docs/src/04_observability/10_operation-observability.ts`
- `ai-docs/src/05_resources/10_resources-interruption-secrets.ts`
- `ai-docs/src/06_persistence/10_mutation-boundaries.ts`
- `ai-docs/src/07_transport/10_wire-errors.ts`
- `ai-docs/src/08_style/10_visible-code-and-modules.ts`
- `ai-docs/src/09_testing/10_testing-and-review.ts`
- `ai-docs/src/10_boundaries/10_external-time-regex.ts`
- `ai-docs/src/fixtures/Auth.ts`

Also read canonical UPVE-1020, active UPVE-860 and its empty thread scan,
UPVE-1032 and both named owner-authorization threads, repository
`specs/multica-workflow.md`, all accepted architecture decisions, root package
and TypeScript configuration, core transaction/definition/codec seams and the
committed auth reference files listed above. No AGENTS.md exists in this clean
repository checkout; the user's global Conventional Commits instruction applies.
