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
  payload: Schema.Struct({ invoiceId: Schema.String })
})
// backend and renderInvoice are supplied by the application.
const enqueue = (operationId: string, invoiceId: string) =>
  backend.withTransaction(() =>
    GenerateInvoice.enqueue({
      producer: Producer.identity({ operationId, slot: "generate" }),
      payload: { invoiceId },
      policy: JobPolicy.defaultPolicy
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
changed content conflicts. Enqueue is provisional until commit. Omitted version is
exactly 1; incompatible payload changes require an explicit new version and its decoder.
The standard encoder is the default; `encodePayload` remains an explicit override. Handlers receive
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
// extraIndexes: (jobs) => [index("app_jobs_by_state").on(jobs.state, jobs.id)]
// Custom indexes are tracked by application Drizzle migrations.
```

[Qualified Effect-native Drizzle integration](specs/drizzle-compatibility.md).

## Join a business transaction

Configure `PostgreSqlNative.layer({ client, operationTimeoutMillis: 2000 })` with
the same application-owned `PgClient` used by native Drizzle, then provide
`PostgreSqlJobs.layerNoDeps`. Its Layer supplies the generic `JobEnqueue` service.
An active transaction of that exact client is required; absence is a typed error.
Native Drizzle `db.transaction(tx => Effect.gen(...))` joins the same context.
The application owns invoice/receipt tables, pools, migrations and finite client timeouts.

```ts
const issueInvoice = client
  .withTransaction(
    Effect.gen(function* () {
      yield* client.unsafe("INSERT INTO billing.invoices (id) VALUES ($1)", [invoiceId])
      const job = yield* GenerateInvoice.enqueue({
        producer: Producer.identity({ operationId, slot: "generate" }),
        payload: { invoiceId },
        policy: JobPolicy.defaultPolicy
      })
      yield* client.unsafe("INSERT INTO billing.receipts (id, job_id) VALUES ($1, $2)", [
        operationId,
        job.jobId
      ])
      return job
    })
  )
  .pipe(Effect.provideService(JobEnqueue, backend.producer))
// All writes commit or roll back under the outer owner.
```

No fallback connection, savepoint or replay. Unknown commit outcomes need
application reconciliation. `enqueueStandalone(input)` owns a bounded atomic
transaction and resolves after acknowledged commit; it rejects an active configured-client
transaction. `backend.withTransaction(() => job.enqueue(input))` provides the producer
service explicitly. `enqueueInTransaction(tx, input)` remains the focused primitive for
qualified explicit-handle adapters, independently of native ambient composition.
[Handle and atomicity requirements](specs/postgresql-backend.md#explicit-application-adapter-contract).

## Persist retries and retention

```ts
const policy = JobPolicy.make({
  retryDelay: Duration.seconds(5),
  maxAttempts: 3,
  completedRetention: Duration.days(90),
  deadRetention: Duration.infinity
}) // Other fields use defaults; first enqueue persists the complete policy.
const Codes = FailureCodes.define({
  providerBusy: "provider_busy",
  responseLost: "response_lost"
})
const rejected = Effect.fail(JobFailures.Retry({ code: Codes.providerBusy }))
const uncertain = Effect.fail(JobFailures.OutcomeUnknown({ code: Codes.responseLost }))
```

Define catalogs before startup. Codes preserve literals, are branded and accept
1–128 identifier characters; `FailureCodes.parse(dynamic)` returns a validation Result.
Storage does not require membership in the current catalog. Valid syntax does not
prove that a code contains no secrets.

At-least-once execution, fixed nonrenewing leases and database time; a timeout
cannot prove an external effect failed. Cleanup is explicit and bounded; coordinate
receipt/OTP retention, never purge Pending/Active/Isolated. Removing identity
evidence ends deduplication. [Lifecycle and cleanup](specs/architecture-decisions.md#d8--replaceable-cleanup-with-application-domain-retention-integration).

## Encrypt domain fields with application codecs

```ts
const ReceiptDocument = Schema.Struct({ recipient: Schema.String, amount: Schema.Finite })
const EncryptedDocument = JobPayload.encrypted({
  schema: ReceiptDocument,
  codec: ReceiptEncryption
})
const SendReceipt = Job.make({
  queue: JobQueue.make("billing"),
  kind: "receipt.send",
  payload: Schema.Struct({ invoiceId: Schema.String, document: EncryptedDocument })
})
// enqueue accepts the domain document; the handler receives validated domain fields.
```

`ReceiptEncryption` is application-owned: declare its envelope Schema, seal the
**encoded** domain representation, and open it back to that representation. Its
Effect service requirements flow through enqueue and handler Layers. Application
Layers load/validate configured keys before startup; no import or `Job.make` reads
keys. All encrypted fields open before the handler. Structs, arrays, optionals and
unions are supported; encrypted-within-encrypted is explicitly rejected.
Keep stable keyed fingerprints separate from randomized encryption and key rotation.
The helper supplies no crypto algorithm, AAD or remote KMS retry contract. Malformed
artifacts follow existing bounded decode/isolation; arbitrary defects/interruption
keep their existing behavior. Admin listings do not decode automatically.
[Concrete typed contract and qualification](specs/api-refinements.md).

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
