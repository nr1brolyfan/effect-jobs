import assert from "node:assert/strict"
import { Effect, Exit, Layer, Schema } from "effect"
import { JobId } from "effect-jobs/JobId"
import { encodeJobPayload } from "effect-jobs/JobPayloadCodec"
import { nextDelay, repairMillis } from "../src/Wake.js"
import {
  admitDevelopment,
  decodeRequest,
  definitions,
  Definitions,
  DefinitionsLayer,
  Handlers,
  InvoiceDelivery
} from "../src/Domain.js"
const idle = { _tag: "Idle", claimed: 0, recovered: 0 } as const
const empty = {
  observedAt: 500000,
  nextAvailableAt: null,
  nextRecoveryAt: null,
  saturated: false
}
assert.equal(nextDelay(idle, empty), repairMillis)
assert.equal(nextDelay(idle, { ...empty, saturated: true }), 1000)
assert.equal(nextDelay(idle, { ...empty, nextAvailableAt: 499999 }), 1000)
assert.equal(nextDelay(idle, { ...empty, nextRecoveryAt: 505000 }), 5000)
assert.equal(nextDelay(idle, { ...empty, nextAvailableAt: 900000 }), repairMillis)
assert.equal(nextDelay({ _tag: "MoreWork", claimed: 4, recovered: 4 }, empty), 1000)
assert.equal(
  nextDelay({ _tag: "Backoff", phase: "claim", claimed: 0 }, empty),
  repairMillis
)
assert.equal(
  await Effect.runPromise(admitDevelopment("Bearer development-alice")),
  "tenant-a"
)
assert(
  Exit.isFailure(
    await Effect.runPromiseExit(
      decodeRequest({ tenantId: "tenant-b", invoiceId: "invoice-b", requestId: "one" })
    )
  )
)
assert(Effect.isEffect(definitions))
let deliveryCalls = 0
await Effect.runPromise(
  Effect.gen(function* () {
    const first = yield* Definitions
    const second = yield* Definitions
    assert.equal(first, second)
    assert.equal(first.DeliverInvoice.name, "invoice.deliver")
    assert(Object.isFrozen(first.DeliverInvoice))
    assert.equal(first.IssueInvoice.slots.deliver.job.name, first.DeliverInvoice.name)
    assert.equal(first.IssueInvoice.slots.deliver.queue.name, "billing")
    assert.deepEqual(first.BillingJobs.definitions.deliver, first.DeliverInvoice)
    const handlers = yield* first.BillingJobs.handlers
    const encoded = yield* encodeJobPayload(first.DeliverInvoice.payload, {
      tenantId: "tenant-a",
      invoiceId: "invoice-a"
    })
    yield* handlers.deliver(encoded, {
      jobId: yield* Schema.decodeEffect(JobId)("policy-handler"),
      catalog: { queue: "billing", name: first.DeliverInvoice.name, version: 1 },
      producer: {
        operation: first.IssueInvoice.operation,
        operationId: "tenant-a/request-a",
        slot: "deliver"
      },
      nextFinalizationNumber: 1
    })
  }).pipe(
    Effect.provide(Handlers),
    Effect.provide(
      Layer.succeed(InvoiceDelivery, {
        deliver: (tenantId, invoiceId, idempotencyKey) =>
          Effect.sync(() => {
            assert.equal(tenantId, "tenant-a")
            assert.equal(invoiceId, "invoice-a")
            assert.equal(idempotencyKey, "policy-handler")
            deliveryCalls++
          })
      })
    ),
    Effect.provide(DefinitionsLayer)
  )
)
assert.equal(deliveryCalls, 1)
const freshA = await Effect.runPromise(definitions)
const freshB = await Effect.runPromise(definitions)
assert.notEqual(freshA.DeliverInvoice, freshB.DeliverInvoice)
assert.notEqual(freshA.IssueInvoice, freshB.IssueInvoice)
console.log(
  "lazy shared definitions, complete handler, database-relative delay, saturation/null/Idle repair and tenant boundary PASS"
)
