# Integrated local playground

The root remains the `effect-jobs` library. Private packages under `apps/` and
`packages/playground-contracts/` compose its public APIs; they are excluded from
its release archive. The app uses PostgreSQL authority, admission, associations,
receipts and a synthetic provider ledger. An acknowledged command means enqueue
committed, not that a handler succeeded. The UI labels persisted lifecycle facts
separately from observations and does not expose payloads or encrypted envelopes.

## Build and qualification

Use Node **24.15.0**, Bun **1.4.2**, PostgreSQL **16.15** and the application-local
pins recorded in `apps/playground-worker/package.json`. From the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
node apps/playground-worker/tests/integration/Build.mjs
PLAYWRIGHT_SKIP_BROWSER_GC=1 apps/playground-worker/node_modules/.bin/playwright install chromium
python3 apps/playground-worker/tests/integration/RunOwned.py
```

Build compiles the library, refreshes Bun's `file:` copy, builds the private
contracts, actual browser client and actual worker/server graph, checks strict
application types and packs the library into a fresh immutable directory. It
compares every packed library output to the root build and rejects private app
paths. Root library runtime dependencies and exports are unchanged.

The qualification wrapper provisions at most one new uniquely named loopback PG
container using the pinned image digest, tmpfs storage and privately generated
credentials/keys. It verifies previous exact owned resource IDs are absent first.
The schema is created explicitly through the application migration registry;
HTTP requests and worker imports never migrate. The wrapper runs its gate in the
foreground with a finite timeout and deletes only its exact container and private
config on success or failure. No existing `.env`, DB, volume or cloud is accessed.
Set `PLAYGROUND_DEADLINE` to an explicit future UTC instant when reproducing after
the original task window; the runner requires at least eight minutes remaining.

Receipts and sanitized logs live in `.multica/integration/`. Source inputs,
worker/browser/archive hashes and tool versions identify the exact qualified
bytes. Failed attempts retain their own inputs/diagnosis. These are local evidence
locations; the task handoff also attaches an evidence archive.

## Launch and stop a reproducible preview

After the build, run in the foreground (Docker must be available):

```sh
bun run playground:preview
```

The command serves `http://127.0.0.1:8787/demo` and `/jobs`, without a certificate.
Override the fixed port with `PLAYGROUND_PORT` if necessary. There is **no automatic
expiry**. In WSL, the launcher falls back to `docker.exe` when Docker Desktop is
available but the Linux daemon/socket is not; `DOCKER_BIN` can select a client
explicitly without changing your global context. `PLAYGROUND_DEADLINE` applies only
to integration tests and is ignored in preview mode. Open multiple tabs to exercise
viewers. Press **Ctrl-C in the same terminal** to stop. The wrapper's
`owned-resource-receipt.json` records
the exact container ID and cleanup command. Logs/receipts are in the task-local
`.multica/integration/` directory. This is a foreground service owned by that
command, not a deployed service. The database remains temporary: it is kept for the
entire preview session and removed on shutdown, not persisted across restarts.

## Runtime composition

One shared gateway serializes HTTP events. Every event acquires one scoped native
PgClient and a backend bound to that exact client, then closes its Scope before
returning. Application Context exposes issue/authenticate/describe, read,
run/reset and exact receipt operations. CommandPersistence owns actual native
transactions, admission and atomically committed job/association/receipt writes.

The capability cookie is Secure, HttpOnly, SameSite=Strict and uses the `__Host-`
prefix. POSTs require configured origin, same-origin fetch metadata when present,
and a separate double-submit CSRF cookie/header. Credentials never reach the JS
client, DTO or evidence. Issuance and heartbeat accept only a bounded empty body;
commands use the qualified bounded stream reader. Durable fixed-minute gateway
budgets bound total requests, issuance and per-sandbox activity.

Four fixed queue DO classes own communications, media, commerce and private work.
Each serialized queue event scopes the native client/backend and installs the six
real handlers. Authorized describe renews the DB-time viewer lease and kicks all
four queues. Activation is 400 ms, MoreWork 100 ms and Backoff 1000 ms. Global
retirement requires no live viewer in any sandbox. Previously admitted unattended
sandbox work can complete while another viewer keeps the shared queues active.

Three independently generated synthetic key bytes remain stable across events
for encryption, fingerprinting and cursor HMAC. Never replace encryption keys
while retaining protected jobs, or generate fresh keys per request. Disposal of
this local disposable database disposes its synthetic key configuration too.

ExecutionHints selects at most 100 active sandbox refs and calls bounded,
coalesced live invalidations. Signals contain scope/reason/sequence only. Browser
Live performs authoritative periodic reads and reconnect reconciliation. Reset
changes visibility/admission generation; it retains jobs/quota and does not cancel
running work. Old commands and provider writes are fenced. retry/redrive/cancel
remain false; terminal cleanup is deferred.

## Boundaries

Only local workerd and disposable synthetic PG are covered. Hosted Cloudflare,
Alchemy, real providers, crash/network failure and CPU qualification require
separate scope and evidence. No full push-preflight claim follows from focused
integration gates. This task authorizes no remote push, PR, merge or deployment.
