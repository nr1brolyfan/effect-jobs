# Sandbox live invalidations

This independent slice exports browser transport, a Cloudflare Durable Object
factory, an HTTP upgrade adapter and a best effort post-commit notification Layer.
It is not wired into the shared registrars. PostgreSQL and authenticated HTTP
reads remain authoritative. Wire messages contain only sandbox/generation,
sequence and an invalidation reason; they never contain job payloads or execution
results. The local `Signal` schema is transport-owned; frozen shared contracts
are unchanged. It broadly invalidates mounted job views within one sandbox.

## Serial integration proposals

The foundation owner should apply these additions, with the relevant slice owners:

1. Add `live: "/api/live"` to the website route registrar. Bind GET to
   `Upgrade.upgrade(request, websiteOrigin, liveNamespace, authorize)`.
   `authorize` must use the app-owned HttpOnly cookie and `SandboxAuthority`,
   never URL/body sandbox identity. Origin must be the exact configured website
   origin. Both the public adapter and DO validate admission.
2. In the worker registrar import `DurableObject` from `cloudflare:workers` and
   export `SandboxLive = makeDurableObject(options, DurableObject)`. Provide
   `options.authorize(request, env)` and `options.isCurrent(ref, env)` as bounded
   Effect programs backed by current sandbox authority. The latter must reject
   expired/revoked/old-generation sandboxes. Return only `SandboxView`, without
   credentials. They must not perform lifecycle writes or query decrypted data.
   CF-specific type declarations belong to the serial runtime/SDK owner.
3. Bind a private `LIVE` Durable Object namespace to `SandboxLive` in the
   Alchemy/CF descriptor; route objects by `PostCommit.objectName(ref)`. Add the
   required DO class migration under serial ownership. This proposal does not
   select resources, a billing SKU or authorize provisioning/deployment.
4. Provide `PostCommit.layer(liveNamespace)` as `LiveNotifications`. The
   scenario/transaction owner calls `committed(ref)` only after acknowledged
   outer commit or exact receipt reconciliation proving commit. Never call it
   after joined enqueue, handler start, an unknown outcome or rollback.
   No generic library hook exists for enqueue/claim/finalize/recovery; those
   integrations remain app/executor-owner proposals. Notification failure must
   not change a committed operation's response or authorize replay.
5. UI mounts `BrowserLive.start({ sandbox, url, snapshot, render, unavailable })`,
   with the same-origin live URL and an authorized HTTP snapshot Effect. Snapshot
   must include all currently affected list/detail views and replace current data.
   Bind `setVisible(!document.hidden)` to visibility/mount changes, call `dispose`
   on unmount, and construct a new instance after reset/generation changes.
   `BrowserLive.scoped` also provides an Effect Scope-owned lifetime.
6. Register focused tests: `vitest run apps/website/tests/live`. Current app
   skeleton builds do not import these modules; include the actual live browser
   graph and worker factory when integrating entrypoints.

## Ordering, limits and costs

Subscribe before the initial snapshot. Server `ready` always triggers another
HTTP read. A hint arriving during a read invalidates that read's revision: its
result is discarded, then replaced by a fresh read. Reconnect and every five
seconds while visible also trigger a read, repairing lost/coalesced hints without
assuming an ordered durable feed. Sequence is per connection, not a database
commit cursor. There is no reliable/exactly-once delivery claim.

Each object admits at most 16 viewers. Hints collapse into one stored dirty bit
and a one-second alarm; no per-job or per-client event queue grows. Each viewer
has at most one unacknowledged signal. A viewer that has not acknowledged for ten
seconds closes; incoming frames are at most 1024 characters and only exact ACK
objects are accepted. Attachment schemas restore scope, expiry, sequence and ACK
state after hibernation. Closing sockets do not count as viewers. Authority is
revalidated by each alarm, with a two-second operation timeout; expiry can advance
the next alarm. Admission authorization also has a two-second timeout.

Alarms run every five seconds with viewers, and are deleted without viewers.
They emit reconciliation hints rather than opening a PG connection. Browser
reads have a four-second timeout, one in-flight read, and a 250ms minimum spacing
(maximum four starts/second under a burst). Browser fallback reconciliation runs
every five seconds. It can coincide with a server hint and cause an additional
coalesced read. Reconnect uses at most five attempts per visibility lifetime,
with 0.5/1/2/4/8-second delays and a three-second ready timeout; capped HTTP reads
continue after retries are exhausted. No jitter fleet policy is qualified here.
Hiding/unmounting cancels reads/timers and closes the socket. Expiry or stale
generation ends the lifetime, requiring new authority to restart.

Hibernation retains connections, not free execution. Viewer-driven alarms and
authority reads still wake the object and can incur charges. There are no
persistent PG LISTEN connections, Electric/LiveStore dependencies, or handler
diagnostics mixed into snapshot truth.

## Local qualification

Run the ordinary playground type/lint/build gates and focused Vitest tests.
Use task-local disposable dependencies for the finite workerd/browser probe:

```sh
npm install --prefix .multica/live-probe --ignore-scripts --no-audit --no-fund miniflare@5.20261006.1-alpha playwright@1.64.0
node .multica/live-probe/node_modules/playwright/cli.js install chromium
node apps/website/tests/live/Qualify.mjs .multica/live-probe/node_modules
bun run playground:qualify
node apps/website/tests/live/Packed.mjs .toolchain/playground/packed-REPLACE/receipt.json
```

The probe uses real workerd WebSocket callbacks, RPC, alarms and forced hibernation
eviction with a real Chromium client. Authority and HTTP snapshot data are
explicit synthetic fixtures. All fixture/control routes are test-only. It verifies
reconnect, missing hints, hibernation attachment restoration, bursts, origin/scope
denial, expiry, viewer-driven read/alarm shutdown, viewer cap and slow clients.
It stops its browser, local HTTP server and workerd before returning. The packed
runner extends a completed foundation receipt outside repository ancestry and
checks the actual live modules against installed library bytes, strict types,
Node/Bun imports and browser bundles without workspace aliases/backend peers.

Not qualified: hosted CF/Alchemy deployment, production cookie authority,
real PostgreSQL snapshots, actual post-commit hook integration, network partitions,
multi-object fleet cost/load or distributed revocation propagation.

Runtime API references: [Cloudflare state and hibernation API](https://developers.cloudflare.com/durable-objects/api/state/)
and [hibernation server example](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/).
