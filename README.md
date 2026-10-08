# effect-jobs

Commit the invoice. Let another process send the receipt. Keep the job when your server restarts.

```ts
const SendReceipt = Job.make({
  queue: JobQueue.make("billing"),
  kind: "invoice.receipt",
  payload: Schema.Struct({ invoiceId: Schema.String })
})

const IssueInvoice = JobProducer.make({
  operation: "billing.issue-invoice",
  slots: ["receipt"]
})

// App setup: its Layer supplies a qualified PostgreSqlApplication adapter.
const jobsStorage = yield* PostgreSqlJobs.make({
  operationResponseBudgetMillis: 100
}).pipe(Effect.provide(ApplicationPostgresLayer))

// Application: invoice and job commit together, or neither does.
yield* jobsStorage.withTransaction(() =>
  Effect.gen(function* () {
    yield* invoices.create({ id: invoiceId }) // Uses this same application transaction.
    yield* SendReceipt.enqueue({
      producer: IssueInvoice.identity({ operationId, slot: "receipt" }),
      payload: { invoiceId },
      policy: JobPolicy.defaultPolicy
    })
  })
)

// Worker: typed payload, separate deployment, durable retries.
const ReceiptHandler = SendReceipt.handlerLayer(
  ({ payload, context }) =>
    Effect.gen(function* () {
      const mailer = yield* ReceiptMailer

      yield* mailer.send({
        invoiceId: payload.invoiceId,
        idempotencyKey: context.jobId // Execution is at least once, not exactly once.
      })
    }),
  Codec.decodeJobPayload
)
```

**Initial alpha · Effect · PostgreSQL · transaction-bound enqueue**

## Install

Examples target `0.1.0-alpha.1`. This prerelease changes the alpha.0 enqueue,
policy, failure-code and encrypted-payload APIs; update callers before upgrading.

```sh
npm install effect-jobs@0.1.0-alpha.1 effect@4.0.0
```

Imports are omitted below. Use package subpaths (`effect-jobs/Job`, `effect-jobs/JobPolicy`, …); the root export is empty. `Codec` refers to `JobPayloadCodec`; `Consumer`, `Worker`, `Runtime`, `Polling` and `Registry` refer to the corresponding `JobConsumer`, `JobWorker`, `JobWorkerRuntime`, `PollingJobWorker` and `JobRegistry` modules.

`invoices`, mailers, credentials and protection services are application code, not library exports. Handler services return explicit `JobFailure` values.

`NodeRuntime` is `@effect/platform-node/NodeRuntime`.
`PgClient` is `@effect/sql-pg/PgClient`; `PostgreSqlNative` is the library module
of the same name. The application provides its scoped `PgClient` Layer, with
finite connection, statement and idle transaction timeouts.

`FailureCode` is the `effect-jobs/FailureCode` module; `JobEnqueue` is the service
exported by `effect-jobs/JobEnqueue`. Job version defaults to `1`, and the standard
payload encoder is implicit. Custom versions/encoders remain explicit options.

## One definition, multiple applications

Share the contract, not the email provider or database connection.

```ts
// packages/billing-jobs/receipt.ts — imported by both producer and consumer
export const BillingQueue = JobQueue.make("billing")

export const SendReceipt = Job.make({
  queue: BillingQueue,
  kind: "invoice.receipt",
  payload: Schema.Struct({ invoiceId: Schema.String })
})

export const IssueInvoice = JobProducer.make({
  operation: "billing.issue-invoice",
  slots: ["receipt"]
})
```

```ts
// apps/api — owns invoice writes; does not import the email provider
const issueInvoice = (operationId: string, invoiceId: string) =>
  jobsStorage.withTransaction(() =>
    Effect.gen(function* () {
      yield* invoices.createOnce({ operationId, invoiceId })

      return yield* SendReceipt.enqueue({
        producer: IssueInvoice.identity({ operationId, slot: "receipt" }),
        payload: { invoiceId },
        policy: receiptPolicy
      })
    })
  )
```

```ts
// apps/billing-worker — owns email credentials; does not import the API
const ReceiptHandler = SendReceipt.handlerLayer(
  ({ payload, context }) =>
    Effect.gen(function* () {
      const mailer = yield* ReceiptMailer

      yield* mailer.send({
        invoiceId: payload.invoiceId,
        idempotencyKey: context.jobId
      })
    }),
  Codec.decodeJobPayload
)
```

Reuse `operationId` and `invoiceId` on request retries. Matching enqueues return the original job ID; changed content conflicts. Domain idempotency is still yours. `invoices.createOnce` must use the adapter's active transaction, not a separate connection.

### One operation, two consequences

Slots name independent consequences of the same business operation. Issuing an
invoice can send a receipt and generate a PDF without their enqueue identities
colliding:

```ts
const IssueInvoiceWithPdf = JobProducer.make({
  operation: "billing.issue-invoice-with-pdf",
  slots: ["send-receipt", "generate-pdf"]
})

// Inside the application's transaction; GeneratePdf is another job definition.
yield* SendReceipt.enqueue({
  producer: IssueInvoiceWithPdf.identity({ operationId, slot: "send-receipt" }),
  payload: { invoiceId },
  policy: JobPolicy.defaultPolicy
})

yield* GeneratePdf.enqueue({
  producer: IssueInvoiceWithPdf.identity({ operationId, slot: "generate-pdf" }),
  payload: { invoiceId },
  policy: JobPolicy.defaultPolicy
})
```

Retrying with the same operation ID and slots returns the existing matching jobs.
Declared slots are checked by TypeScript. A slot names the consequence, not the
job kind: two slots can enqueue the same job kind. Slots do not impose execution
order or dependencies between jobs.

## Long-running Node.js worker

Producer and consumer connect to the same PostgreSQL jobs tables.

```ts
// The same app-owned PgClient is used by native Drizzle and this adapter.
const client = yield* PgClient.PgClient
const ApplicationPostgresLayer = PostgreSqlNative.layer({
  client,
  operationTimeoutMillis: 2000
})
const jobsStorage = yield* PostgreSqlJobs.make({
  operationResponseBudgetMillis: 100
}).pipe(Effect.provide(ApplicationPostgresLayer))

const WorkerLayer = Worker.layer(jobsStorage.store, {
  catalog: [SendReceipt],
  operationResponseBudgetMillis: 100 // Same budget as the backend.
}).pipe(
  Layer.provideMerge(ReceiptHandler),
  Layer.provide(Registry.layer),
  Layer.provide(ReceiptMailerLayer)
)

const runWorker = Effect.gen(function* () {
  yield* jobsStorage.ready // Checks readiness; does not run migrations.

  const billing = yield* Consumer.make(BillingQueue, {
    localConcurrency: 2, // Max simultaneous handlers in this consumer instance.
    claimLimitPerRun: 20, // Max jobs claimed during one bounded drain.
    recoveryLimitPerRun: 20 // Max expired leases processed for recovery per drain.
  })

  const plan = yield* Consumer.plan(billing)
  const PollingLayer = Polling.layerForPlan(plan).pipe(Layer.provide(WorkerLayer))

  yield* Effect.never.pipe(Effect.provide(PollingLayer))
}).pipe(Effect.scoped)

NodeRuntime.runMain(runWorker)
```

The Scope owns polling shutdown. Construction starts no workers. `localConcurrency` is per consumer instance, not a global queue limit; keep queue configuration consistent across replicas.

For a bounded invocation instead of a server:

```ts
yield* Runtime.drain(billing).pipe(Effect.provide(WorkerLayer))
// One bounded run, not “wait until every future retry has finished”.
```

The backend exposes its producer service as `jobsStorage.producer`.
Provide it as `JobEnqueue` to effects that call `enqueue` or `enqueueStandalone`.
`PostgreSqlNative.layer({ client, operationTimeoutMillis })` bridges the exact
application-owned `PgClient@4.0.0`, including its active `transactionService`.
Native `drizzle-orm/effect-postgres` transactions on that same client support
ambient enqueue; missing or foreign-client transactions fail before preparation.
Pools, keys, timeouts and transaction ownership remain application-owned.

```ts
// nativeDrizzle is drizzle-orm/effect-postgres; invoiceTable is app-owned.
const db = yield* nativeDrizzle.makeWithDefaults()

yield* db
  .transaction((tx) =>
    Effect.gen(function* () {
      yield* tx.insert(invoiceTable).values({ id: invoiceId })

      return yield* SendReceipt.enqueue({
        producer: IssueInvoice.identity({ operationId, slot: "receipt" }),
        payload: { invoiceId },
        policy: JobPolicy.defaultPolicy
      })
    })
  )
  .pipe(Effect.provideService(JobEnqueue, jobsStorage.producer))
```

Alternatively, `jobsStorage.withTransaction` delegates to the same client manager
and supplies `JobEnqueue`, as used by `issueInvoice`. Provide the scoped native
PgClient Layer around the whole application; defining a Layer alone starts no work.

`enqueue` requires an active transaction. For a job with no accompanying domain
write, `enqueueStandalone` opens its own transaction and rejects active ones:

```ts
yield* SendReceipt.enqueueStandalone({
  producer: IssueInvoice.identity({ operationId, slot: "receipt" }),
  payload: { invoiceId },
  policy: JobPolicy.defaultPolicy
}).pipe(Effect.provideService(JobEnqueue, jobsStorage.producer))
```

## Choose what a failure means

A receipt provider can reject a request, accept it, or leave you unable to tell which happened.

This handler uses the public `invoiceId` payload, not an encrypted document.
Define validated diagnostic codes before starting the worker:

```ts
const Codes = FailureCode.define({
  ReceiptUnreadable: "receipt_unreadable",
  ResponseLost: "response_lost",
  ProviderBusy: "provider_busy",
  InvalidRecipient: "invalid_recipient",
  ProviderCredentials: "provider_credentials",
  Unconfirmed: "unconfirmed"
})
```

```ts
const ReceiptHandler = SendReceipt.handlerLayer(
  ({ payload, context }) =>
    Effect.gen(function* () {
      const templates = yield* ReceiptTemplates
      const provider = yield* EmailProvider

      const email = yield* templates
        .load(payload.invoiceId)
        .pipe(
          Effect.mapError(() => JobFailures.Isolate({ code: Codes.ReceiptUnreadable }))
        )

      // Application adapter contract: bounded outcomes, no raw provider errors.
      const result = yield* provider
        .send({
          email,
          idempotencyKey: context.jobId
        })
        .pipe(
          Effect.mapError(() => JobFailures.OutcomeUnknown({ code: Codes.ResponseLost }))
        )

      return yield* Match.value(result).pipe(
        Match.tag("Accepted", () => Effect.void),
        // Provider confirms the request was not accepted.
        Match.tag("RateLimited", () =>
          Effect.fail(JobFailures.Retry({ code: Codes.ProviderBusy }))
        ),
        Match.tag("InvalidRecipient", () =>
          Effect.fail(JobFailures.Dead({ code: Codes.InvalidRecipient }))
        ),
        Match.tag("CredentialsRejected", () =>
          Effect.fail(JobFailures.Isolate({ code: Codes.ProviderCredentials }))
        ),
        Match.tag("Unconfirmed", () =>
          Effect.fail(JobFailures.OutcomeUnknown({ code: Codes.Unconfirmed }))
        ),
        Match.exhaustive
      )
    }),
  Codec.decodeJobPayload
)
```

| Outcome          | Use it when                                  |
| ---------------- | -------------------------------------------- |
| `Retry`          | Another attempt is safe and may succeed.     |
| `Dead`           | This job cannot succeed; stop attempting it. |
| `Isolate`        | Quarantine the job for investigation.        |
| `OutcomeUnknown` | The side effect may already have happened.   |

A timeout is not proof that no email was sent. Unknown outcomes use bounded lease recovery, not a normal finalized retry; attempt numbers can repeat. Keep the provider key and body stable, and reconcile before its idempotency window expires. Never persist raw errors or sensitive response bodies as failure codes.

## Policy belongs to the job

```ts
const receiptPolicy = JobPolicy.make({
  attemptTimeout: Duration.seconds(20), // Time budget for one handler execution.
  leaseDuration: Duration.seconds(60), // Fixed, nonrenewing; must exceed timeout.
  retryDelay: Duration.seconds(10), // Fixed delay, not exponential backoff.
  maxAttempts: 4, // Includes the first finalized attempt.
  maxStalledCount: 1, // Separate bound for stalled recovery.
  completedRetention: Duration.days(30), // Completed jobs become cleanup-eligible after 30 days.
  deadRetention: Duration.infinity // Retain failures for investigation.
})

yield* SendReceipt.enqueue({
  producer: IssueInvoice.identity({ operationId, slot: "receipt" }),
  payload: { invoiceId },
  policy: receiptPolicy,
  availableAt: deliveryTimeMillis // Optional initial eligibility, epoch milliseconds.
})
```

Policy is persisted at enqueue. Changing this constant affects new jobs, not existing ones; a matching duplicate keeps its first policy. Retention makes terminal jobs eligible for explicit cleanup—it does not start a cleanup worker. Removing identity evidence ends deduplication.

## Encrypt only what needs to travel

An opaque `invoiceId` plus a handler-side lookup is often enough. Otherwise bind
the document schema to an application encryption codec. Enqueue accepts domain
data; the handler receives decrypted, validated domain data.

```ts
// Plaintext document contract — shared by producer and consumer.
const ReceiptDocument = Schema.Struct({
  recipient: Schema.String,
  invoiceNumber: Schema.String,
  total: Schema.Struct({ amount: Schema.String, currency: Schema.String })
})

const SendPrivateReceipt = Job.make({
  queue: BillingQueue,
  kind: "invoice.private-receipt",

  payload: Schema.Struct({
    invoiceId: Schema.String,

    document: JobPayload.encrypted({
      schema: ReceiptDocument,
      codec: ReceiptEncryption
    })
  })
})

const PrivateReceiptProducer = JobProducer.make({
  operation: "billing.private-receipt",
  slots: ["receipt"]
})

const receipt = yield* Schema.decodeUnknownEffect(ReceiptDocument)({
  recipient: "alex@example.com",
  invoiceNumber: "INV-2026-1042",
  total: { amount: "49.00", currency: "EUR" }
})

yield* jobsStorage.withTransaction(() =>
  SendPrivateReceipt.enqueue({
    producer: PrivateReceiptProducer.identity({ operationId, slot: "receipt" }),
    payload: { invoiceId, document: receipt },
    policy: receiptPolicy
  })
)
```

```ts
const PrivateReceiptHandler = SendPrivateReceipt.handlerLayer(
  ({ payload, context }) =>
    Effect.gen(function* () {
      const mailer = yield* PrivateReceiptMailer

      yield* mailer.send({ document: payload.document, idempotencyKey: context.jobId })
    }),
  Codec.decodeJobPayload
)
```

`ReceiptEncryption` is an application codec with `envelope`, `seal` and `open`.
It seals the schema's encoded document and opens it before domain validation.
Its JSON envelope must contain `fingerprint`; other fields and the encryption
algorithm are application-owned. Use authenticated encryption and a separate,
stable keyed fingerprint independent of nonce/ciphertext randomness.

Provide the codec's required key service Layers to both producer and consumer;
validate configured keys before worker startup. No remote KMS retry contract is
provided. Never log plaintext or keys. Register the private job and handler too.
`JobPayload.protected` remains the lower-level marker for already-sealed values.

## Cloudflare + Alchemy

**Declaration-checked wiring with Alchemy `2.0.0-beta.81`; external PostgreSQL
on Cloudflare is NotTested.** A Workers-compatible PostgreSQL application adapter
and its service composition are still required.

```text
Application Worker ── commit invoice + two jobs ──▶ PostgreSQL
        │                                        ▲
        └── wake ──▶ Durable Object ── drain ──────┘
                     alarm / execution           jobs / payloads / retries
```

Start with **one named DO per logical queue**, not one per job. That is an application topology, not a library requirement. Jobs live in PostgreSQL; the DO hosts bounded execution and wakeups.

This consumer handles two job kinds in the same billing queue: receipt email and
invoice PDF. Each consequence has its own producer slot.

```ts
// Shared definitions: reuse SendReceipt and BillingQueue from above.
const GeneratePdf = Job.make({
  queue: BillingQueue,
  kind: "invoice.generate-pdf",
  payload: Schema.Struct({ invoiceId: Schema.String })
})

const CloudInvoiceProducer = JobProducer.make({
  operation: "billing.cloudflare.issue-invoice",
  slots: ["send-receipt", "generate-pdf"]
})

// Consumer composition: application mailer/PDF services own external effects.
const PdfHandler = GeneratePdf.handlerLayer(
  ({ payload, context }) =>
    Effect.gen(function* () {
      const renderer = yield* InvoicePdfRenderer

      yield* renderer.generate({
        invoiceId: payload.invoiceId,
        idempotencyKey: context.jobId
      })
    }),
  Codec.decodeJobPayload
)

const BillingWorkerLayer = Worker.layer(jobsStorage.store, {
  catalog: [SendReceipt, GeneratePdf],
  operationResponseBudgetMillis: 100
}).pipe(
  Layer.provideMerge(Layer.mergeAll(ReceiptHandler, PdfHandler)),
  Layer.provide(Registry.layer),
  Layer.provide(Layer.mergeAll(ReceiptMailerLayer, InvoicePdfRendererLayer))
)
```

```ts
// src/billing-consumer.ts — one Effect-native DO handles both job kinds.
export class BillingConsumer extends Cloudflare.DurableObject<BillingConsumer>()(
  "BillingConsumer",
  Effect.gen(function* () {
    return Effect.gen(function* () {
      const drain = yield* Alchemy.makeCallback(
        "drain-billing",
        Effect.fn(function* (_payload: null) {
          yield* jobsStorage.ready

          const billing = yield* Consumer.make(BillingQueue, {
            localConcurrency: 2,
            claimLimitPerRun: 20,
            recoveryLimitPerRun: 20
          })

          yield* Runtime.drain(billing).pipe(Effect.provide(BillingWorkerLayer))
        })
      )

      return {
        wake: () => drain.schedule("billing", { after: "1 second", payload: null })
      }
    })
  })
) {}
```

```ts
// src/invoice-application.ts — internal RPC; authenticate any public HTTP API.
export default Cloudflare.Worker(
  "InvoiceApplication",
  { main: import.meta.url },
  Effect.gen(function* () {
    const consumers = yield* BillingConsumer

    return {
      issueInvoice: Effect.fn(function* (operationId: string, invoiceId: string) {
        const jobs = yield* jobsStorage
          .withTransaction(() =>
            Effect.gen(function* () {
              yield* invoices.createOnce({ operationId, invoiceId })

              const receipt = yield* SendReceipt.enqueue({
                producer: CloudInvoiceProducer.identity({
                  operationId,
                  slot: "send-receipt"
                }),
                payload: { invoiceId },
                policy: JobPolicy.defaultPolicy
              })

              const pdf = yield* GeneratePdf.enqueue({
                producer: CloudInvoiceProducer.identity({
                  operationId,
                  slot: "generate-pdf"
                }),
                payload: { invoiceId },
                policy: JobPolicy.defaultPolicy
              })

              return { receipt: receipt.jobId, pdf: pdf.jobId }
            })
          )
          .pipe(Effect.provideService(JobEnqueue, jobsStorage.producer))

        yield* consumers.getByName("billing").wake() // After both jobs commit.

        return jobs
      })
    }
  })
)
```

```ts
// alchemy.run.ts
export default Alchemy.Stack(
  "Billing",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const application = yield* InvoiceApplication

    return { application: application.workerName }
  })
)
```

One callback drains one bounded batch. **You still need subsequent wakeups for backlog, delayed jobs and retries, plus repair of missed wakeups.** PostgreSQL commit and DO scheduling are not atomic; a failed wake does not mean the invoice rolled back. Alchemy owns its alarms—do not set competing alarms manually.

Besides calling `wake()` after commit, plan application-owned periodic wakeups
to check delayed jobs, retries and expired leases. Start them explicitly and
use an external Cron Trigger to repair missed wakeups. Alchemy owns native alarms;
periodic scheduling is conceptual here, without a qualified recursive callback.

Both jobs commit with the invoice or neither does. Reusing the operation ID
deduplicates each slot independently. Email and PDF execution are independent:
the receipt handler must not assume the PDF has already been generated.

Start with one DO and concurrency `2`; add named consumers only after measuring throughput and provider limits. More DOs increase aggregate concurrency, not storage capacity. These fragments omit Workers-specific connections and service composition; Node's PostgreSQL setup cannot simply be reused unchanged.

## Alpha boundaries

PostgreSQL only. Application-owned adapters, pools, migrations and cleanup. No recurring scheduler or admin API. Every TypeScript fence is extracted and declaration-checked against source and
the packed alpha.1 artifact. Node/Bun composition, handler, codec and encryption
checks use explicit application fixtures. Real native PostgreSQL transaction
gates are separate. Cloudflare external PostgreSQL, deployment, server crashes
and arbitrary network faults are NotTested; upstream full strict Drizzle
declaration failure remains a separately recorded limitation.

[Transaction integration](specs/drizzle-compatibility.md) · [Lifecycle and protection](specs/architecture-decisions.md) · [Release qualification](specs/release-qualification.md) · [MIT](LICENSE)

## Migrations

Run DDL through your application's migration system, with migration credentials—not at worker startup.

```ts
// Application migration
const tables = PostgreSqlSchema.tables() // public.jobs and public.job_payloads

const ddl = PostgreSqlSchema.migration(tables)
// Execute `ddl` using your migration runner.

// Runtime: configure the same schema/table mapping, without DDL permissions.
const jobsStorage = yield* PostgreSqlJobs.make({
  ...tables,
  operationResponseBudgetMillis: 100
}).pipe(Effect.provide(ApplicationPostgresLayer))

yield* jobsStorage.ready
```

```ts
// Optional Drizzle declarations; not a transaction adapter or migration runner.
const jobTables = makeJobTables(tables)
```

Application-owned dashboard indexes can extend the declarations without changing
library columns or required indexes:

```ts
const jobTables = makeJobTables({
  ...tables,

  extraIndexes: (jobs) => [
    index("jobs_dashboard").on(jobs.operation, jobs.slot, jobs.state, jobs.id)
  ]
})
```

Generate migrations from these declarations. The SQL migration helper includes
only the library's baseline indexes; it does not know about `extraIndexes`.

Payload versions are separate from database migrations. For an incompatible payload change, publish a new job version and keep the old definition/handler registered until old jobs no longer need it.
