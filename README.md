# effect-jobs

Durable background jobs for [Effect](https://effect.website/). Save your data and
enqueue work in the same transaction. Let a worker handle it later.

**PostgreSQL · SQLite in Cloudflare Durable Objects**

- **Atomic enqueue** — your app data and jobs commit together.
- **Durable retries** — restart the worker without losing scheduled attempts.
- **Typed handlers** — share job definitions between your API and worker.

## Install

```sh
bun add --exact effect-jobs@alpha effect@4.1.3
```

## Place an order. Send the email later.

**Define the job.** The API and worker share a typed payload.

```ts
const SendOrderConfirmation = Job.make({
  name: "orders.send-confirmation",
  payload: Schema.Struct({ orderId: Schema.String })
})
```

**Bind it to an operation.** A job describes what the worker does. A producer
describes why the app enqueues it. Even one job uses a producer with one slot.

```ts
const confirmation = yield* SendOrderConfirmation
const OrdersQueue = yield* JobQueue.make("orders")

const PlaceOrder = yield* JobProducer.make("order.place").pipe(
  JobProducer.withSlot("send-confirmation", confirmation, {
    queue: OrdersQueue
  })
)
```

**Save and enqueue.** The order and its confirmation job commit together, or
neither does. The request doesn't wait for email delivery.

In this PostgreSQL example, `db` and `jobs.producer` share the same `PgClient`.

```ts
yield* pg.withTransaction(
  Effect.gen(function* () {
    yield* db.insert(orders).values(order)

    return yield* PlaceOrder.enqueue({
      operationId,
      slot: "send-confirmation",
      payload: { orderId: order.orderId }
    })
  })
).pipe(Effect.provideService(JobEnqueue, jobs.producer))
```

## Give retries a policy

Retry with exponential backoff. Cap the delay at one minute and the total at
five finalized attempts, including the first.

```ts
const confirmationPolicy = yield* JobPolicy.make({
  retry: JobRetryPolicy.exponential(Duration.seconds(2)).pipe(
    JobRetryPolicy.capped(Duration.minutes(1)),
    JobRetryPolicy.maxFinalizedAttempts(5)
  )
})
```

Pass `policy: confirmationPolicy` to `withSlot`. The database stores the
policy, attempt count and next eligible time. **No worker has to stay alive
or hold a retry timer.** A stateless worker can pick up the job when it is due.

## Define a job API. Plug in handlers.

If you've used Effect's `HttpApi`, the split is familiar: define the contract,
group it, then provide handlers separately. The API doesn't import your mailer.

```ts
const Confirmations = yield* JobGroup.make("confirmations", { confirmation })

const OrdersApi = yield* JobApi.make("orders").pipe(
  JobApi.addGroup(Confirmations)
)
```

Install handlers per group. Use the stable job ID as a delivery key if your
email provider supports idempotency. The adapter maps provider errors to job
failures, as shown below.

```ts
const ConfirmationHandlers = JobGroup.handlers(Confirmations, (handlers) =>
  handlers.handle("confirmation", ({ payload, context }) =>
    send({
      deliveryKey: context.jobId,
      subject: "Order confirmation",
      body: `Order ${payload.orderId} received.`
    })
  )
)
```

`JobApi` tells the worker which groups it can run. The worker needs a handler
layer for each group in that catalog, plus storage.

```ts
const OrdersWorker = JobWorker.layer(OrdersApi, {
  queues: [{ queue: OrdersQueue, concurrency: 2 }]
}).pipe(
  Layer.provide(ConfirmationHandlers),
  Layer.provide(OrdersStorage)
)
```

## Not every failure should retry

Use typed `JobFailures` to tell the worker what happened:

| Outcome | Example |
| --- | --- |
| `Retry` | The mail provider explicitly rejected the request as busy. Try again within policy. |
| `Dead` | The address was permanently rejected. Stop retrying. |
| `Isolate` | The job references inconsistent order data. Keep it for investigation. |
| `OutcomeUnknown` | The provider may have accepted the email, but the response was lost. Don't treat it as a confirmed failure. |

```ts
const EmailCodes = FailureCode.define({
  busy: "email-busy",
  rejected: "email-rejected",
  inconsistentOrder: "inconsistent-order"
})
```

```ts
const send = (message: EmailMessage) => emails.send(message).pipe(
  Effect.catchTags({
    EmailBusy: () => Effect.fail(JobFailures.Retry({ code: EmailCodes.busy })),
    AddressRejected: () =>
      Effect.fail(JobFailures.Dead({ code: EmailCodes.rejected })),
    InconsistentOrder: () =>
      Effect.fail(JobFailures.Isolate({ code: EmailCodes.inconsistentOrder })),
    EmailUncertain: () => Effect.fail(JobFailures.OutcomeUnknown())
  })
)
```

## Cloudflare + Alchemy + PostgreSQL

Alchemy wires up two pieces: an HTTP Worker that accepts invoice requests,
and a Durable Object that wakes the job worker. Both reach the same PostgreSQL
database through Hyperdrive. PostgreSQL stores the invoices, jobs and leases;
the Durable Object schedules wakeups, not a second queue.

**In the HTTP Worker:** after authenticating the tenant and decoding the
request, arm a repair wake, then commit the invoice and its job together.
This is the request handler's core, with the error-to-HTTP mapping omitted:

```ts
// src/Application.ts — inside the Worker's fetch handler
const tenantId = yield* admitDevelopment(request.headers.authorization ?? "")
const input = yield* request.json.pipe(Effect.flatMap(decodeRequest))

const coordinator = coordinators.getByName("billing")
yield* coordinator.prearm()

const result = yield* Effect.scoped(
  Effect.gen(function* () {
    const invocation = yield* openInvocation({ databaseUrl, providerUrl })
    return yield* invocation.issue(tenantId, input)
  })
)

yield* coordinator.wake().pipe(Effect.catch(() => Effect.void))
return HttpServerResponse.jsonUnsafe(result)
```

The last wake is best-effort: it makes work start sooner, but a missed wake
doesn't undo the commit. The already-armed repair wake can pick up the job.

**In the Durable Object:** `src/Coordinator.ts` registers the Alchemy callback.
It runs this bounded PostgreSQL drain, defined in `src/Invocation.ts`:

```ts
// src/Invocation.ts — billing drain used by the Durable Object callback
const drain = JobWorker.drain(BillingQueue, {
  maxJobs: 4,
  recoveryLimit: 4
}).pipe(Effect.provide(WorkerLayer))
```

The callback keeps a repair wake scheduled and checks the database for the next
due job or expired lease. The HTTP request never waits for delivery.

[Run the full tenant billing example with Alchemy and Hyperdrive](https://github.com/nr1brolyfan/effect-jobs/tree/main/examples/cloudflare-alchemy#readme). It uses a local build and PostgreSQL.

## Alternative: SQLite inside one Durable Object

If the same Durable Object owns both the app data and jobs, it can use its own
SQLite database instead of PostgreSQL. Alchemy wires the Worker binding:

```ts
// Qualification.mts
const worker = yield* Cloudflare.Worker("InvoiceWorker", {
  main: join(import.meta.dirname, "Worker.mts"),
  env: {
    INVOICES: Cloudflare.DurableObject<InvoiceJobs>("InvoiceJobs", {
      storage: "sqlite"
    })
  },
  compatibility: { date: "2026-10-01" }
})
```

Inside the object, the invoice and its job use the same SQLite transaction.

```ts
// Worker.mts
const result = yield* DurableObjectSqlite.withTransaction(
  storage,
  responseBudgetMillis,
  (transaction, write) =>
    Effect.gen(function* () {
      const job = yield* producer.enqueueInTransaction(transaction, {
        operationId,
        slot: "record",
        payload: invoice
      })

      yield* EnqueueResult.$match(job, {
        Inserted: () => write((sql) => insertInvoice(sql, operationId, invoice)),
        AlreadyPresent: () => Effect.void
      })

      return job
    })
)

yield* Effect.tryPromise(() => storage.sync())
```

A separate request runs a bounded batch. The smoke example uses `1 / 1` to
check a single job; here we allow up to 10 claims and 10 expired-lease recoveries
per drain. Choose the limits to fit the invocation's time budget.

```ts
// Worker.mts
const drainInvoices = JobWorker.drain(queue, {
  maxJobs: 10,
  recoveryLimit: 10
}).pipe(Effect.provide(workerLayer))
```

[Run the full SQLite + Alchemy invoice example](https://github.com/nr1brolyfan/effect-jobs/tree/main/examples/cloudflare-do-sqlite#readme) against a locally built archive. Hosted Cloudflare qualification requires separate authorization.

## When the workflow grows

**One business operation, multiple jobs.** Give confirmation, invoicing and
fulfillment separate slots. The same `operationId` can enqueue all three
without a collision. Declaring a slot doesn't enqueue it or order its execution.

```ts
const PlaceOrder = yield* JobProducer.make("order.place").pipe(
  JobProducer.withSlot("send-confirmation", confirmation, {
    queue: OrdersQueue
  }),
  JobProducer.withSlot("create-invoice", createInvoice, {
    queue: BillingQueue
  }),
  JobProducer.withSlot("notify-warehouse", notifyWarehouse, {
    queue: FulfillmentQueue
  })
)
```

The same catalog can serve multiple deployments: for example, use
`JobApi.pick` to run just the confirmation group in a mail worker.

[Follow the Orders tutorial](https://effect-jobs.dev/docs/start/tutorial/) for
complete setup and imports. Its local setup uses a built release tarball.
Drizzle is optional. See [Drizzle setup](https://effect-jobs.dev/docs/persistence/drizzle/).
