# Tenant billing with native Alchemy callbacks

This standalone application uses Alchemy and `@alchemy.run/cloudflare`
**2.0.0-beta.85**, Effect and platform peers **4.1.0**, TypeScript **6.0.3**,
npm **11.12.1**, Node **24.15.0**, and local Miniflare/workerd pinned by `package-lock.json`.
The example uses TypeScript 6 to satisfy Alchemy’s `capnp-es` compiler peer range;
the root library retains its TypeScript 7 baseline. A frozen `npm ci` and
`npm ls --all` validate this isolated graph.
It has its own dependency graph; Alchemy is not a library runtime dependency.

`alchemy.run.ts` defines a real Effect-native Worker and Durable Object with
local Alchemy state. `src/Coordinator.ts` shows the two construction phases:
stable configuration and Hyperdrive binding at construction, callback registration at per-instance init,
and SQL acquisition inside each actual callback. `src/Application.ts` provides the coordinator implementation Layer inside Worker
construction and invokes its Effect-returning RPC methods
from HTTP handling. It obtains the RPC stub inside each request, retaining only
the namespace during construction. Application methods do not call `Effect.runPromise`.

`src/Database.ts` declares the app-owned Hyperdrive resource with a local dev
origin and explicitly provides the native ConnectBinding Layer. Its accessor
reads fresh connection credentials during each invocation. Qualification neither
plans nor provisions the resource. The origin URL is validated behind a bounded
configuration error; secret values are never put in a diagnostic. Production
Hyperdrive uses its normal TLS policy; local dev explicitly disables origin TLS.

`src/Invocation.ts` explicitly creates the invocation's PgClient, native
transaction adapter, `jobs`, configured producer, storage, handlers and worker.
The caller closes its Scope before returning; no SQL client, transaction Context
or pool survives into another RPC, alarm or hibernation. This uses native
`PgClient.make`, rather than retaining a lazy SQL proxy whose transaction identity
could be misunderstood. The pinned Alchemy SQL implementation also memoizes
pools by the current execution Scope, not by isolate Layer lifetime.

## Tenant and transaction authority

The example's DEVELOPMENT admission maps `Bearer development-alice` to tenant-a
and `Bearer development-bob` to tenant-b. These public synthetic credentials are
for local tests only. Replace that function with application authentication
before exposing this application. JSON accepts only `invoiceId` and `requestId`;
a body `tenantId` is rejected. A lookup joins the enabled tenant configuration
and invoice on both tenant and invoice ID. A route, queue or DO name is never an
authorization decision. One shared `billing` queue and one wake coordinator serve
both tenants; neither is a mandatory library topology.

An application transaction locks/creates its receipt, validates replay content,
updates the invoice and enqueues the job using the SAME client. The stable
operation ID includes the admitted tenant and caller's bounded request ID.
The acknowledged receipt response can be read again after response loss. A new
request ID denotes a new operation. Unknown transaction results are unconfirmed;
no blind mutation replay is performed by the application or callback.
Applications own migrations, tenant configuration, IDs, receipt retention and
pool policy. The example performs no automatic runtime DDL. `tests/Migrate.mjs`
is explicit disposable-fixture setup, not a production migration runner.

The handler rechecks tenant/invoice authority and calls the configured HTTP
provider with the durable job ID as idempotency key. Ambiguous HTTP errors become
OutcomeUnknown; confirmed denial becomes Dead. `tests/DevelopmentProvider.mjs`
is a synthetic idempotent HTTP sink: equal key/content has one effect, changed
content conflicts. Its Map is not durable across restarts. A real external
provider must durably retain and reconcile equal-content keys for the entire
possible recovery/retention window. The jobs library cannot provide exactly-once
external delivery or physical tenant/region isolation.

## Wake protocol and liveness

Alchemy `makeCallback` exclusively owns the native alarm. SQLite stores Alchemy's
callback metadata; PostgreSQL remains the only jobs/payload/lifecycle authority.
No custom SQL claims, finalizations, retry loop, manual `setAlarm`/`deleteAlarm`,
second coordinator or detached fibers implement the job lifecycle.

Before accepting production, traffic explicitly calls `prearm()` on the named
DO. If scheduling fails, production is not accepted. Only after PostgreSQL commit
does a best-effort nudge shorten the latency. External prearm/nudge checks and
updates share one native DO storage transaction; nested Alchemy status/schedule
calls join that transaction, including native alarm reconciliation. A per-instance
semaphore also serializes sibling fibers across the complete operation. Prearm
only creates absent work. Nudge replaces work only when its requested deadline
precedes the existing effective deadline (`max(scheduledAt, retryAt)`). Replays
retain the earlier deadline/version, so sustained traffic needs no quiet interval
for delivery. The callback's final hint schedule also retains any earlier wake.
PostgreSQL and DO scheduling are
not one transaction. A lost nudge leaves the durable repair wake. The first
traffic path bootstraps a dormant instance; declaring a DO alone activates nothing.
For pre-existing jobs or replacement namespaces, explicitly invoke the authorized
application bootstrap path before routing producers. If native alarms/state are
administratively removed, an operator/traffic repair must bootstrap again. No
remote repair service is installed by this example.

A running callback durably replaces its pending ID with a repair wake BEFORE SQL
or external work. It drains at most four jobs and recovers at most four leases,
then observes at most twenty pending rows plus the storage port's lookahead.
One worker with concurrency one owns execution. A twelve-second invocation budget
bounds normal drain orchestration; library attempt/lease and bounded reconciliation
rules still apply. Client acquisition/connection are limited to two seconds,
statements to two seconds, locks to one second and idle transactions to five
seconds, with a 2.5-second native operation budget and 500ms response reserve.
These are local configured bounds, not proof of deadlines under a network/server
crash or an uninterruptible foreign finalizer.

The next delay uses `timestamp - observedAt` from PostgreSQL, capped by the
60-second repair interval. Due timestamps, MoreWork or saturation request a
one-second continuation. Null/saturated hints never prove emptiness; Idle still
retains repair for future availability, retries, expired leases and lost nudges.
SQL/hint failures or interruption leave the prearmed wake for a future invocation.

The pinned Alchemy source replaces each callback row with a fresh version.
Acknowledgement deletes only `(callback, id, deliveredVersion)`, preserving a
same-ID replacement. `Wake.ts` uses one constant ID, so pending metadata remains
bounded at one row. Tests verify the real implementation, including native
workerd alarm delivery, failure, interruption and acknowledgement. Controlled
sibling races yield after the real status read, trace SQL reads/writes to their
native transaction and check both prearm/nudge orders and nudges with different
request clocks. A 240-request run delivers callbacks during sustained 500ms traffic,
without stopping nudges to make progress.

Self-scheduling inherits Alchemy's attempt budget; changing ID/deadline is not
progress. After eight attempts it parks but retains hourly recovery. This example
deliberately accepts that bounded hourly latency after parking, including idle
periods. An external nudge that advances the effective wake starts a fresh budget;
a replay preserving an earlier wake leaves its budget unchanged. It does not fabricate a
progress cursor from wake counts to bypass backoff. The callback retry policy is
one-second initial exponential backoff, eight attempts and one-hour parked
recovery. Under interruption, native Cloudflare alarm retries are an additional
host assumption. Do not abort with `retryAlarm:false`. Liveness requires eventual
host delivery and database/provider recovery; there is no production latency SLA.

## Local qualification and development

From the repository root, build the library, then install this standalone package
with `npm ci --prefix examples/cloudflare-alchemy --ignore-scripts`. The local
file dependency is packed by npm (`.npmrc` sets `install-links=true`), keeping
the root development tree outside this standalone graph. Refresh it after changing
the library build. SQL D1 is constrained to 4.1.0 within its declared ^4.1.0 range;
newer 4.1.2 requires a newer Effect peer. Esbuild 0.28.2 satisfies Vite 8.1.0's peer. Use Node
24.15.0 for the complete local gates.

Run `bun run qualify:cloudflare:alchemy`. This checks the actual installed Alchemy
public types, uses the root-pinned lint tool, builds the stack without evaluating it, bundles the installed
callback/storage/bridge code and runs local workerd. The full entrypoint is built by Alchemy.Bundle (including its runtime-phase
pruning), not an esbuild approximation of Alchemy resource initialization.
`tests/FullApp.mjs` boots the maintained Worker/DO Layers through the actual
Alchemy bridges. It also checks the relative
wake policy, admission and the synthetic provider's idempotency/conflict behavior.
`tests/Build.mjs` imports Alchemy internals ONLY for qualification and leaves their
bytes unchanged. `react-devtools-core` is external to the test build because it is
an optional devtools dependency on an unused infrastructure path; the resulting
workerd bundle loads successfully without importing it.

`bun run --cwd examples/cloudflare-alchemy test:postgresql` additionally requires
`EXAMPLE_TEST_DATABASE_URL` from the surrounding task-owned disposable-PG runner.
It executes explicit migrations, real atomic production/receipt replay, a
cross-tenant rejection and bounded workerd drain through both the focused callback
harness and the complete maintained Worker/DO entrypoint, then checks durable results and
zero surviving SQL sessions. The all-four-exit cleanup fixture covers success,
typed failure, defect and interruption. Without that private environment, the
ordinary runtime test explicitly reports PG **NotTested**, never PASS.

Development uses `bun run --cwd examples/cloudflare-alchemy dev` with
`EXAMPLE_DATABASE_URL` and `EXAMPLE_PROVIDER_URL` supplied privately to Alchemy.
Alchemy binds configuration as secrets. Use a disposable local PostgreSQL and a
local development provider, run app-owned migrations explicitly, and exercise
traffic with the development credentials. No Wrangler configuration is needed.
The author qualification does not run dev/plan/deploy against an account,
bootstrap Cloudflare state, provision resources or mutate Cloudflare credentials.

Hosted deployment, full `alchemy dev` orchestration, multi-region behavior,
external production providers, real process/network/server crashes and migration
rollout remain **NotTested**. Type checking, the stack bundle, actual Alchemy bridge
and callback workerd tests, and local PG are distinct evidence scopes.

Source references: [durable objects](https://alchemy.run/cloudflare/compute/durable-objects/),
[layers](https://alchemy.run/infrastructure-as-effects/layers/) and
[runtime](https://alchemy.run/infrastructure-as-effects/runtime/). The qualification
uses the installed pinned `Callback.ts`, `AlarmCallback.ts`,
`DurableObjectAlarmStorage.ts`, `DurableObjectBridge.ts` and `ExecutionMemo.ts`;
current website examples alone are not the API oracle.
