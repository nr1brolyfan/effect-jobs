import type { SqlStorage } from "../../../src/internal/do-sqlite/Storage.js"
import { Jobs } from "../do-sqlite-drain/Worker.mjs"

export class InvoiceJobs extends Jobs {
  constructor(ctx: DurableObjectState, env: ConstructorParameters<typeof Jobs>[1]) {
    super(ctx, env)
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        operationId TEXT PRIMARY KEY,
        invoiceId TEXT NOT NULL,
        amountCents INTEGER NOT NULL
      ) STRICT
    `)
  }

  protected override writeDomain(
    sql: SqlStorage,
    operationId: string,
    payload: { readonly invoiceId: string; readonly amountCents: number }
  ) {
    sql.exec(
      "INSERT INTO invoices VALUES (?, ?, ?)",
      operationId,
      payload.invoiceId,
      payload.amountCents
    )
  }

  override fetch(request: Request): Promise<Response> {
    if (request.method === "GET" && new URL(request.url).pathname === "/domain") {
      return Promise.resolve(
        Response.json(this.ctx.storage.sql.exec("SELECT * FROM invoices").toArray())
      )
    }
    return super.fetch(request)
  }
}

export { default } from "../do-sqlite-drain/Worker.mjs"
