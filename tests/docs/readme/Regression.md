# Installed composition regression fixtures

These former README examples retain the existing independent type and runtime checks.

```ts
const BillingQueue = yield* JobQueue.make("billing")
const SendReceipt = yield* Job.make({
  name: "invoice.receipt",
  payload: Schema.Struct({ invoiceId: Schema.String })
})

const IssueInvoice = yield* JobProducer.make("billing.issue-invoice").pipe(
  JobProducer.withSlot("receipt", SendReceipt, { queue: BillingQueue })
)

// App setup: its Layer supplies a qualified PostgreSqlApplication adapter.
const jobs =
  yield *
  PostgreSqlJobs.make({
    operationResponseBudget: Duration.millis(100)
  }).pipe(Effect.provide(ApplicationPostgresLayer))

// Application: invoice and job commit together, or neither does.
yield *
  jobs.withTransaction(() =>
    Effect.gen(function* () {
      yield* invoices.create({ id: invoiceId }) // Uses this same application transaction.
      yield* IssueInvoice.enqueue({
        operationId,
        slot: "receipt",
        payload: { invoiceId }
      })
    })
  )

// Worker: typed payload, separate deployment, durable retries.
const BillingJobs = yield* JobGroup.make("billing", { receipt: SendReceipt })
const ApplicationJobs = yield* JobApi.make("application").pipe(JobApi.addGroup(BillingJobs))
const ReceiptHandler = JobGroup.handlers(BillingJobs, (handlers) =>
  handlers.handle("receipt", (input) =>
    Effect.gen(function* () {
      const mailer = yield* ReceiptMailer

      yield* mailer.send({
        invoiceId: input.payload.invoiceId,
        idempotencyKey: input.context.jobId // Execution is at least once, not exactly once.
      })
    })
  )
)
```

```ts
// packages/billing-jobs/receipt.ts — build once in each application's live graph.
export const DefinitionsProgram = Effect.gen(function* () {
  const BillingQueue = yield* JobQueue.make("billing")
  const SendReceipt = yield* Job.make({
    name: "invoice.receipt",
    payload: Schema.Struct({ invoiceId: Schema.String })
  })
  const BillingJobs = yield* JobGroup.make("billing", { receipt: SendReceipt })
  const ApplicationJobs = yield* JobApi.make("application").pipe(JobApi.addGroup(BillingJobs))
  return { BillingQueue, SendReceipt, BillingJobs, ApplicationJobs }
})
export class Definitions extends Context.Service<
  Definitions,
  Effect.Success<typeof DefinitionsProgram>
>()("billing/Definitions") {}
export const DefinitionsLayer = Layer.effect(Definitions, DefinitionsProgram)
```

```ts
// apps/api — capture the producer once, then expose it to requests.
const ApplicationProgram = Effect.gen(function* () {
  const definitions = yield* Definitions
  const IssueInvoice = yield* JobProducer.make("billing.issue-invoice").pipe(
    JobProducer.withSlot("receipt", definitions.SendReceipt, { queue: definitions.BillingQueue })
  )
  const issueInvoice = (operationId: string, invoiceId: string) =>
    jobs.withTransaction(() => Effect.gen(function* () {
      yield* invoices.createOnce({ operationId, invoiceId })
      return yield* IssueInvoice.enqueue({ operationId, slot: "receipt", payload: { invoiceId } })
    }))
  return { IssueInvoice, issueInvoice }
})
class InvoiceApplication extends Context.Service<
  InvoiceApplication,
  Effect.Success<typeof ApplicationProgram>
>()("billing/InvoiceApplication") {}
const InvoiceApplicationLayer = Layer.effect(InvoiceApplication, ApplicationProgram)
  .pipe(Layer.provide(DefinitionsLayer))
// Requests yield InvoiceApplication; enqueue never rebuilds setup.
```

```ts
// apps/billing-worker — owns email credentials; does not import the API
const ReceiptHandler = Layer.unwrap(Effect.map(Definitions, (definitions) =>
  JobGroup.handlers(definitions.BillingJobs, (handlers) =>
  handlers.handle("receipt", (input) =>
    Effect.gen(function* () {
      const mailer = yield* ReceiptMailer

      yield* mailer.send({
        invoiceId: input.payload.invoiceId,
        idempotencyKey: input.context.jobId
      })
    })
  )
)
))
```

```ts
const definitions = yield* Definitions
const { BillingQueue, SendReceipt } = definitions
const GeneratePdf = yield* Job.make({ name: "invoice.generate-pdf", payload: Schema.Struct({ invoiceId: Schema.String }) })
const PriorityBillingQueue = yield* JobQueue.make("billing-priority")
const IssueInvoiceWithPdf = yield* JobProducer.make("billing.issue-invoice-with-pdf").pipe(
  JobProducer.withSlot("send-receipt", SendReceipt, { queues: [BillingQueue, PriorityBillingQueue] }),
  JobProducer.withSlot("generate-pdf", GeneratePdf, { queue: BillingQueue })
)

// Inside the application's transaction; GeneratePdf is another job definition.
const priorityPolicy = yield* JobPolicy.make({
  retry: Retry.fixed(Duration.seconds(2)).pipe(Retry.maxFinalizedAttempts(4))
})

yield* IssueInvoiceWithPdf.enqueue({
  operationId, slot: "send-receipt",
  payload: { invoiceId },
  queue: PriorityBillingQueue.name,
  policy: priorityPolicy
})

yield* IssueInvoiceWithPdf.enqueue({
  operationId, slot: "generate-pdf",
  payload: { invoiceId }
})
```

```ts
const definitions = yield* Definitions
const { BillingQueue, ApplicationJobs } = definitions
// The same app-owned PgClient is used by native Drizzle and this adapter.
const client = yield * PgClient.PgClient
const ApplicationPostgresLayer = PostgreSqlNative.layer({
  client,
  operationTimeout: Duration.seconds(2)
})
const jobs =
  yield *
  PostgreSqlJobs.make({
    operationResponseBudget: Duration.millis(100)
  }).pipe(Effect.provide(ApplicationPostgresLayer))

const WorkerLayer = Worker.layer(
  ApplicationJobs,
  {
    queues: [{ queue: BillingQueue, concurrency: 2 }]
  }
).pipe(
  Layer.provide(Layer.succeed(JobStorage.JobStorage, jobs.storage)),
  Layer.provide(ReceiptHandler),
  Layer.provide(ReceiptMailerLayer)
)

const runWorker = Effect.gen(function* () {
  yield* jobs.ready // Checks readiness; does not run migrations.

  const PollingLayer = Polling.layer([BillingQueue], {
    maxJobs: 20, // Max jobs claimed during one bounded drain.
    recoveryLimit: 20, // Max expired leases recovered in this queue per drain.
    recoveryRetryInterval: Duration.seconds(30), // Retry threshold when claim backoff skips recovery.
    shutdownGrace: Duration.seconds(30) // Shared grace for already-started executions.
  }).pipe(Layer.provide(WorkerLayer))

  yield* Effect.never.pipe(Effect.provide(PollingLayer))
}).pipe(Effect.scoped)

NodeRuntime.runMain(runWorker)
```

```ts
yield* Worker.drain(BillingQueue, { maxJobs: 20, recoveryLimit: 20 }).pipe(Effect.provide(WorkerLayer))
// One bounded run, not “wait until every future retry has finished”.

const hint = yield* JobSchedule.observe(BillingJobs, BillingQueue, { limit: 100 }).pipe(
  Effect.provide(JobSchedule.layer(jobs.schedule))
)
// Compute delays from hint.observedAt, not the host clock.
// Keep a finite repair wakeup even if both timestamps are null.
```

```ts
// PgClient is @effect/sql-pg/PgClient; nativeDrizzle is drizzle-orm/effect-postgres.
// invoiceTable is app-owned. This must be the client passed to PostgreSqlNative.
const client = yield* PgClient.PgClient
const db = yield* nativeDrizzle.makeWithDefaults()

yield* client
  .withTransaction(
    Effect.gen(function* () {
      yield* db.insert(invoiceTable).values({ id: invoiceId })

      return yield* IssueInvoice.enqueue({
        operationId, slot: "receipt",
        payload: { invoiceId }
      })
    })
  )
  .pipe(Effect.provideService(JobEnqueue, jobs.producer))
```

```ts
yield* IssueInvoice.enqueueStandalone({
  operationId, slot: "receipt",
  payload: { invoiceId }
}).pipe(Effect.provideService(JobEnqueue, jobs.producer))
```

```ts
const Codes = FailureCode.define({
  ReceiptUnreadable: "receipt_unreadable",
  ProviderBusy: "provider_busy",
  InvalidRecipient: "invalid_recipient",
  ProviderCredentials: "provider_credentials"
})
```

```ts
const ReceiptHandler = Layer.unwrap(Effect.map(Definitions, (definitions) =>
  JobGroup.handlers(definitions.BillingJobs, (handlers) =>
  handlers.handle("receipt", (input) =>
    Effect.gen(function* () {
      const templates = yield* ReceiptTemplates
      const provider = yield* EmailProvider

      const email = yield* templates
        .load(input.payload.invoiceId)
        .pipe(
          Effect.mapError(() => JobFailures.Isolate({ code: Codes.ReceiptUnreadable }))
        )

      // Application adapter contract: bounded outcomes, no raw provider errors.
      const result = yield* provider
        .send({
          email,
          idempotencyKey: input.context.jobId
        })
        .pipe(
          Effect.mapError(() => JobFailures.OutcomeUnknown())
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
          Effect.fail(JobFailures.OutcomeUnknown())
        ),
        Match.exhaustive
      )
    })
  )
)
))
```

```ts
const retry = Retry.exponential(Duration.seconds(1)).pipe(
  Retry.capped(Duration.minutes(1)),
  Retry.jittered(),
  Retry.maxFinalizedAttempts(4)
)

const receiptPolicy = yield* JobPolicy.make({
  attemptTimeout: Duration.seconds(20), // Time budget for one handler execution.
  leaseDuration: Duration.seconds(60), // Fixed, nonrenewing; must exceed timeout.
  retry, // Attempt limit includes the first finalized attempt.
  maxStalledCount: 1, // Separate bound for stalled recovery.
  completedRetention: Duration.days(30), // Completed jobs become cleanup-eligible after 30 days.
  deadRetention: Duration.infinity // Retain failures for investigation.
})

const ScheduledInvoice = yield* JobProducer.make(IssueInvoice.operation).pipe(
  JobProducer.withSlot("receipt", SendReceipt, { queue: BillingQueue, policy: receiptPolicy })
)
yield* ScheduledInvoice.enqueue({
  operationId, slot: "receipt",
  payload: { invoiceId },
  availableAt: DateTime.makeUnsafe(deliveryTimeMillis) // Optional absolute UTC eligibility.
})
```

```ts
// Shared private setup is lazy; encryption construction does not look up keys.
const ReceiptDocument = Schema.Struct({
  recipient: Schema.String,
  invoiceNumber: Schema.String,
  total: Schema.Struct({ amount: Schema.String, currency: Schema.String })
})
type ReceiptEncoded = typeof ReceiptDocument.Encoded
const ReceiptEnvelope = Schema.Struct({
  keyId: Schema.String,
  nonce: Schema.String,
  ciphertext: Schema.String,
  tag: Schema.String,
  fingerprint: Schema.String
})
class ReceiptSealer extends Context.Service<ReceiptSealer, {
  readonly seal: (value: ReceiptEncoded) => Effect.Effect<typeof ReceiptEnvelope.Type, JobPayload.JobEncryptionError>
}>()("billing/ReceiptSealer") {}
class ReceiptOpener extends Context.Service<ReceiptOpener, {
  readonly open: (value: typeof ReceiptEnvelope.Type) => Effect.Effect<ReceiptEncoded, JobPayload.JobEncryptionError>
}>()("billing/ReceiptOpener") {}

const ReceiptEncryption = {
  envelope: ReceiptEnvelope,
  seal: (value: ReceiptEncoded) => Effect.flatMap(ReceiptSealer, (service) => service.seal(value)),
  open: (value: typeof ReceiptEnvelope.Type) => Effect.flatMap(ReceiptOpener, (service) => service.open(value))
}

const PrivateDefinitionsProgram = Effect.gen(function* () {
  const definitions = yield* Definitions
  const document = yield* JobPayload.encrypted({ schema: ReceiptDocument, codec: ReceiptEncryption })
  const SendPrivateReceipt = yield* Job.make({
    name: "invoice.private-receipt",
    payload: Schema.Struct({ invoiceId: Schema.String, document })
  })
  const PrivateReceiptProducer = yield* JobProducer.make("billing.private-receipt").pipe(
    JobProducer.withSlot("receipt", SendPrivateReceipt, { queue: definitions.BillingQueue, policy: receiptPolicy })
  )
  const PrivateJobs = yield* JobGroup.make("private-receipts", { receipt: SendPrivateReceipt })
  const PrivateApi = yield* JobApi.make("private").pipe(JobApi.addGroup(PrivateJobs))
  return { SendPrivateReceipt, PrivateReceiptProducer, PrivateJobs, PrivateApi }
})
class PrivateDefinitions extends Context.Service<
  PrivateDefinitions,
  Effect.Success<typeof PrivateDefinitionsProgram>
>()("billing/PrivateDefinitions") {}
const PrivateDefinitionsLayer = Layer.effect(PrivateDefinitions, PrivateDefinitionsProgram)

const requestPrivateReceipt = (operationId: string, invoiceId: string) => Effect.gen(function* () {
  const definitions = yield* PrivateDefinitions
  const receipt = yield* Schema.decodeUnknownEffect(ReceiptDocument)({
    recipient: "alex@example.com",
    invoiceNumber: "INV-2026-1042",
    total: { amount: "49.00", currency: "EUR" }
  })
  return yield* jobs.withTransaction(() => definitions.PrivateReceiptProducer.enqueue({
    operationId, slot: "receipt", payload: { invoiceId, document: receipt }
  }))
})
```

```ts
const PrivateReceiptHandler = Layer.unwrap(Effect.map(PrivateDefinitions, (definitions) => JobGroup.handlers(
  definitions.PrivateJobs,
  (handlers) =>
    handlers.handle("receipt", (input) =>
      Effect.gen(function* () {
        const mailer = yield* PrivateReceiptMailer

        yield* mailer.send({
          document: input.payload.document,
          idempotencyKey: input.context.jobId
        })
      })
    )
)
))
```

```ts
// Application migration
const tables = PostgreSqlSchema.tables({
  schema: "billing",
  jobsTable: "tasks",
  payloadsTable: "task_artifacts"
})

const ddl = PostgreSqlSchema.migration(tables)
// Execute `ddl` using your migration runner.

// ApplicationPostgresLayer is PostgreSqlNative.layer({ client, operationTimeout }).
const JobsLayer = PostgreSqlJobs.layerNoDeps({
  ...tables,
  operationResponseBudget: Duration.millis(100)
}).pipe(Layer.provide(ApplicationPostgresLayer))

yield* Effect.gen(function* () {
  const jobs = yield* PostgreSqlJobs.PostgreSqlJobs
  yield* jobs.ready
}).pipe(Effect.provide(JobsLayer))
```

```ts
// Optional Drizzle declarations; not a transaction adapter or migration runner.
const jobTables = makeJobTables(tables)
```

```ts
const jobTables = makeJobTables({
  ...tables,

  extraIndexes: (jobs) => [
    index("jobs_dashboard").on(jobs.operation, jobs.slot, jobs.state, jobs.id)
  ]
})
```
