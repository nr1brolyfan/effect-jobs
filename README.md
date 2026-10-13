# effect-jobs

Durable jobs for Effect: define a payload, enqueue in a transaction, install a
handler, then explicitly run a bounded worker. Applications own pools, migrations
and external-effect idempotency. **Initial alpha.**

## Install

```sh
npm install effect-jobs@0.1.0-alpha.0 effect@4.0.0
# Optional, only for Drizzle migration declarations:
npm install drizzle-orm@1.0.0-rc.5-169397b
```

## Define → enqueue → handle → drain

Application wiring: supply a qualified PostgreSQL `ApplicationAdapter` and an
idempotent invoice renderer. This is composition code, not a complete database app;
[adapter contract and real examples](specs/postgresql-backend.md).
Use focused subpaths; the root export is empty.

```ts
import { Effect, Layer, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as JobQueue from "effect-jobs/JobQueue"
import * as JobProducer from "effect-jobs/JobProducer"
import * as JobPolicy from "effect-jobs/JobPolicy"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Consumer from "effect-jobs/JobConsumer"
import * as Registry from "effect-jobs/JobRegistry"
import * as Worker from "effect-jobs/JobWorker"
import * as Runtime from "effect-jobs/JobWorkerRuntime"
import * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import { PostgreSqlApplication } from "effect-jobs/PostgreSqlTransaction"
import type { ApplicationAdapter } from "effect-jobs/PostgreSqlTransaction"
import type { HandlerInput } from "effect-jobs/JobContract"
import type { JobFailure } from "effect-jobs/JobFailure"

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
  encodePayload: Codec.encodeJobPayload
})

export const billing = (
  applicationAdapter: ApplicationAdapter,
  renderInvoice: (
    input: HandlerInput<typeof GenerateInvoice.payload.Type>
  ) => Effect.Effect<void, JobFailure>
) => {
  const JobsLayer = PostgreSqlJobs.layerNoDeps({
    schema: "billing",
    operationResponseBudgetMillis: 100
  }).pipe(Layer.provide(Layer.succeed(PostgreSqlApplication, applicationAdapter)))
  const HandlerLayer = GenerateInvoice.handlerLayer(renderInvoice, Codec.decodeJobPayload)
  const enqueue = (operationId: string, invoiceId: string) =>
    Effect.gen(function* () {
      const backend = yield* PostgreSqlJobs.PostgreSqlJobs
      return yield* backend.withTransaction((tx) =>
        GenerateInvoice.enqueue(tx, {
          producer: InvoiceProducer.identity({ operationId, slot: "generate" }),
          payload: { invoiceId },
          policy: JobPolicy.make()
        })
      )
    }).pipe(Effect.provide(JobsLayer))
  const drain = Effect.gen(function* () {
    const backend = yield* PostgreSqlJobs.PostgreSqlJobs
    yield* backend.ready // Explicit readiness; application migrations run beforehand.
    const consumer = yield* Consumer.make(BillingQueue, {
      localConcurrency: 2,
      claimLimitPerRun: 20,
      recoveryLimitPerRun: 20
    })
    const WorkerLayer = Worker.layer(backend.store, {
      catalog: [GenerateInvoice],
      operationResponseBudgetMillis: 100 // Same budget as the backend.
    }).pipe(Layer.provideMerge(HandlerLayer), Layer.provide(Registry.layer))
    return yield* Runtime.drain(consumer).pipe(Effect.provide(WorkerLayer))
  }).pipe(Effect.provide(JobsLayer))
  return { enqueue, drain } // Run these Effects explicitly at your application boundary.
}
```

Reuse the operation ID across business retries. Matching duplicates return the
original job ID and keep the first policy/availability; changed catalog or payload
conflicts. Enqueue success is provisional until the owning transaction commits.
Handlers receive payload/context, without SQL or finalization authority.

## 1. Own the migration

```ts
import * as PostgreSqlSchema from "effect-jobs/PostgreSqlSchema"

export const tables = PostgreSqlSchema.tables({ schema: "billing" })
export const migrationSql = PostgreSqlSchema.migration(tables)
// Application migration credentials create the schema and execute this DDL.
// Use the same mapping in PostgreSqlJobs.layerNoDeps; runtime never runs migrations.
```

Optional Drizzle declarations, using the same mapping:

```ts
import { makeJobTables } from "effect-jobs/PostgreSqlDrizzleSchema"
import { tables } from "./migration.js"

export const jobTables = makeJobTables(tables)
```

Declarations supply no transaction adapter. See the concrete
[Effect-native Drizzle qualification](specs/drizzle-compatibility.md).

## 2. Join a business transaction

Inside your application's active transaction callback, pass its **registered
handle** to the backend. The domain writes and enqueue use that same connection:

```ts
import { Effect } from "effect"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import { PostgreSqlApplication } from "effect-jobs/PostgreSqlTransaction"
import { GenerateInvoice, InvoiceProducer } from "./billing.js"
import * as JobPolicy from "effect-jobs/JobPolicy"

// Call only inside the owning manager's callback; it controls commit/rollback.
export const issueInvoice = (handle: unknown, operationId: string, invoiceId: string) =>
  Effect.gen(function* () {
    const backend = yield* PostgreSqlJobs
    const application = yield* PostgreSqlApplication // Same adapter that built the backend.
    const query = yield* application.validate(handle)
    return yield* backend.joinTransaction(handle, (tx) =>
      Effect.gen(function* () {
        yield* query.query("INSERT INTO billing.invoices (id) VALUES ($1)", [invoiceId])
        const result = yield* GenerateInvoice.enqueue(tx, {
          producer: InvoiceProducer.identity({ operationId, slot: "generate" }),
          payload: { invoiceId },
          policy: JobPolicy.make()
        })
        yield* query.query("INSERT INTO billing.receipts (id, job_id) VALUES ($1, $2)", [
          operationId,
          result.jobId
        ])
        return result
      })
    )
  })
```

The app also owns invoice/receipt tables. A query-shaped object or matching DSN
cannot qualify a handle. Joined enqueue adds no connection, savepoint, commit or
replay; propagate integrity conflicts. Unknown commit outcomes require
application reconciliation, never blind write replay.

## 3. Persist retries and choose retention

```ts
import { Duration, Effect } from "effect"
import * as JobPolicy from "effect-jobs/JobPolicy"
import { JobFailures } from "effect-jobs/JobFailure"

export const policy = JobPolicy.make({
  leaseDuration: Duration.seconds(90),
  attemptTimeout: Duration.seconds(30),
  retryDelay: Duration.seconds(5), // Fixed delay, persisted with the first enqueue.
  maxAttempts: 3, // Finalized attempts, including the first.
  maxStalledCount: 1,
  completedRetention: Duration.days(90),
  deadRetention: Duration.infinity
}) // These are also the defaults of JobPolicy.make().

// Only a known temporary rejection is safe to classify as Retry.
export const rejected = Effect.fail(JobFailures.Retry({ code: "provider_busy" }))
export const uncertain = Effect.fail(
  JobFailures.OutcomeUnknown({ code: "response_lost" })
)
```

At-least-once execution uses fixed, nonrenewing leases; recovery may repeat an
attempt number and external effects. Timeouts do not prove nothing happened.
Cleanup is explicit and bounded; domain receipts require coordinated app cleanup.
Pending/Active/Isolated are never auto-purged. Deleting identity evidence ends the
deduplication window. [Lifecycle and retention contracts](specs/architecture-decisions.md).

## 4. Mark already protected payloads

```ts
import { Schema } from "effect"
import * as JobPayload from "effect-jobs/JobPayload"
import * as Codec from "effect-jobs/JobPayloadCodec"

export const ProtectedDocument = JobPayload.protected(
  Schema.Struct({
    ciphertext: Schema.String,
    keyId: Schema.String,
    fingerprint: Schema.String // Own field; keyed semantic equality excludes ciphertext.
  })
)
export const DocumentPayload = Schema.Struct({ document: ProtectedDocument })
export const encodeDocument = (document: typeof ProtectedDocument.Type) =>
  Codec.encodeJobPayload(DocumentPayload, { document })
// Pass an envelope returned by your app's seal service; open it in your handler.
```

The marker performs no encryption/authentication. Applications manage separate
encryption and stable fingerprint keys, retaining old decryption keys while
artifacts remain. Never log payloads, identifiers, SQL, provider errors or keys.
[Protection and codec bounds](specs/architecture-decisions.md#d5--explicit-application-owned-protection-and-codec-boundaries).

## Alpha support and development

Qualified pins: Node 24.15.0, Bun 1.4.2, Effect 4.0.0, PostgreSQL 16.15, pg 8.23.0;
optional Drizzle 1.0.0-rc.5-169397b with native @effect/sql-pg 4.0.0. Other versions,
arbitrary adapters, actual server crashes/network faults and Cloudflare deployment
are unqualified. Full upstream Drizzle declarations fail strict checking; its
consumer uses `skipLibCheck: true`. Non-Drizzle declarations are checked separately
with `skipLibCheck: false`. [Evidence and reproduction](specs/release-qualification.md).

Imports install/start no workers or cleanup. For a long-lived Node/Bun worker,
explicitly build `PollingJobWorker.layerForPlan` in an application-owned Scope;
see [worker examples](tests/qualification/release/Worker.mjs). Keep local concurrency
consistent for each queue. Recurring schedules, administration APIs and other
backends are outside this alpha.

```sh
bun install --frozen-lockfile
bun run build
bun run verify
bun run check:postgresql
# Fixture installs and real-PG/installed gates: specs/release-qualification.md
```

Published consumers have no installation lifecycle scripts. [MIT](LICENSE).
