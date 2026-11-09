# effect-jobs

Background jobs for Effect, stored in your own database. Add a job in the same
transaction as your application data, so both are saved together or neither is.

PostgreSQL for now, with more databases planned.

For example, save an invoice and enqueue its receipt email in the same transaction,
then handle delivery in a separate worker.

```ts
const BillingQueue = JobQueue.make("billing")
const SendReceipt = Job.make({
  kind: "invoice.receipt",
  payload: Schema.Struct({ invoiceId: Schema.String })
})

const IssueInvoice = JobProducer.make("billing.issue-invoice").pipe(
  JobProducer.withSlot("receipt", SendReceipt, { queue: BillingQueue })
)

// App setup: its Layer supplies a qualified PostgreSqlApplication adapter.
const jobs =
  yield *
  PostgreSqlJobs.make({
    operationResponseBudgetMillis: 100
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
const BillingJobs = JobGroup.make("billing", { receipt: SendReceipt })
const ApplicationJobs = JobApi.make("application").pipe(JobApi.addGroup(BillingJobs))
const ReceiptHandler = JobApiBuilder.group(ApplicationJobs, "billing", (handlers) =>
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

**Initial alpha · Effect · PostgreSQL · transaction-bound enqueue**

## Install

Examples target the local-only `0.1.0-alpha.1-effect.4.1.0.local.5` candidate, which is not an npm release. Its exact peers are Effect `4.1.0` and optional Drizzle `1.0.0-rc.5`. This prerelease changes the alpha.0 enqueue,
policy, failure-code and encrypted-payload APIs; update callers before upgrading.

```sh
npm install ./effect-jobs-0.1.0-alpha.1-effect.4.1.0.local.5.tgz effect@4.1.0
```

Imports are omitted below. Use package subpaths (`effect-jobs/Job`, `effect-jobs/JobGroup`, `effect-jobs/JobApi`, `effect-jobs/JobApiBuilder`, `effect-jobs/JobPolicy`, …); the root export is empty. `Codec`, `Worker` and `Polling` refer to `JobPayloadCodec`, `JobWorker` and `JobPolling` respectively.

`invoices`, mailers, credentials and protection services are application code, not library exports. Handler services return explicit `JobFailure` values.

`JobApi` is a pure immutable catalog of groups. Install each group with
`JobApiBuilder.group(api, name, handlers => ...)`, returning a complete immutable
`.handle(alias, implementation)` chain, directly or through an Effect. A worker
requires every declared group and shares its configured queue concurrency across
all groups. Callback dependencies are acquired once per Layer acquisition; each
job invocation has its own Scope. Group names and aliases do not change durable
job identity. Duplicate group names and duplicate kind/version pairs are rejected.

`NodeRuntime` is `@effect/platform-node/NodeRuntime`.
`PgClient` is `@effect/sql-pg/PgClient`; `PostgreSqlNative` is the library module
of the same name. The application provides its scoped `PgClient` Layer, with
finite connection, statement and idle transaction timeouts.

`FailureCode` is the `effect-jobs/FailureCode` module; `JobEnqueue` is the service
exported by `effect-jobs/JobEnqueue`. Job version defaults to `1`. Slot-bound
producers use the standard artifact codec; domain transformations and encryption
belong in the payload Schema.

## One definition, multiple applications

Share the contract, not the email provider or database connection.

```ts
// packages/billing-jobs/receipt.ts — imported by both producer and consumer
export const BillingQueue = JobQueue.make("billing")

export const SendReceipt = Job.make({
  kind: "invoice.receipt",
  payload: Schema.Struct({ invoiceId: Schema.String })
})

export const BillingJobs = JobGroup.make("billing", { receipt: SendReceipt })

export const IssueInvoice = JobProducer.make("billing.issue-invoice").pipe(
  JobProducer.withSlot("receipt", SendReceipt, { queue: BillingQueue })
)
```

```ts
// apps/api — owns invoice writes; does not import the email provider
const issueInvoice = (operationId: string, invoiceId: string) =>
  jobs.withTransaction(() =>
    Effect.gen(function* () {
      yield* invoices.createOnce({ operationId, invoiceId })

      return yield* IssueInvoice.enqueue({
        operationId, slot: "receipt",
        payload: { invoiceId }
      })
    })
  )
```

```ts
// apps/billing-worker — owns email credentials; does not import the API
const ApplicationJobs = JobApi.make("application").pipe(JobApi.addGroup(BillingJobs))
const ReceiptHandler = JobApiBuilder.group(ApplicationJobs, "billing", (handlers) =>
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
```

Reuse `operationId` and `invoiceId` on request retries. Matching enqueues return the original job ID; changed content conflicts. Domain idempotency is still yours. `invoices.createOnce` must use the adapter's active transaction, not a separate connection.

### One operation, two consequences

Slots name independent consequences of the same business operation. Issuing an
invoice can send a receipt and generate a PDF without their enqueue identities
colliding:

```ts
const PriorityBillingQueue = JobQueue.make("billing-priority")
const IssueInvoiceWithPdf = JobProducer.make("billing.issue-invoice-with-pdf").pipe(
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

Retrying with the same operation ID and slots returns the existing matching jobs.
Declared slots are checked by TypeScript. A slot names the consequence, not the
job kind: two slots can enqueue the same job kind. Slots do not impose execution
order or dependencies between jobs.

`make(operation)` starts an immutable pipeable declaration; each `withSlot` adds
one consequence and returns a new producer. There is no `build()` step or slot
replacement. Duplicate slot names are rejected, not overwritten. An empty
declaration has no statically legal enqueue slot. Assembly starts no background work.

Slots declare either a fixed route with `{ queue: BillingQueue }` or a closed,
nonempty choice with `{ queues: [BillingQueue, PriorityQueue] }`. Fixed slots
forbid any enqueue `queue` field, even the same queue or `undefined`. Selectable
slots require a queue **name** from their list, such as `queue: "billing.priority"`;
a singleton list still requires explicit selection. There is no default choice.
All three enqueue methods follow the same per-slot rules and accept an independent
optional `policy`: a complete validated `JobPolicy`, never a partial merge.
Workers still use JobQueue references and must drain the chosen queue. Routing
is not an authorization mechanism. Invalid routing fails through `InvalidJobInput`
before encoding/insertion, after transaction authority and lifetime checks.

Replaying the same operation/ID/slot with another queue or policy still returns the
original matching job and preserves its first configuration and artifact bytes.
It does not move or reprioritize existing work. Shared queues by work class are a
reasonable starting point on both CF and VPS; no per-tenant queue, tenant field or
DO-per-tenant topology is required. Queue names do not create Cloudflare resources
or enforce tenant/region isolation, and deduplication is scoped to one jobs storage.

## Long-running Node.js worker

Producer and consumer connect to the same PostgreSQL jobs tables.

```ts
// The same app-owned PgClient is used by native Drizzle and this adapter.
const client = yield * PgClient.PgClient
const ApplicationPostgresLayer = PostgreSqlNative.layer({
  client,
  operationTimeoutMillis: 2000
})
const jobs =
  yield *
  PostgreSqlJobs.make({
    operationResponseBudgetMillis: 100
  }).pipe(Effect.provide(ApplicationPostgresLayer))

const WorkerLayer = Worker.layer(
  JobApi.make(BillingJobs.name).pipe(JobApi.addGroup(BillingJobs)),
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
    shutdownGraceMillis: 30_000 // Shared grace for already-started executions.
  }).pipe(Layer.provide(WorkerLayer))

  yield* Effect.never.pipe(Effect.provide(PollingLayer))
}).pipe(Effect.scoped)

NodeRuntime.runMain(runWorker)
```

The Scope owns polling shutdown. Construction starts no workers. Concurrency is fixed per worker instance and shared across its concurrent drains, not a global queue limit.

On Scope closure, polling first interrupts admission loops (including permit waits,
recovery and in-flight claims). Started executions retain their resources and may
finalize within one shared grace period, not one period per queue/job. The default
is 30 seconds; `shutdownGraceMillis` accepts integer 0–300,000, with zero requesting
immediate interruption. After grace, remaining executions are interrupted. They
are not released as safely unexecuted work: external outcomes can remain unknown
until lease recovery. Qualified storage operations and handler finalizers must
remain finitely bounded and interruption-cooperative; this timer cannot hard-kill
arbitrary native/uninterruptible code. Direct one-shot drain interruption is still
immediate, not graceful polling shutdown.

Worker construction requires `JobStorage` and the complete group's handlers.
`PostgreSqlJobs.layerNoDeps(options)` provides `JobStorage` together with the
configured producer/operator services; reuse that Layer when composing workers.
When using `PostgreSqlJobs.make`, provide its captured `jobs.storage` as above.
Custom qualified ports use `JobStorage.layer({ store, operationResponseBudgetMillis })`;
their provider requirements remain explicit on the Layer. The source owns its
lifetime, migrations and admission checks; this composition does not prove atomicity.

For a bounded invocation instead of a server:

```ts
yield* Worker.drain(BillingQueue, { maxJobs: 20, recoveryLimit: 20 }).pipe(Effect.provide(WorkerLayer))
// One bounded run, not “wait until every future retry has finished”.

const hint = yield* JobSchedule.observe(BillingJobs, BillingQueue, { limit: 100 }).pipe(
  Effect.provide(JobSchedule.layer(jobs.schedule))
)
// Compute delays from hint.observedAt, not the host clock.
// Keep a finite repair wakeup even if both timestamps are null.
```

`JobSchedule` is read-only and needs no worker or installed handlers. It reports
`observedAt`, `nextAvailableAt`, `nextRecoveryAt` and `saturated`. Availability is
filtered by the group's contracts within a bounded queue head (1–500 rows);
`saturated` means that head is incomplete. In particular, null availability with
saturation does **not** mean no supported job exists. Recovery includes all active
leases in that queue, matching queue-scoped drain recovery. Timestamps may already
be due and can become stale immediately. The storage adapter bounds query latency; the row
limit is not a bound on total database work. Authorization, activation expiry,
exclusive alarm ownership and repair notifications remain application-owned.
`PostgreSqlJobs.layerNoDeps` also provides the configured `JobSchedule` service.

The configured jobs instance exposes its producer service as `jobs.producer`.
Provide it as `JobEnqueue` to effects that call `enqueue` or `enqueueStandalone`.
`PostgreSqlNative.layer({ client, operationTimeoutMillis })` bridges the exact
application-owned `PgClient@4.1.0`, including its active `transactionService`.
Use public `PgClient.withTransaction` on that same client with Drizzle queries
inside its Effect body. Missing or foreign-client transactions fail before preparation.
Pools, keys, timeouts and transaction ownership remain application-owned.

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

Alternatively, `jobs.withTransaction` delegates to the same client manager
and supplies `JobEnqueue`, as used by `issueInvoice`. Provide the scoped native
PgClient Layer around the whole application; defining a Layer alone starts no work.

Joined results remain provisional until the outer owner acknowledges COMMIT.
Keep business, receipt and enqueue writes in one Effect/Context; do not run an
independent `runPromise` inside the transaction. The qualified route supports
ordinary outer transactions and jobs joining them without a savepoint. Nested
transactions, Drizzle transaction options and isolation settings are not qualified
as equivalent. `db.transaction` retains an upstream error-type limitation and is
excluded from this route; no local type correction is used. Strict/exactOptional
checks of our sources (A+B) remain required with dependency `skipLibCheck:true`.
The full foreign declaration audit (C) remains known upstream FAIL, separately
reported and nonblocking. Outer provider errors can also occur as defects: the
application must sanitize them without losing caller errors/interruption, preserve
Unknown COMMIT knowledge and reconcile its exact receipt read-only. Missing
receipts or lost responses never authorize automatic replay or prove NotCommitted.

`enqueue` requires an active transaction. For a job with no accompanying domain
write, `enqueueStandalone` opens its own transaction and rejects active ones:

```ts
yield* IssueInvoice.enqueueStandalone({
  operationId, slot: "receipt",
  payload: { invoiceId }
}).pipe(Effect.provideService(JobEnqueue, jobs.producer))
```

For operation signals, privacy boundaries, health sampling and query recipes, see the
[jobs observability guide](docs/observability.md) and its
[per-file checklist](docs/observability-checklist.md).

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
const ApplicationJobs = JobApi.make("application").pipe(JobApi.addGroup(BillingJobs))
const ReceiptHandler = JobApiBuilder.group(ApplicationJobs, "billing", (handlers) =>
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
    })
  )
)
```

| Outcome          | Use it when                                  |
| ---------------- | -------------------------------------------- |
| `Retry`          | Another attempt is safe and may succeed.     |
| `Dead`           | This job cannot succeed; stop attempting it. |
| `Isolate`        | Quarantine the job for investigation.        |
| `OutcomeUnknown` | The side effect may already have happened.   |

A timeout is not proof that no email was sent. Unknown outcomes use bounded lease recovery, not a normal finalized retry. `context.nextFinalizationNumber` is `finalizedAttempts + 1` and may repeat; it is not an invocation count or an idempotency key. Only confirmed fenced Complete/Retry/Dead/Isolate transitions increment `finalizedAttempts`; claim, release and unknown outcomes do not. `maxFinalizedAttempts` includes the first finalization, while stalled recovery has a separate budget. Keep the provider key and body stable, and reconcile before its idempotency window expires. Never persist raw errors or sensitive response bodies as failure codes.

## Policy belongs to the job

Compose retry settings with `effect-jobs/JobRetryPolicy`, imported as `Retry`.

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

const ScheduledInvoice = JobProducer.make(IssueInvoice.operation).pipe(
  JobProducer.withSlot("receipt", SendReceipt, { queue: BillingQueue, policy: receiptPolicy })
)
yield* ScheduledInvoice.enqueue({
  operationId, slot: "receipt",
  payload: { invoiceId },
  availableAt: deliveryTimeMillis // Optional initial eligibility, epoch milliseconds.
})
```

Policy is persisted at enqueue. Changing this constant affects new jobs, not existing ones; a matching duplicate keeps its first policy. Retention makes terminal jobs eligible for explicit cleanup—it does not start a cleanup worker. Removing identity evidence ends deduplication.

For storage integrations, `JobPolicy` validates the resolved in-memory model;
`PersistedJobPolicy` is the storage codec. Encode with that codec instead of
serializing resolved policy directly: retained JSON uses `maxAttempts`, mapped
to public `maxFinalizedAttempts`. The physical `attempts_made` counter is unchanged.

Use `Retry.fixed(Duration.seconds(5))` for a constant delay. Exponential retries
start at the base delay, grow by a factor of two, and stop growing at the cap.
Jitter selects an integer delay in 80–120% of the nominal delay, with the upper
bound shortened at the hard cap. For a nominal 60 seconds capped at 60 seconds,
that means 48–60 seconds. The worker persists availability; restarting does not
redraw it. Builders only describe configuration; `JobPolicy.make` validates it
through the typed `JobPolicyConfigurationError` channel, without synchronous throws.
See [retry policy](specs/retry-policy.md) for compatibility and worker rollout.

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
  kind: "invoice.private-receipt",

  payload: Schema.Struct({
    invoiceId: Schema.String,

    document: JobPayload.encrypted({
      schema: ReceiptDocument,
      codec: ReceiptEncryption
    })
  })
})

const PrivateReceiptProducer = JobProducer.make("billing.private-receipt").pipe(
  JobProducer.withSlot("receipt", SendPrivateReceipt, { queue: BillingQueue, policy: receiptPolicy })
)

const receipt = yield* Schema.decodeUnknownEffect(ReceiptDocument)({
  recipient: "alex@example.com",
  invoiceNumber: "INV-2026-1042",
  total: { amount: "49.00", currency: "EUR" }
})

yield* jobs.withTransaction(() =>
  PrivateReceiptProducer.enqueue({
    operationId, slot: "receipt",
    payload: { invoiceId, document: receipt }
  })
)
```

```ts
const PrivateJobs = JobGroup.make("private-receipts", { receipt: SendPrivateReceipt })
const PrivateApi = JobApi.make("private").pipe(JobApi.addGroup(PrivateJobs))
const PrivateReceiptHandler = JobApiBuilder.group(
  PrivateApi,
  PrivateJobs.name,
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

The maintained [tenant billing example](examples/cloudflare-alchemy/README.md) uses
Effect-native Alchemy `2.0.0-beta.85` Workers and Durable Objects with Effect `4.1.0`.
It includes the actual stack, invocation-scoped PostgreSQL construction, tenant
admission and lookup, atomic jobs/receipts, an idempotent development HTTP provider,
and one bounded callback wake coordinator for the shared billing queue.

PostgreSQL owns jobs, payloads, retries, leases and recovery. Alchemy owns its native
alarm and callback metadata. A callback prearms repair before execution, drains a
finite batch, and uses read-only database-relative schedule hints for the next wake.
The example tests actual Alchemy callback replacement/acknowledgement, retry and
parking behavior with local workerd. PostgreSQL COMMIT and callback scheduling are
separate operations; bootstrap traffic and the retained repair wake are required.
Hourly parking bounds unsuccessful self-scheduling; it is not a latency SLA.

Run the example's separate pinned qualification gate as documented there. Its
local tests do not establish hosted deployment, network-crash tolerance, physical
tenant/region isolation or exactly-once external effects. Alchemy remains outside
the portable library's dependency graph.

## Alpha boundaries

PostgreSQL only. Application-owned adapters, pools, migrations and cleanup. No recurring scheduler or admin API. Every TypeScript fence is extracted and declaration-checked against source and
the current locally packed artifact. The Effect 4.1.0 candidate
requires exact-byte receipts; see `specs/release-qualification.md`. Node/Bun composition, handler, codec and encryption
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
const jobs = yield* PostgreSqlJobs.make({
  ...tables,
  operationResponseBudgetMillis: 100
}).pipe(Effect.provide(ApplicationPostgresLayer))

yield* jobs.ready
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

Creation time is the initial durable enqueue insertion time, sampled from the
store clock in Unix epoch milliseconds. PostgreSQL persists `created_at` atomically
with the job and payload; it is independent of scheduled availability and never
changes during duplicate enqueue, execution, retries or resolution. Redrive creates
a new job with its own creation time. It does not promise a transaction commit time.
Existing installations must explicitly apply
`PostgreSqlSchema.creationTimeMigration(mapping)` through their migration runner
before readiness. Historical rows remain `null` (unknown); no backfill is inferred.
PostgreSQL snapshots always include `createdAt: number | null`. The snapshot Schema
allows omission for source compatibility with older custom snapshot producers.
