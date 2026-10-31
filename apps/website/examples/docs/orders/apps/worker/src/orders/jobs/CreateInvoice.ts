import { Effect } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import { eq } from "drizzle-orm"
import * as JobProducer from "effect-jobs/JobProducer"
import * as JobPayloadCodec from "effect-jobs/JobPayloadCodec"
import * as FailureCode from "effect-jobs/FailureCode"
import { JobFailures } from "effect-jobs/JobFailure"
import { Database } from "#database/Database"
import { invoices, orders } from "#database/schema"
import { CreateOrderInvoice, SendInvoice } from "#orders/contracts/jobs"

const Codes = FailureCode.define({
  missing: "invoice_order_missing",
  handoff: "invoice_handoff_uncertain",
  conflict: "invoice_handoff_conflict"
})

// #region handoff
export const InvoiceCreated = JobProducer.make({
  operation: "invoice.create",
  slots: { "send-invoice": SendInvoice }
})

export const createInvoice = (orderId: string) =>
  Effect.gen(function* () {
    const db = yield* Database
    const pg = yield* PgClient.PgClient

    return yield* pg.withTransaction(
      Effect.gen(function* () {
        const [order] = yield* db
          .select()
          .from(orders)
          .where(eq(orders.orderId, orderId))
          .limit(1)

        if (!order || !order.invoiceRequested) {
          return yield* Effect.fail(JobFailures.Isolate({ code: Codes.missing }))
        }

        // One synthetic invoice per order. Neither ID changes on a handler retry.
        const invoiceId = order.orderId

        // The delivery becomes visible only when its invoice commits with it.
        const delivery = yield* InvoiceCreated.enqueue("send-invoice", {
          operationId: order.orderId,
          payload: { invoiceId }
        })

        // Persist the synthetic invoice and its stable delivery reference together.
        yield* db
          .insert(invoices)
          .values({
            invoiceId,
            orderId: order.orderId,
            document: `SYNTHETIC PDF STAND-IN: ${order.sku} x ${order.quantity}. Not a fiscal invoice.`,
            deliveryJobId: delivery.jobId
          })
          .onConflictDoNothing({ target: invoices.orderId })

        return delivery
      })
    )
  })
// #endregion handoff

export const InvoiceHandlerLayer = CreateOrderInvoice.handlerLayer(
  Effect.fn("Orders.createInvoice")(function* (input) {
    // SQL control/commit failures are conservatively uncertain, never safe-retried.
    yield* createInvoice(input.payload.orderId).pipe(
      Effect.catchTags({
        EffectDrizzleQueryError: () =>
          Effect.fail(JobFailures.OutcomeUnknown({ code: Codes.handoff })),
        JobsTransactionClosed: () =>
          Effect.fail(JobFailures.OutcomeUnknown({ code: Codes.handoff })),
        InvalidJobInput: () => Effect.fail(JobFailures.Isolate({ code: Codes.conflict })),
        JobPayloadCodecError: () =>
          Effect.fail(JobFailures.Isolate({ code: Codes.conflict })),
        SqlError: () => Effect.fail(JobFailures.OutcomeUnknown({ code: Codes.handoff })),
        JobBackendError: () =>
          Effect.fail(JobFailures.OutcomeUnknown({ code: Codes.handoff })),
        JobIntegrityConflict: () =>
          Effect.fail(JobFailures.Isolate({ code: Codes.conflict }))
      })
    )
  }),
  JobPayloadCodec.decodeJobPayload
)
