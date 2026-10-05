# PostgreSQL backend — qualification and integration

PR #6 was integrated at `0525adda1384788124b273ea5ee8eac17c40413a` after its
completed original review set. The phase-B integration-blocked statements and
receipts below describe their historical snapshots. Current Drizzle dependency
compatibility qualification is recorded separately in
[drizzle-compatibility.md](./drizzle-compatibility.md); it preserves those receipts
and does not restart their review or qualify arbitrary transaction adapters.

## Public module boundaries

- `PostgreSqlJobs`: `make(options)` / `layerNoDeps(options)` produce
  `PostgreSqlJobs` and require `PostgreSqlApplication`. The value exposes an
  explicit `ready` Effect, the generic `store`, optional separately selected
  `cleanup`, `joinTransaction(handle, callback)` and `withTransaction(callback)`.
- `PostgreSqlTransaction`: the trusted application-adapter extension contract,
  exact-connection `TransactionQuery`, and sanitized backend errors. This is **not**
  a structural query-only transaction constructor or a supplied transaction engine.
- `PostgreSqlSchema`: validated storage mapping and explicit application migration
  DDL. Runtime never invokes that DDL or creates a schema.
- `PostgreSqlDrizzleSchema`: optional, migration-only Drizzle declarations.
  Neither core nor the PostgreSQL runtime imports Drizzle. These declarations do
  **not** qualify a Drizzle transaction adapter.

Construction performs no SQL, readiness, DDL, pool allocation/closing, worker
startup or maintenance. Applications invoke readiness/maintenance and explicitly
compose workers. Ordinary caller Effect value/error/environment/interruption
channels pass through the callback bridge. Enqueue results are provisional until
the application owner commits.

The root package now registers these four exports and the optional exact Drizzle
peer. Shared registrars remain coordinator-owned. Their earlier missing state
in the historical receipts below is not the current package configuration.

## Explicit application adapter contract

`PostgreSqlApplication` contains `validate`, `withTransaction` and
`ownedTransaction`. An implementation must prove source identity, private handle
registration, exact active connection and invocation lifetime before returning a
query capability. DSN equality and the presence of a query method prove nothing.
Queries sharing a transaction are sequenced. Revalidate lifetime before each
query; never silently borrow another connection for a joined handle.

`withTransaction` delegates join-or-establish to the application manager. A joined
producer does no BEGIN/savepoint/COMMIT/ROLLBACK, business replay or independent
reconciliation. The internal capability factory invalidates jobs capabilities on
all callback exit channels; it is not publicly exported.

Worker/cleanup operations use `ownedTransaction`, whose success must mean its
durable commit was acknowledged. It must reject any ambient transaction rather
than report provisional joined mutations as committed. The application owns
acquisition, rollback, connection destruction/release and finite control/query
timeouts. Uncertain COMMIT or response delivery is `PostgreSqlFailure` with
`commitKnowledge: "Unknown"`; never automatically replay the callback. Adapter
failures must not contain SQL, parameters, DSNs or provider Causes.

The phase-B fixture adapts the retained concrete `pg@8.23.0` application manager.
It reads that manager's actual ambient handle for the owned-operation guard.
The phase-A receipt remains evidence for its historical snapshot only; phase A
was not rerun for confirmation. Phase B qualified the new guard and the final
fixture-manager delta rejecting a COMMIT command tag of ROLLBACK on real PG.
No auth, Effect SQL or Drizzle transaction adapter is claimed.

READ COMMITTED is required for producer conflict comparison: the statement after
`INSERT ... ON CONFLICT DO NOTHING` must see the committed winner. A concurrent
cleanup may remove old evidence; that is conservatively an integrity conflict,
not permission to recreate a missing row within the same business operation.

## Storage and producer semantics

Names are bounded, validated lowercase PostgreSQL identifiers. Defaults are
`public.jobs` and `public.job_payloads`; namespace and relation names are
configurable, arbitrary column remapping is not. Applications create their
namespace, generate/run migrations, own privileges, and own pool lifetime.

`jobs` persists generated ID, producer tuple, queue/kind/version, complete first
policy, optional initial availability, mutable lifecycle and lease/fencing fields.
`job_payloads` persists immutable format version, payload and canonical semantic
projection with a primary-key foreign key and ON DELETE CASCADE. Backend lifecycle
writes never rewrite payload, catalog, producer or first policy/initial envelope.
PK, global producer tuple UNIQUE and unique live lease tokens are structural
requirements. Due, expiry and terminal-cleanup partial indexes are provided.
Index names retain a bounded hash of the full configured table name to avoid
PostgreSQL truncating away its distinguishing suffix.

IDs are generated only by the library. A semantic duplicate compares catalog,
payload format and canonical projection bytes, including protected fingerprints;
it returns the first ID without changing policy, availability or randomized
ciphertext. Changed content is `JobIntegrityConflict`. A genuine same-connection
PostgreSQL error additionally aborts the producer transaction, so catching that
typed error cannot commit preceding domain writes. An application manager must
also classify a COMMIT command tag of ROLLBACK as a NotCommitted failure rather
than advertise successful business commit. The final fixture regression passed
both durable rollback and that response classification on Node and Bun.

Omitted availability uses a genuine server-time sample. Supplied availability
is persisted separately as the immutable initial envelope field. Due eligibility
uses `available_at <= dbNow`; rescheduled availability is lifecycle state.

## Lifecycle, unknown outcomes and cleanup

The store delegates plans to the existing validated `JobLifecycle` functions;
SQL locks the parent before owned transitions and commits the complete plan.
Claims filter the caller's registered queue/kind/version tuples and use
`FOR UPDATE OF j SKIP LOCKED`. Claims and recovery have finite row bounds and no
handler invocation. Fixed leases are never renewed; attempts and stalls preserve
the accepted existing protocol. Finalization compares the exact frozen pre-write
snapshot as well as token/version/expiry. Inputs are copied before async work.

One DB-time snapshot governs each transition; owned writes sample after locking
the row. Claims sample before non-waiting SKIP LOCKED selection and perform one
post-commit DB-time check before exposing a usable lease. A response consuming its
reserve returns Unknown for original-token reconciliation, not a second claim.
Configured response budget is positive and must agree with the worker's budget.

Claim/release/finalization uncertain commits return tagged Unknown. Reconciliation
reads the original token or exact finalization evidence once; it neither invokes
handlers nor replays writes. The existing worker owns its bounded reconciliation
policy. The number-only recovery/cleanup core ports cannot express an Unknown
count: they fail with explicit Unknown commit knowledge, never fabricate zero or
retry internally. Applications must not blindly replay these maintenance calls.

Malformed snapshot rows are isolated in a bounded locked operation, never repaired
into an executable payload. Encoded artifacts remain untrusted until the worker's
existing structure/codec checks; malformed payloads can be fenced to Isolated.
An incompatible stored lease/budget is not dispatched. Both cases remove a poison
head row from scheduling without claiming to have handled its payload.

`cleanup_at` is a derived scheduling index, not a generic retention hold. Confirmed
Completed/Dead transitions derive it from their persisted policy; Forever or
unrepresentable expiry has no automatic cleanup timestamp. Cleanup selects a
bounded due terminal batch, validates policy/snapshot again under the parent lock,
and deletes only eligible parents (payloads cascade). Pending/Active/Isolated are
never candidates. Domain references still require an application-selected cleanup
adapter; this generic port is neither installed nor executed automatically.

Readiness is explicit, bounded introspection of only the configured relations:
required columns, PK/UNIQUE/FK/cascade and valid partial indexes. It does not run
DDL or claim to audit every application migration/data constraint. The readiness
correction passed the recovered-resource phase-B runs on both runtimes.

## Historical phase-B qualification and integration blockers

On `2026-10-05T15:56Z`, the current production source and final COMMIT-tag manager
passed **27/27 on Node 24.15.0 and 27/27 on Bun 1.4.2**, against PostgreSQL 16.15,
pg 8.23.0 and Effect 4.0.0. Each run includes 25 production-backend real-PG tests
and 2 optional Drizzle declaration tests; no PG tests skipped. Existing tests
already covered retry-notAfter and lease-reserve equality and +/-1 ms neighbors;
they were not reimplemented. The only test-code continuation change pins the
new coordinator-authorized exact container ID. Phase A was not rerun.

Both sanitized receipts confirm zero remaining fixture schemas/roles, restored
TEMP, zero runtime DDL and zero savepoints. Runtime fixture objects remain limited
to `effect_jobs_d6.backend_fixture` and `backend_fixture_runtime`. The coordinator
owns container `6afbcddb555e2b546b0b6783a2196e9d8efae6f23950800b2ad1738117217526`,
loopback port 59465, deadline `2026-10-05T19:28:03.993972Z`. Author PG use ended
after the two synchronous test runs; no container lifecycle action was performed.

Fixture types and root lint passed. Current root check/build **FAIL** because
root Drizzle resolution is missing and build `types: []` excludes Node types.
No shared files were edited, and failed build output is not a qualified installed
artifact. Root exports/optional peer/lock/Node build types and fixture/installed
gate registration remain coordinator prerequisites. No push or PR is permitted
until these shared changes and the final integrated local gates pass.

Current logs, sanitized runtime/time-boundary evidence and a byte-bound receipt
are retained in `tests/postgresql/artifacts/`. Historical matrices below remain
historical only; current evidence does not rewrite phase A.

### Preserved earlier qualification history

The exploratory Node run at approximately `2026-10-05T10:51Z` exercised production
source modules against real PostgreSQL 16.15: **22 passed, 2 failed, overall FAIL**.
Failures were a mistaken Drizzle check-count assertion and readiness receiving
`name[]` rather than `text[]`. Those were corrected; the pending runtime rerun
could not connect because the coordinator container was stopped at `11:03:11Z`.
Do not attribute those 22 intermediate passes to final checkpoint bytes. Earlier
exploratory runs also exposed and fixed duplicate pg module identity and the
server-version packaging suffix assertion. No intermediate failed run is a gate
PASS.

The coordinator recovered the exact same label/image-verified resource at
`11:28Z`, recorded readiness and updated its private loopback port mapping. The
expanded phase-B suite then passed **27/27 on Node and 27/27 on Bun** at about
`11:30Z`: 25 production-backend real-PG tests plus 2 Drizzle declaration tests.
Receipts include exact actual DB-time equality and +/-1 ms neighbors for due,
owned expiry, recovery expiry, lease reserve and retry-notAfter. Both runs
confirmed zero remaining fixture schemas/roles, restored TEMP, zero runtime DDL
and zero savepoints. This did not repeat phase A.

Those historical results precede the last fixture-manager COMMIT-tag correction. Its affected
rerun at `11:37Z` failed before setup with ECONNREFUSED; Docker/WSL integration was
also unavailable. No final PASS is claimed for that delta. Historical phase-B
receipts are explicitly named `*-before-commit-tag-*`; the failed final attempt
has its own log. Root check/build still fail on coordinator-owned peer/Node-type
registration, and installed-artifact gates remain unqualified.

The expanded tests cover atomic invoice/job/payload/receipt writes and real CHECK
failures, concurrent duplicate/conflict producers, protected equality, actual held
row SKIP LOCKED, due equality/neighbors, genuine expiry equality/neighbors,
attempt/stall limits, durable delays, artifact isolation, bounded pool exhaustion,
owned-operation rejection, interruption and before/after COMMIT response faults.
Due boundary fixture DML occurs after a genuine production server-time read;
expiry tests observe actual clock results in a finite 90-operation budget without
replacing SQL/time. No timing neighbor is skipped or passed if unobserved.
COMMIT faults are bounded application-manager injection around actual transactions,
**not** network proxy/server-crash qualification. The pure core protocol is
unchanged. Installed backend exports and Drizzle-generated migration execution
are not yet qualified.

The exact container is coordinator-owned; it was only inspected, not started,
stopped, removed or replaced by this author. Author fixtures use only
`effect_jobs_d6`, schema `backend_fixture`, role `backend_fixture_runtime` and
four owned relations. Runtime has CONNECT/USAGE/DML, no admin/CREATE/TRUNCATE/TEMP.
Setup tracks objects and PUBLIC TEMP changes, closes application pools, removes
only owned fixtures, and restores TEMP in cleanup. Prior completed exploratory
PG runs reached cleanup, including both recovered-resource 27/27 runs. Failed
connection attempts created no new fixture objects; they cannot certify server
state while the container is offline.

Remaining coordinator prerequisites:

1. Register exports for the four public PostgreSql modules, preserving core's
   backend-peer-free graph. Add optional `drizzle-orm@0.45.1` peer metadata and
   pinned development dependency/lock needed for root type/build/test resolution.
   The current build config excludes Node types: enable its already-pinned Node
   declarations for backend `node:crypto`/`node:buffer` imports, or agree a separate
   backend build project. Production runtime has no direct `pg` import;
   applications own that driver.
2. Integrate fixture qualification commands/installed-artifact checks through the
   coordinator-owned registrars. Fixture-local aliases are not a replacement for
   root/package integration. Complete final local gates before any authorized push.
3. Preserve the final source/fixture receipts and historical matrices. The final
   COMMIT-tag regression is now qualified; do not dispatch confirmation-only work.
   Run affected integrated gates on exact shared configuration/artifact bytes,
   then the coordinator chooses the single frozen review set. No author dispatch.

## Finite reproduction

Use the pinned Node 24.15.0 and Bun 1.4.2 runtimes; fixture pins pg 8.23.0,
@types/pg 8.20.0 and Drizzle 0.45.1. Root retains Effect 4.0.0 and its existing
toolchain pins. No global/system installation is needed.

```sh
# Fixture directory: tests/postgresql
timeout 60s bun install --frozen-lockfile
# Repository directory; fixture-local paths are for isolated type qualification.
timeout 180s node_modules/.bin/tsc --project tests/postgresql/tsconfig.json --noEmit
timeout 180s node node_modules/vitest/vitest.mjs run --config tests/postgresql/vitest.config.ts --reporter=verbose
timeout 180s bun --bun node_modules/vitest/vitest.mjs run --config tests/postgresql/vitest.config.ts --reporter=verbose
```

Real PG requires `D6_RESOURCE_DIRECTORY` naming the coordinator's private directory,
`PG_EXPECT_RUNTIME=node|bun` and optionally `PG_EVIDENCE_FILE` for a sanitized
receipt. Never print credentials, pass them in argv, or attach their file.
Without PG configuration the backend suite is skipped: **NotTested, not PASS**.
Run runtimes serially because fixture object names are exclusive. Root check,
lint, format:check, build, required script guards and installed checks remain
separate mandatory gates after shared integration.

## Documentation read manifest

All 16 files were read recursively before phase-B implementation, including
documents, examples and configuration:

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

Also read current UPVE-860, its required thread scan and phase-A report thread,
canonical UPVE-1020, `specs/multica-workflow.md`, all accepted
`specs/architecture-decisions.md`, `specs/d6-qualification.md`, retained phase-A
receipt, package/TypeScript configuration, core definition/transaction/store/
lifecycle/worker/reconciliation/codec seams and resource ownership metadata.
There is no repository AGENTS.md in this retained worktree; global Conventional
Commits instructions apply. No auth source or another project's resources were
written. The stopped-resource blocker was read after the runtime restart without
repeating completed phase-A work.
