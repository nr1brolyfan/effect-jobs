import { boolean, integer, pgTable, text } from "drizzle-orm/pg-core"
import * as PostgreSqlDrizzleSchema from "effect-jobs/PostgreSqlDrizzleSchema"

export const jobTables = PostgreSqlDrizzleSchema.makeJobTables({})

// #region schema
export const orders = pgTable("orders", {
  operationId: text("operation_id").primaryKey(),
  orderId: text("order_id").notNull().unique(),
  sku: text("sku").notNull(),
  quantity: integer("quantity").notNull(),
  invoiceRequested: boolean("invoice_requested").notNull()
})
export const orderReceipts = pgTable("order_receipts", {
  operationId: text("operation_id")
    .primaryKey()
    .references(() => orders.operationId),
  confirmationJobId: text("confirmation_job_id")
    .notNull()
    .references(() => jobTables.jobs.id),
  invoiceJobId: text("invoice_job_id").references(() => jobTables.jobs.id)
})
export const invoices = pgTable("invoices", {
  invoiceId: text("invoice_id").primaryKey(),
  orderId: text("order_id")
    .notNull()
    .unique()
    .references(() => orders.orderId),
  document: text("document").notNull(),
  deliveryJobId: text("delivery_job_id")
    .notNull()
    .unique()
    .references(() => jobTables.jobs.id)
})
export const syntheticMail = pgTable("synthetic_mail", {
  deliveryKey: text("delivery_key").primaryKey(),
  subject: text("subject").notNull(),
  body: text("body").notNull()
})
// #endregion schema
