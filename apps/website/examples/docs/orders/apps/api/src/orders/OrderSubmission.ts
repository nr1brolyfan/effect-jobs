import { Schema } from "effect"
import { OperationId } from "effect-jobs/JobIdentity"
import { OrderId } from "#orders/contracts/jobs"
import type { orders } from "#database/schema"

// #region submission
export type OrderSubmission = typeof OrderSubmission.Type
export const OrderSubmission = Schema.Struct({
  operationId: OperationId,
  orderId: OrderId,
  sku: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9-]{1,64}$/))),
  quantity: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 100 })))
})

// #endregion submission

// #region matching
export class OrderConflict extends Schema.TaggedError<OrderConflict>()(
  "OrderConflict",
  {}
) {}
const sameSubmission = Schema.toEquivalence(OrderSubmission)

// Compare only submission fields, plus the immutable choice to request an invoice.
export const matchesSubmission = (
  saved: typeof orders.$inferSelect | undefined,
  input: OrderSubmission,
  invoiceRequested: boolean
): boolean =>
  saved !== undefined &&
  saved.invoiceRequested === invoiceRequested &&
  sameSubmission(saved, input)
// #endregion matching
