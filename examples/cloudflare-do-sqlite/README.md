# Issue an invoice and enqueue its job in one SQLite Durable Object

`Worker.mts` uses `effect-jobs/DurableObjectSqlite` with one named SQLite-backed
Durable Object. The application applies `ddl` alongside its own schema. An
invoice command uses `withTransaction` and the joined producer. A new job and
its payload are inserted before the domain invoice write. A deliberate failure
after both writes rolls back all three rows. The Worker awaits native
settlement and `storage.sync()` before replying on the success path.

A separate request runs a bounded `JobWorker.drain` with one claim and one
recovery slot. The handler writes a local recording keyed by job ID. This
example has no external delivery. External handlers need their own
idempotency strategy. The application owns scheduling and reconciliation when
the commit outcome is unknown. An application that needs reconciliation
should write its own receipt using the same transaction and stable operation
ID, then look up that receipt on a separate read when settlement is unconfirmed.
An absent receipt alone does not authorize replay.

The jobs store keeps evidence of the most recent exact worker finalization
until the next state change or deletion. There is no separate receipt TTL.
A missing finalization receipt does not authorize rerunning a handler.
UPVE-2881 tracks a possible future attempt history. The example's SQL
inspection endpoint checks current rows for the smoke test.

## Run locally against the release candidate

Use Linux with user, PID and network namespaces enabled, GNU `timeout`,
`ip`, Node 24.15.0, npm 11.12.1 and Bun 1.4.2. From the repository root run:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
bun run release:pack
ALCHEMY_TEST_DEV=true sh examples/cloudflare-do-sqlite/Run.sh \
  .toolchain/release/artifact/effect-jobs-0.1.0-alpha.5.tgz
```

The packer prints the versioned archive path and refuses to replace an existing
archive. Pass an already-built candidate directly, or set a new
`EFFECT_JOBS_ARTIFACT_DIRECTORY` when rebuilding. The launcher copies the
archive to a disposable consumer, prints its SHA-256 and installs it with
strict npm peer resolution and the locked fixture toolchain. It verifies that adding the archive
leaves the toolchain lock intact. Registry access is only needed for the
install phase. Worker and Alchemy code use strict TypeScript, including
exact optional properties and unchecked indexed access. The combined project
skips upstream declaration checks because the pinned Node, Workers and Alchemy
declarations conflict. The separate Node export check also checks the SDK's
installed declaration graph with `skipLibCheck: false`.

The runtime uses a clean environment and temporary home. The local guard
runs before setup, and Alchemy executes in a loopback-only network namespace.
The runtime has a 60-second deadline. `Qualification.mts` asserts the commit
and rollback from separate HTTP reads, checks the bounded drain and idle
result, then destroys the stack and checks that its listener closed. The
launcher removes the disposable install and local storage on exit.

## Hosted smoke before publication

1. **Agree the Cloudflare account and stage with the owner before provisioning.**
   Record the disposable account or approved sandbox, a unique stage and
   Worker name, its private test route, who can access it, the operator and the
   cleanup deadline. Use synthetic data only. Smoke endpoints expose test
   state and deliberately fail a command, so require authenticated access
   before issuing requests. Disable public `workers.dev` and preview routes.
2. In a fresh consumer, install the same verified candidate and use
   `Worker.mts` as the entrypoint. Configure the `INVOICES` binding for
   `InvoiceJobs` in the same Worker, with the example's compatibility date
   and a Wrangler class export with `type: "durable-object"` and
   `storage: "sqlite"` under `exports.InvoiceJobs`. Record the candidate
   SHA-256, Worker deployment and namespace IDs. Keep the local launcher in
   local mode. [Cloudflare class exports and migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/),
   [workers.dev routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).
3. Through the agreed private route, repeat the HTTP assertions from
   `Qualification.mts`. Use a fresh stage and check that its initial
   `GET /inspect?operationId=commit` returns empty state. Post the synthetic
   invoice to `/issue` and check the independent read shows the invoice,
   pending job and one payload. Post a different operation ID with
   `failAfterWrites: true` and expect HTTP 409, empty invoice and job rows for
   that ID, and the same payload count. Post to `/drain` and check one claim,
   a completed job, one recording and an idle result on the next drain.
4. Run cleanup after success, failure or interruption. Remove the stage route
   and its smoke-only access policy. In the disposable stage remove the
   Worker code that exports the class, remove the binding and apply
   `state: "deleted"` to the class export. Then delete the smoke Worker and
   verify the route, deployment and namespace inventory are clear before
   closing the stage. Escalate any leftover resource to the designated
   cleanup owner. [Delete a Durable Object class](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/#delete-a-durable-object-class).
