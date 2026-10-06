# effect-jobs

Create an invoice now. Deliver its receipt in a separate worker, even after the
application server restarts. Durable, transaction-bound jobs for Effect. **Initial alpha.**

## Invoice → receipt email

Two processes, one PostgreSQL jobs storage. The application server commits the
invoice and job together; the consumer installs the handler and polls explicitly.
Imports are omitted. [Full prelude](tests/docs/readme/Prelude.mjs),
[native Drizzle wiring](tests/docs/readme/NativePrelude.mts) and
[application service contract](tests/docs/readme/Services.ts.txt) supply the named
dependencies below; the [harness](tests/docs/readme/Run.mjs) checks every fence.

### Shared job definition

```ts
const BillingQueue = JobQueue.make("billing")
const IssueInvoice = JobProducer.make({
  operation: "billing.issue-invoice",
  slots: ["receipt"]
})
const SendReceipt = Job.make({
  queue: BillingQueue,
  kind: "invoice.receipt-email",
  version: 1,
  payload: Schema.Struct({ invoiceId: Schema.String }),
  encodePayload: Codec.encodeJobPayload
})
```

### Application server

`db`, `ApplicationTransactions` and `backend` share the **same native PgClient**.
`transact` invokes real Drizzle `db.transaction` with the pinned declaration
correction; `register` captures its active connection. These are application-owned
helpers, not library APIs or a universal Drizzle adapter.

```ts
const issueInvoice = (operationId: string, invoiceId: string) =>
  ApplicationTransactions.sanitizeControls(
    transact(db, (invoiceTx) =>
      ApplicationTransactions.register((handle) =>
        backend.joinTransaction(handle, (jobsTx) =>
          Effect.gen(function* () {
            yield* invoiceTx
              .insert(invoices)
              .values({ id: invoiceId })
              .onConflictDoNothing({ target: invoices.id })
            const job = yield* SendReceipt.enqueue(jobsTx, {
              producer: IssueInvoice.identity({ operationId, slot: "receipt" }),
              payload: { invoiceId },
              policy: JobPolicy.make()
            })
            yield* invoiceTx
              .insert(receipts)
              .values({ id: operationId, jobId: job.jobId })
              .onConflictDoNothing({ target: receipts.id })
            return job
          })
        )
      )
    )
  ) // Invoice, immutable job/payload and operation receipt commit together.
```

Reuse both IDs on request retries. This example creates an invoice identity; your
application owns invoice contents and domain idempotency. Matching job duplicates
return the original job ID and keep its first policy; changed content conflicts.
Enqueue is provisional until the outer commit. Unknown commit outcomes require
application reconciliation. [Exact-source transaction contract](specs/drizzle-compatibility.md#actual-driver-and-application-bridge).

### Consumer / worker process

The worker connects to the same jobs tables. `ReceiptMailer` is your application's
invoice-loading/email service, with provider failures mapped to bounded `JobFailure`
values. It uses the job ID as the provider idempotency key; the provider must support
that contract. Handlers receive payload/context, without a transaction capability.

```ts
const HandlerLayer = SendReceipt.handlerLayer(
  ({ payload, context }) =>
    Effect.gen(function* () {
      const mailer = yield* ReceiptMailer
      yield* mailer.send({ invoiceId: payload.invoiceId, idempotencyKey: context.jobId })
    }),
  Codec.decodeJobPayload
)
const WorkerLayer = Worker.layer(backend.store, {
  catalog: [SendReceipt],
  operationResponseBudgetMillis: 100 // Match the backend.
}).pipe(
  Layer.provideMerge(HandlerLayer),
  Layer.provide(Registry.layer),
  Layer.provide(ReceiptMailerLayer)
)
```

Start polling at the worker's application boundary; its Scope owns shutdown:

```ts
const runWorker = Effect.gen(function* () {
  yield* backend.ready // Application migrations have already run.
  const consumer = yield* Consumer.make(BillingQueue, {
    localConcurrency: 2,
    claimLimitPerRun: 20,
    recoveryLimitPerRun: 20
  })
  const plan = yield* Consumer.plan(consumer)
  const PollingLayer = Polling.layerForPlan(plan).pipe(Layer.provide(WorkerLayer))
  yield* Effect.never.pipe(Effect.provide(PollingLayer))
}).pipe(Effect.scoped) // Run explicitly; interrupt to close the worker Scope.
```

For a finite batch, replace the plan/polling lines with
`yield* Runtime.drain(consumer).pipe(Effect.provide(WorkerLayer))`.
Imports and construction start no workers. Keep concurrency consistent per queue.

## Retry a busy provider; reconcile a lost response

```ts
const policy = JobPolicy.make({
  retryDelay: Duration.seconds(5),
  maxAttempts: 3,
  completedRetention: Duration.days(90),
  deadRetention: Duration.infinity
}) // Pass at enqueue; the first insertion persists the complete policy.
const rejected = Effect.fail(JobFailures.Retry({ code: "provider_busy" }))
const uncertain = Effect.fail(JobFailures.OutcomeUnknown({ code: "response_lost" }))
```

At-least-once execution, fixed nonrenewing leases and database time. A timeout
cannot prove an email was not sent. Cleanup is explicit and bounded; removing
identity evidence ends deduplication. Coordinate receipt/OTP retention; never
purge Pending/Active/Isolated. [Lifecycle and cleanup](specs/architecture-decisions.md#d8--replaceable-cleanup-with-application-domain-retention-integration).

## Keep private receipt data protected

Prefer an opaque invoice reference in the job; load private details in your handler.
If private data must travel in a payload, supply an already sealed envelope:

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
```

The marker does no encryption. Use separate encryption/fingerprint keys, retain
old decryption keys and preserve OTP binding. Never log payloads, IDs, SQL,
provider errors or keys. [Protection and codec bounds](specs/architecture-decisions.md#d5--explicit-application-owned-protection-and-codec-boundaries).

## Install and application-owned setup

```sh
npm install effect-jobs@0.1.0-alpha.0 effect@4.0.0
# For the specific native Drizzle application shown above:
npm install drizzle-orm@1.0.0-rc.5-169397b @effect/sql-pg@4.0.0
```

Use focused package subpaths; the root export is empty. Drizzle is optional for
the core. Applications own pools, readiness, service Layers and migrations.
[Complete real-PG setup](tests/qualification/drizzle-native/NativeQualification.mts).

Qualified pins: Node 24.15.0 / Bun 1.4.2, Effect 4.0.0, PostgreSQL 16.15 / pg 8.23.0,
native Drizzle 1.0.0-rc.5-169397b / @effect/sql-pg 4.0.0.
[Alpha limits](specs/release-qualification.md#limits-and-preserved-evidence): upstream
Drizzle strict declarations fail; other adapters/versions, server crashes, arbitrary
network faults and Cloudflare deployment are unqualified. Recurring schedules,
admin APIs and other backends are outside this alpha.

Development: `bun install --frozen-lockfile`, `bun run build`, `bun run verify`,
`bun run check:postgresql`; [real-PG/installed gates](specs/release-qualification.md).
No installation lifecycle scripts. [MIT](LICENSE).

### Migrations (run with application migration credentials)

```ts
const tables = PostgreSqlSchema.tables({ schema: "billing" })
const migrationSql = PostgreSqlSchema.migration(tables)
// Execute DDL in your application migration; configure the backend with this mapping.
```

Optional Drizzle migration declarations use the same mapping:

```ts
const jobTables = makeJobTables(tables)
// Declarations only; runtime never migrates and no universal transaction adapter ships.
```
