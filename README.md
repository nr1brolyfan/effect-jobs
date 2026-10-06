# effect-jobs

Durable, transaction-bound jobs for Effect. **Initial alpha.**

## Install

```sh
npm install effect-jobs@0.1.0-alpha.0 effect@4.0.0
# Optional migration declarations:
npm install drizzle-orm@1.0.0-rc.5-169397b
```

## Define → enqueue → handle → drain

Snippets omit imports and application wiring. The [executable harness](tests/docs/readme/Prelude.mjs)
supplies focused subpath imports (the root is empty) and explicit application parameters; [full database setup](tests/qualification/drizzle-native/NativeApplication.mts).

```ts
const BillingQueue = JobQueue.make("billing")
const Producer = JobProducer.make({ operation: "billing.invoice", slots: ["generate"] })
const GenerateInvoice = Job.make({
  queue: BillingQueue,
  kind: "invoice.generate",
  version: 1,
  payload: Schema.Struct({ invoiceId: Schema.String }),
  encodePayload: Codec.encodeJobPayload
})
// backend and renderInvoice are supplied by the application.
const enqueue = (operationId: string, invoiceId: string) =>
  backend.withTransaction((tx) =>
    GenerateInvoice.enqueue(tx, {
      producer: Producer.identity({ operationId, slot: "generate" }),
      payload: { invoiceId },
      policy: JobPolicy.make()
    })
  )
const HandlerLayer = GenerateInvoice.handlerLayer(renderInvoice, Codec.decodeJobPayload)
const WorkerLayer = Worker.layer(backend.store, {
  catalog: [GenerateInvoice],
  operationResponseBudgetMillis: 100 // Match the backend.
}).pipe(Layer.provideMerge(HandlerLayer), Layer.provide(Registry.layer))
const drain = Effect.gen(function* () {
  yield* backend.ready // Application migrations have already run.
  const consumer = yield* Consumer.make(BillingQueue, {
    localConcurrency: 2,
    claimLimitPerRun: 20,
    recoveryLimitPerRun: 20
  })
  return yield* Runtime.drain(consumer).pipe(Effect.provide(WorkerLayer))
}) // Run enqueue and drain explicitly at your application boundary.
```

Reuse the operation ID on retries; matching duplicates keep the first job/config,
changed content conflicts. Enqueue is provisional until commit. Handlers receive
payload/context, without SQL authority. [Transaction contract](specs/postgresql-backend.md).

## Own the migration

```ts
const tables = PostgreSqlSchema.tables({ schema: "billing" })
const migrationSql = PostgreSqlSchema.migration(tables)
// Application migration credentials execute this DDL; runtime never does.
// Configure the backend with the same mapping.
```

Optional Drizzle declarations reuse that mapping:

```ts
const jobTables = makeJobTables(tables)
// Migration declarations only; no transaction adapter is supplied.
```

[Qualified Effect-native Drizzle integration](specs/drizzle-compatibility.md).

## Join a business transaction

Inside the owning manager's active callback, use its registered `handle` and
validated same-connection `query`; the application owns invoice/receipt tables.

```ts
const issueInvoice = backend.joinTransaction(handle, (tx) =>
  Effect.gen(function* () {
    yield* query.query("INSERT INTO billing.invoices (id) VALUES ($1)", [invoiceId])
    const job = yield* GenerateInvoice.enqueue(tx, {
      producer: Producer.identity({ operationId, slot: "generate" }),
      payload: { invoiceId },
      policy: JobPolicy.make()
    })
    yield* query.query("INSERT INTO billing.receipts (id, job_id) VALUES ($1, $2)", [
      operationId,
      job.jobId
    ])
    return job
  })
) // All three writes commit or roll back together under the outer owner.
```

No fallback connection, savepoint or replay. Unknown commit outcomes need
application reconciliation. [Handle and atomicity requirements](specs/postgresql-backend.md#explicit-application-adapter-contract).

## Persist retries and retention

```ts
const policy = JobPolicy.make({
  retryDelay: Duration.seconds(5),
  maxAttempts: 3,
  completedRetention: Duration.days(90),
  deadRetention: Duration.infinity
}) // Other fields use defaults; first enqueue persists the complete policy.
const rejected = Effect.fail(JobFailures.Retry({ code: "provider_busy" }))
const uncertain = Effect.fail(JobFailures.OutcomeUnknown({ code: "response_lost" }))
```

At-least-once execution, fixed nonrenewing leases and database time; a timeout
cannot prove an external effect failed. Cleanup is explicit and bounded; coordinate
receipt/OTP retention, never purge Pending/Active/Isolated. Removing identity
evidence ends deduplication. [Lifecycle and cleanup](specs/architecture-decisions.md#d8--replaceable-cleanup-with-application-domain-retention-integration).

## Mark already protected payloads

```ts
const ProtectedDocument = JobPayload.protected(
  Schema.Struct({
    ciphertext: Schema.String,
    keyId: Schema.String,
    fingerprint: Schema.String // Stable keyed semantic equality, excluding ciphertext.
  })
)
const DocumentPayload = Schema.Struct({ document: ProtectedDocument })
const encodeDocument = (document: typeof ProtectedDocument.Type) =>
  Codec.encodeJobPayload(DocumentPayload, { document })
// Supply your app's sealed envelope; open it only in the handler.
```

The marker does no encryption. Keep separate encryption/fingerprint keys and old
decryption keys; preserve OTP binding. Never log payloads, IDs, SQL, provider errors
or keys. [Protection and codec bounds](specs/architecture-decisions.md#d5--explicit-application-owned-protection-and-codec-boundaries).

## Alpha support and development

Qualified: Node 24.15.0 / Bun 1.4.2, Effect 4.0.0, PostgreSQL 16.15 / pg 8.23.0,
optional Drizzle 1.0.0-rc.5-169397b / @effect/sql-pg 4.0.0.
[Limits and evidence](specs/release-qualification.md#limits-and-preserved-evidence)
include upstream Drizzle strict declaration failures, unqualified adapters/versions,
server crashes, network faults and Cloudflare deployment.

Imports start no workers or cleanup. Applications own pools/migrations; long-lived
workers explicitly use `PollingJobWorker.layerForPlan` in an application Scope.
[Worker example](tests/qualification/release/Worker.mjs). Keep concurrency consistent
per queue. Recurring schedules, admin APIs and other backends are outside this alpha.

```sh
bun install --frozen-lockfile
bun run build
bun run verify
bun run check:postgresql
# Real-PG and installed gates: specs/release-qualification.md
```

No installation lifecycle scripts. [MIT](LICENSE).
