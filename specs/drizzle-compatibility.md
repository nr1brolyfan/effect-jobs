# Effect-native Drizzle compatibility

This qualification targets exactly `drizzle-orm@1.0.0-rc.5-169397b`,
`effect@4.0.0` and the compatible native peer `@effect/sql-pg@4.0.0`, on
Node 24.15.0, Bun 1.4.2 and PostgreSQL 16.15. The owner accepted this dependency
direction in UPVE-1032; UPVE-1165 owns its isolated compatibility qualification.
The coordinator's prepared package/lock changes are part of the tested inputs.
The existing production schema and backend need no runtime changes for this pin.

## Actual driver and application bridge

`drizzle-orm/effect-postgres.makeWithDefaults` requires the native `PgClient`
service. It creates a session using that client; queries are Effects, executed
through `client.unsafe(...).values`, `.withoutTransform` or `.raw`. The session
wraps a transaction callback in `client.withTransaction`. A nested Drizzle
transaction delegates to the session again: native Effect SQL emits a savepoint.
The executable negative control confirms this on the real server.

The qualification application registrar captures the exact connection published
by **that client's** `transactionService`, inside its owning callback. A private
WeakMap binds an opaque handle to source object, connection and active lifetime.
`PostgreSqlJobs.joinTransaction` validates that registration and executes through
the captured connection. It neither borrows nor calls another native transaction
wrapper. A separate registrar around the same client is foreign. A Drizzle
transaction object or structural query object alone is unqualified.

Native raw int8 results are bigint. The application query adapter converts those
top-level values to exact decimal strings, preserving the existing backend row
contract and its bounds validation. It does not convert arbitrary int8 directly
to potentially rounded JavaScript numbers. Drizzle's own query mapper handles
the declared number-mode bigint columns. The existing custom bytea codec accepts
the native Uint8Array result and copies it; its Buffer parameter encoding and
binary bytes including zero and values above 127 round-trip on both runtimes.

Native SQL control failures can occur as defects because Effect SQL uses `orDie`
at the control boundary. Native COMMIT checks its actual command tag and rejects
ROLLBACK. The fixture sanitizes recognized SQL provider reasons to bounded
`PostgreSqlFailure`, conservatively Unknown for controls, and recognized Drizzle
query failures to NotCommitted. Caller errors, defects, interruption and other
reasons in mixed Causes remain caller-owned. It performs no retry or independent
receipt reconciliation. The outer application manager owns durable commit.

This is a concrete qualification application, **not a shipped universal native
Drizzle adapter**. Applications must supply their actual registered capability
and the complete documented application adapter contract. The probe does not
qualify auth's executor, arbitrary native SQL configurations, other native driver
versions, independent foreign unregistered transaction managers, concurrent
operations on one connection, or exhaustive native control/network fault recovery.
It adds no public constructor or changes to the core capability, lifecycle,
worker, codecs, migrations, pool ownership or accepted D1–D8 decisions.

## Executable qualification

From the repository, with the private resource directory in
`D6_RESOURCE_DIRECTORY` and the pinned runtimes on PATH:

```sh
timeout 60s bun install --frozen-lockfile
# Run each fixture install in its directory, also with --frozen-lockfile.
timeout 300s bun run build
export EFFECT_JOBS_ARCHIVE=/path/to/immutable-versioned-effect-jobs.tgz
timeout 300s node tests/qualification/drizzle-native/Run.mjs
timeout 600s bun run verify
timeout 300s bun run check:postgresql
timeout 300s bun run test:postgresql:node
timeout 300s bun run test:postgresql:bun
timeout 600s bun run qualify:postgresql:installed
```

The release runner consumes the immutable `EFFECT_JOBS_ARCHIVE`, creates a fresh
independent consumer, and installs that same archive with npm's normal peer resolver alongside
the exact pins. It uses no force or legacy-peer-deps. It retains a lockfile,
archive hash, root manifest hash, logs, consumer declarations and sanitized
runtime receipts. Each child command is foreground and bounded to 60 seconds.
It compiles the `.mts` fixture inside that consumer, outside the repository's
core-only TypeScript include set; no native optional peer becomes a root
development requirement. The runner prepares an ignored fixture-local dependency
link for subsequent repository lint in a fresh checkout. All public exports are typechecked and imported on
Node and Bun. Existing installed qualification separately proves imports without
pg/Drizzle peers and strict non-Drizzle backend declarations.

The 17 native assertions per runtime cover:

- Native Drizzle domain + production enqueue/job/payload + receipt atomic commit.
- Duplicate equality, original durable evidence and caught integrity conflict
  causing actual outer COMMIT rejection, with one callback invocation.
- Caller Context requirements and custom binary bytea read/write round trips.
- Real CHECK failures at each of the four insertion boundaries, with zero
  remaining writes and sanitized provider failures.
- Matching physical backend PID, zero extra joined control statements, inner
  success invisible to an independent observer and outer rejection rollback.
- A real nested Drizzle savepoint as the negative control.
- Private registration, foreign source, inactive handles and owned-operation
  rejection inside an active native transaction.
- Escaped capability rejection after success/failure/defect/interruption and
  interruption after all four writes rolling back the complete operation.

The original compatibility source PostgreSQL matrix passed 27 tests per runtime;
installed production qualification passed 25 real-PG tests per runtime. The alpha
release adds a public worker pipeline and records its larger final counts separately. The root test gate passes
388 tests with 47 optional PG tests skipped when it has no PG environment; those
skips are NotTested in that invocation. The explicit source and installed gates
above supply the required real-PG evidence. Historical D6 receipts remain tied to
their original snapshots and were not rerun for confirmation.

## Declaration limits and reproducibility

Consumer declarations pass with `skipLibCheck: true`, matching the repository's
existing Drizzle setting. The runner also executes the full upstream declaration
check with `skipLibCheck: false` and retains its **failure**, rather than claiming
complete declaration compatibility. In this version Drizzle still imports the
removed `effect/unstable/sql/SqlError` path; policy/role declarations also fail
exact optional property checks. The fixture restores only the transaction
function's error declaration to the actual pinned native `SqlError` at its
explicit typed invocation boundary. It does not patch installed dependencies or
hide that full upstream checking failed. Intentionally version-pinned unstable
SQL API warnings are documented and disabled only in these two qualification
modules; any/unknown Effect-channel diagnostics remain enabled.

The initial fresh-worktree `verify` failed lint before build because an existing
portable codec smoke imports absent `dist` declarations. Building first resolves
that bootstrap issue; the subsequent complete `verify` passes. No shared test,
manifest, root registrar or lint policy was changed to make it pass.

The fixtures verify the exact task-owned container and deadline before use.
Native objects use only the `drizzle_native` schema and `drizzle_native_runtime`
role in `effect_jobs_d6`; application setup owns DDL and runtime uses its separate
login. Native client scopes and observer/admin pools close in finally, and both
runtime receipts confirm zero remaining fixture schemas and roles. Existing
backend fixtures run serially. Container lifecycle stays with the coordinator.
Credentials are read only in-process and are absent from argv, Git and receipts.

No unresolved architecture decision or additional package dependency is needed
for the qualified schema and producer path. The coordinator may register the
new runner as a shared CI/package gate; that registry is outside author ownership.
Publication, deployment, push, PR, merge and review dispatch remain outside this
author's scope. Final exact Git and artifact receipts accompany the issue handoff.

## Documentation read manifest

All 16 recursive ai-docs files were read before implementation:

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

Also read canonical UPVE-1020, assigned issue and required empty thread scan,
the owner's parent decision thread, `specs/multica-workflow.md`, accepted
`specs/architecture-decisions.md`, `specs/core-contract.md`,
`specs/postgresql-backend.md`, `specs/d6-qualification.md`, current manifests,
TypeScript configuration, production schema/producer/transaction seams, retained
application-manager fixture, installed gate and actual installed Drizzle/native
driver/codecs/Effect SQL transaction implementations. The author worktree has no
repository-owned AGENTS.md. No auth repository or issue was written.
