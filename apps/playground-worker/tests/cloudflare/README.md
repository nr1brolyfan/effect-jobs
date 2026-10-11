# Cloudflare feasibility checkpoint

## Real PostgreSQL continuation (2026-10-11)

The corrected `cf-real` fixture passed the actual packed-library program on
Node 24.15.0, Bun 1.4.2 and local workerd 1.20261006.1 with PostgreSQL 16.15.
Workerd ran in a native Durable Object with `nodejs_compat`, local Hyperdrive
and native alarms. All three executions asserted same-client pid/xid identity
for domain/job/receipt commit and rollback, no-active rejection, concurrent
matching/conflicting dedup, DB-time delayed/retry eligibility, fixed lease
expiry, bounded recovery, stale-owner fencing, interruption during real SQL,
rollback/client reuse and finite wake/drain with persisted completion.
Node and Bun cleanup each observed zero remaining database sessions; Miniflare
was disposed, the exact owned container was removed and its absence verified.
Hosted Cloudflare/Hyperdrive, CPU, server crash and network loss remain NotTested.
This qualifies the tested local path, not the production executor or Alchemy
callback integration.

The new finite stage started at 20:08:19 UTC with deadline 20:53:19 UTC.
The resource gates ran at 20:10:03–20:10:18 UTC, including foreground cleanup.
Exact attempted source bytes were archived before execution. The unchanged
packed artifact SHA-256 is
`316c8eb36d7313af3e53231ac6a99c74a691839a382e1b3701bd5d9674c46fa1`.
The attached corrected qualification evidence includes source snapshots, the
consumer lock, runner, assertion receipts, runtime pins and cleanup evidence.
Historical reviews, accepted fixes and unaffected matrices were not repeated.

### Preserved first-attempt diagnosis

The original checkpoint below remains historical. The owner subsequently
authorized one disposable local PostgreSQL container. Docker 29.4.0 was available;
the task used PostgreSQL 16.15 Alpine pinned to digest
`sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`,
loopback-only random port and container-owned tmpfs storage. No existing database,
container, volume or secret was used.

The first qualification attempt failed in fixture construction:
`Queue.make("cf_real")` rejects the underscore. Both Node and Bun reported
`InvalidJobQueue`; neither completed the guarantee checks, and the real-PG
workerd phase did not start. The owned container and generated private config
were removed in foreground `finally`, including exact-ID absence readback.
This is a fixture failure, not a PostgreSQL or Workers incompatibility finding.

`RealPgProbe.mjs` now uses the valid `cf-real` name. It contains the common
packed-library program for same-client connection/xid evidence (including an
application-owned insertion audit trigger), domain/job/receipt commit and
rollback, concurrent deduplication, genuine delayed/retry/lease expiry,
stale-owner rejection, interruption during SQL and actual finite wake/drain.
`RealPgHarness.mjs` owns disposable fixture migrations and Node/Bun pool cleanup;
`RealPgWorker.mjs` runs the same program in a native Durable Object through a
local Hyperdrive binding and native alarms. Before the corrected continuation,
these probes had syntax, format, focused lint and bundle evidence only.

The owner clarified that one container is a concurrency/ownership limit, and
authorized bounded replacement after verified cleanup. The first attempt's
19:38:53 UTC deadline belongs to that expired attempt. Resource use still needs
task-local authorization and a finite stage; generated credentials must never
be included in argv, logs or attachments. This README does not authorize resources.

Local Hyperdrive passes connections to the supplied local database and does not
exercise hosted connection pooling or caching. See the
[official local development documentation](https://developers.cloudflare.com/hyperdrive/configuration/local-development/).
Hosted CF, hosted Hyperdrive, CPU, server crash and network loss remain NotTested.

## Original checkpoint

This is a local feasibility PoC, not a wired playground executor or a Cloudflare
PostgreSQL support guarantee. The library, shared contracts and registrars stay
unchanged. PostgreSQL remains the sole job authority. Durable Object storage is
used only for wake hints in the disposable probe; it is not a jobs backend.

## Reproduce

Use Node 24.15.0 and Bun 1.4.2 with the frozen foundation setup. Build the library
before packing and refresh the workspace's `file:` dependency copy after build:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
bun install --frozen-lockfile --ignore-scripts --force
bun run playground:build
bun run playground:check
bun run playground:lint
node node_modules/vitest/vitest.mjs run apps/playground-worker/tests/cloudflare/WakeCycle.test.ts
node apps/playground-worker/tests/cloudflare/Run.mjs
```

The runner packs the library into a new immutable archive, installs an independent
consumer outside the repository ancestry, checks exported JS byte equality,
strictly typechecks the actual copied app/probe sources with `skipLibCheck:false`,
bundles them and executes them in local workerd. It retains logs, dependency lock,
archive and a hash-bound receipt under ignored `.toolchain/cloudflare/run-*`.
Probe-only `.mts.txt` files follow the repository's installed-consumer fixture
pattern: they are copied to `.mts` in that isolated consumer, not compiled against
workspace aliases or multiple incompatible library instances. The module mapping
uses Cloudflare's official importable declarations, without combining Workers
and Node global declarations. It is not a deployment typing configuration.
Each subprocess has at most ten minutes, the invocation at most 45 minutes.
The process awaits every result and disposes Miniflare; no service survives it.

Pins: Effect / @effect/sql-pg 4.0.0, pg 8.23.0, Drizzle
1.0.0-rc.5-169397b, Miniflare 5.20261006.1-alpha (workerd 1.20261006.1),
esbuild 0.25.12, @cloudflare/workers-types 5.20261011.1,
TypeScript 7.0.2, @types/node 26.4.1 and @types/pg 8.20.0.
Compatibility date is 2026-10-01 with `nodejs_compat`. Optional pg's CommonJS
bundle needs a `node:module` createRequire bridge with a synthetic absolute
filename; workerd does not supply `import.meta.url` for this inline module.
The bridge resolves Node builtins, not workspace packages or a database.

## What the checks prove

- The packed native PostgreSql adapter and actual scoped PgClient construct in
  workerd. An actual definition's ambient enqueue fails with transaction-required
  / NotCommitted without an active transaction, before any connection/SQL.
  The zero-minimum pool uses a synthetic, never-connected URL; no private DSN is read.
- The library's actual finite drain executes in a native Durable Object against
  an explicitly mocked empty store; real native storage receives an alarm.
  This is not a real PostgreSQL claim, recovery, handler or finalization test.
- Separate optional pg and native Drizzle imports execute on Node and workerd.
  They perform no SQL. Import success is not driver or transaction qualification.
- Eight app tests cover expiry without work, delayed eligibility after an Idle
  drain, lease-recovery hints, uncertainty backoff (including already-due hints),
  finite activation shutdown, admission bounds, timeout and interruption with
  scope cleanup and a prearmed repair hint. Their store is a labeled mock.

Real PostgreSQL atomic commit/rollback of domain+job+receipt on one connection,
same-client xid identity, dedup races, delayed/retry/recovery execution,
interruption during SQL/COMMIT, native network cleanup and connection/control
timeouts are **NotTested on workerd**. Existing library receipts remain historical
evidence for their exact original environments; they are not CF receipts.
Hosted Hyperdrive, CPU consumption, server crash/network loss and deployment are
also NotTested. No existing DB/container is accessed or changed by these commands.

## Wake and lifetime integration

`src/cloudflare/WakeCycle.ts` consumes one validated DB-relative schedule snapshot,
prearms a repair wake, awaits one library drain and schedules due/backlog/recovery
work. It never renews a lease or writes lifecycle SQL. Bounds are two local
executions, ten started claims, ten recovery candidates and a cooperative
five-second event deadline. This is not a measured CPU cap; synchronous CPU work
and uninterruptible native cleanup cannot be preempted by an Effect timeout.
Handlers and native acquisition/control/release need their own qualified bounds.

`WakeSchedule.read` is an app-owned read-only port, not implemented PG storage.
Its adapter must scope the authorized queue/catalog/shard and sandbox generation,
check authority expiry with DB time, and compute due/lease/expiry relative delays
from one snapshot (clamped to one hour). Empty claim results cannot discover
future jobs, so Idle must still schedule the earliest due/expired-lease hint.
Backoff takes precedence over already-due hints to avoid a hot alarm loop.
The host serializes awaited cycles per object, and creates/closes the native pool
in each event's Scope; do not retain request-created sockets across alarm events.
Reset/expiry result writes require the executor's app transaction fencing.

Repair hints run at most every 30 seconds only during an admitted finite
activation; expiry clears the alarm. These are bounded maintenance events, not an
unbounded polling fiber. There is a producer/DO dual-write gap: a PG commit does
not atomically install an alarm. A producer sends a wake only after acknowledged
commit. A separately authorized periodic repair enumerates active finite shards
from PG and rearms missed wakes, with a bounded scan/cursor and billing budget.
If the object was never armed or all alarm retries fail, this outside repair is
required. Neither callback persistence nor this prototype eliminates that gap.

## Alchemy ownership and registrar proposals

Alchemy 2.0.0-beta.81 source and exported `makeCallback` were inspected in a
disposable installation; no stack/resource was evaluated. Its current
`Alchemy.makeCallback` registers in the inner per-instance Effect, and its runtime
owns the object's single alarm for legacy events and callbacks together.
Direct native setAlarm/deleteAlarm bypasses that coordination. Therefore:

1. This probe uses a **native Cloudflare class as the sole alarm owner**, with no
   Alchemy callback scheduler. Its harness clears alarms after checking them; the
   harness alarm handler is not a production executor.
2. An Alchemy-hosted implementation must instead register one jobs-wake callback
   in the inner Effect and adapt WakeAlarm to its stable-ID schedule/cancel handle,
   with the bounded drain in its callback. Do not also install a native alarm
   handler or call storage.setAlarm/deleteAlarm. This adapter is not qualified here.
3. Pin Alchemy's optional SQL-D1 and SQL-SQLite-DO dependencies to 4.0.0 if using
   this Effect version. The initial default resolution pulled 4.0.3 and npm ls
   rejected Effect 4.0.0; explicit compatible disposable pins resolved that mismatch.
   Alchemy also names a different optional Drizzle RC peer. Keep provisioning SDK
   dependencies isolated and qualify its final lock; do not widen the library pin.

The serial registrar owner should add a dedicated qualification/test command
for this slice. @effect/sql-pg 4.0.0 is the candidate application dependency;
pg/Drizzle remain optional probes, not a replacement for the qualified PgClient
transaction service. The disposable harness adds no dependency to shared manifests.
Production Worker export/namespace binding, generated compatibility-specific
types, deployment limits, callback/native host selection and migrations remain
serial-owner work. Do not publish the synthetic probe routes.

Required next prerequisite: owner authorization for a dedicated disposable PG
resource/schema/role and credential delivery through a private binding, including
which local or hosted network path may be used. Do not discover/reuse existing
secrets, databases or containers. Real Hyperdrive requires a separately approved
account/resource/budget and **query caching disabled** for ownership, receipts and
authority reads. Migrations/pools remain application-owned. A hosted smoke also
requires exact Worker/DO/Hyperdrive provisioning and deployment authorization.
Until those exist this is a finite checkpoint, not executor readiness.

References: [Cloudflare alarms](https://developers.cloudflare.com/durable-objects/api/alarms/),
[Hyperdrive freshness](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/),
[PostgreSQL drivers](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/),
[Alchemy callbacks](https://alchemy.run/cloudflare/compute/durable-objects/).

## Documentation read before implementation

All 16 recursive ai-docs paths were read: README.md, tsconfig.json, src/index.md;
src/01_services/{10_services-and-layers,20_module-consumption,30_layer-composition}.ts;
src/02_modeling/10_schema-tagged-match.ts; src/03_errors/10_errors-and-causes.ts;
src/04_observability/10_operation-observability.ts;
src/05_resources/10_resources-interruption-secrets.ts;
src/06_persistence/10_mutation-boundaries.ts; src/07_transport/10_wire-errors.ts;
src/08_style/10_visible-code-and-modules.ts; src/09_testing/10_testing-and-review.ts;
src/10_boundaries/10_external-time-regex.ts; src/fixtures/Auth.ts.
Also read: applicable AGENTS.md, UPVE-1020 canonical workflow attachment,
specs/multica-workflow.md, specs/architecture-decisions.md,
docs/playground-foundation.md, specs/postgresql-backend.md, current source
worker/native/store/transaction APIs, installed SDK source/declarations and
UPVE-1863's frozen handoff. No other project's source or resources were changed.
