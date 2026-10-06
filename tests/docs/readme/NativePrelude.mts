// Application-owned wiring for the README, pinned to the qualified native binding.
// @effect-diagnostics unstableApiUsage:off
import { Effect } from "effect"
import * as PgClient from "@effect/sql-pg/PgClient"
import type { SqlError } from "effect/sql/SqlError"
import * as Drizzle from "drizzle-orm/effect-postgres"
import { pgSchema, text } from "drizzle-orm/pg-core"
import * as Application from "../../qualification/drizzle-native/NativeApplication.mjs"
import * as PostgreSqlJobs from "effect-jobs/PostgreSqlJobs"
import { PostgreSqlApplication } from "effect-jobs/PostgreSqlTransaction"

export type NativeDb = Effect.Success<ReturnType<typeof Drizzle.makeWithDefaults>>
export type NativeTx = Parameters<Parameters<NativeDb["transaction"]>[0]>[0]
// rc.5 still declares the removed effect/unstable/sql/SqlError import. Correct only
// this invocation boundary to the actual pinned native SqlError, as in qualification.
export const transact = <A, E, R>(
  db: Pick<NativeDb, "transaction">,
  body: (tx: NativeTx) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | SqlError, R> => {
  const invoke: (
    body: (tx: NativeTx) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | SqlError, R> = db.transaction.bind(db)
  return invoke(body)
}

const billing = pgSchema("billing")
// Minimal identity table. Invoice contents/validation remain application-owned.
export const invoices = billing.table("invoices", { id: text("id").primaryKey() })
export const receipts = billing.table("receipts", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull()
})
// Caller provides this PgClient's service Layer, Scope, pool configuration and
// migrations for billing.invoices, billing.receipts and the generic jobs mapping.
export const makeApplication = (client: PgClient.PgClient) =>
  Effect.gen(function* () {
    const db = yield* Drizzle.makeWithDefaults().pipe(
      Effect.provideService(PgClient.PgClient, client)
    )
    // Drizzle must use exactly this client, not a second service/pool instance.
    const ApplicationTransactions = Application.make(client)
    const backend = yield* PostgreSqlJobs.make({
      schema: "billing",
      operationResponseBudgetMillis: 100
    }).pipe(Effect.provideService(PostgreSqlApplication, ApplicationTransactions))
    return { db, ApplicationTransactions, backend }
  })
