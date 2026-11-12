import { bigint, jsonb, PgSchema, text } from "drizzle-orm/pg-core"
import type { ApplicationRelations } from "@effect-jobs/playground-contracts/Jobs"
import type { StoredReceipt } from "../commands/Transactions.js"
import { relationNames, relations } from "./Schema.js"

// Query declarations only. The application migration registry remains the DDL owner.
export const make = (schema: string) => {
  relations(schema)
  const table = new PgSchema(schema, undefined).table
  const identity = () => ({
    sandboxId: text("sandbox_id").notNull(),
    generation: bigint("generation", { mode: "number" }).notNull(),
    operation: text("operation").notNull(),
    requestId: text("request_id").notNull()
  })
  return {
    admission: table(relationNames.admission, identity()),
    receipts: table(relationNames.receipts, {
      ...identity(),
      receipt: jsonb("receipt").$type<StoredReceipt>().notNull()
    }),
    associations: table(relationNames.associations, {
      sandboxId: text("sandbox_id").notNull(),
      generation: bigint("generation", { mode: "number" }).notNull(),
      jobId: text("job_id").notNull(),
      relations: jsonb("relations").$type<typeof ApplicationRelations.Type>().notNull()
    })
  }
}
