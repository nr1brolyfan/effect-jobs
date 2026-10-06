# effect-jobs

Effect-native durable jobs with atomic, transaction-bound production. Initial
alpha: application-defined catalogs, semantic deduplication, fenced fixed leases,
persisted fixed-delay retries, bounded recovery and explicit scoped workers.
Applications own database pools, migrations, handlers, protection and domain receipts.

## Install

```sh
npm install effect-jobs@alpha effect@4.0.0
# Only when using the optional migration declarations:
npm install drizzle-orm@1.0.0-rc.5-169397b
```

The root export is intentionally empty. Import the focused public modules:

```ts
import { Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobQueue from "effect-jobs/JobQueue"
import * as JobProducer from "effect-jobs/JobProducer"
import * as JobPolicy from "effect-jobs/JobPolicy"
import { encodeJobPayload } from "effect-jobs/JobPayloadCodec"

export const BillingQueue = JobQueue.make("billing")
export const InvoiceProducer = JobProducer.make({
  operation: "billing.issue-invoice",
  slots: ["generate"]
})
export const GenerateInvoice = Job.make({
  queue: BillingQueue,
  kind: "invoice.generate",
  version: 1,
  payload: Schema.Struct({ invoiceId: Schema.String }),
  encodePayload: encodeJobPayload
})
export const invoiceInput = (operationId: string, invoiceId: string) => ({
  producer: InvoiceProducer.identity({ operationId, slot: "generate" }),
  payload: { invoiceId },
  policy: JobPolicy.make()
})
```

Declare producers once and reuse a stable operation ID across business retries.
`GenerateInvoice.enqueue(jobsTx, invoiceInput(...))` requires the explicit scoped
transaction capability supplied by your backend's join callback. The library
assigns the job ID; a matching duplicate returns the original ID and retains its
first policy and availability. Changed catalog or semantic payload conflicts.
Results are provisional until the application's transaction commits.

## PostgreSQL setup

`effect-jobs/PostgreSqlTransaction` defines the `PostgreSqlApplication` service
and trusted `ApplicationAdapter` contract. Your adapter must bind registered
handles to the exact active source, connection and lifetime. A query-shaped object
or matching DSN is insufficient. It delegates transaction ownership to your
application; joined enqueue must not borrow, open a savepoint, commit or replay.
Worker and cleanup transactions must commit before returning and reject an
ambient transaction. See the shipped [backend contract](specs/postgresql-backend.md).

```ts
import { Effect, Layer } from "effect"
import * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import * as PostgreSqlSchema from "effect-jobs/PostgreSqlSchema"
import { PostgreSqlApplication } from "effect-jobs/PostgreSqlTransaction"

const tables = PostgreSqlSchema.tables({ schema: "billing" })
// During application migration, after creating the schema:
const migrationSql = PostgreSqlSchema.migration(tables)
// applicationAdapter implements the full qualified contract above.
const jobsLayer = PostgreSqlJobs.layerNoDeps({
  ...tables,
  operationResponseBudgetMillis: 100
}).pipe(Layer.provide(Layer.succeed(PostgreSqlApplication, applicationAdapter)))
```

The application executes `migrationSql` with its migration credentials, supplies
its adapter, and explicitly invokes backend `ready`. Runtime construction runs
no DDL and creates or closes no pool. Optional
`PostgreSqlDrizzleSchema.makeJobTables(tables)` supplies migration declarations;
it does not supply a universal Drizzle transaction adapter. The concrete native
qualification application is documented in
[Drizzle compatibility](specs/drizzle-compatibility.md).

## Handlers, workers and retention

Install handlers with `definition.handlerLayer(execute, decodeJobPayload)` into
`JobRegistry.layer`. Handler input is `{ payload, context }`; context contains
job ID, catalog, producer and one-based attempt number. Provide handler services
through ordinary Layers. Map domain errors to `JobFailures.Retry`, `Dead`,
`Isolate` or `OutcomeUnknown` from `effect-jobs/JobFailure`.

Compose `JobWorker.layer(store, options)` with the registry and store, then call
`JobWorkerRuntime.drain(consumer)` for bounded work, or explicitly install
`PollingJobWorker.layerForPlan(plan, options)` in an application-owned Scope.
Use the same local concurrency for a queue across invocations. Imports and
handler installation do not start workers or cleanup.

Execution is at least once. Unknown outcomes and lease recovery can repeat a
handler; external effects need application idempotency or reconciliation. An
attempt number may repeat after recovery. Leases do not renew. No exactly-once
external delivery, server-crash coverage or Cloudflare coordinator is promised.

Default policy: 90-second lease, 30-second attempt timeout, 5-second fixed retry,
3 finalized attempts, 1 stalled recovery, 90-day Completed retention and infinite
Dead retention. Generic cleanup is bounded and explicitly selected. Applications
with receipts or domain references must replace it with coordinated cleanup.
Pending, Active and Isolated jobs are never automatically purged. Removing all
identity evidence ends that job's deduplication window.

`JobPayload.protected(schema)` marks an already protected envelope with an own
`fingerprint` field; it does not encrypt. Applications seal/open sensitive data
and manage separate encryption and stable fingerprint keys. Preserve old
decryption keys while artifacts remain retained. Telemetry must exclude payloads,
identifiers, SQL, provider messages and secret material.

## Support and development

Exact qualification pins: Node 24.15.0, Bun 1.4.2, Effect 4.0.0, PostgreSQL 16.15,
pg 8.23.0 and optional Drizzle 1.0.0-rc.5-169397b. Other versions are unqualified.
The npm engine range bounds installation to Node 24; it is not evidence for
every patch release. Full upstream Drizzle declarations fail strict checking;
the Drizzle consumer uses `skipLibCheck: true`. Non-Drizzle backend declarations
are separately checked with `skipLibCheck: false`.

See [release qualification](specs/release-qualification.md) for evidence scope,
reproduction and limitations, and [accepted decisions](specs/architecture-decisions.md)
for the full contracts. No recurring schedules, administration APIs, alternative
backend or deployment is included in this alpha.

```sh
bun install --frozen-lockfile
bun run build
bun run verify
bun run check:postgresql
```

Fixture dependencies also require frozen installs in `tests/postgresql` and
`tests/qualification/d6-pg`; native qualification installs its own exact peers.
Tools are patched explicitly by check/build/lint/test. Published consumers have
no installation lifecycle scripts. MIT; see [LICENSE](LICENSE).
