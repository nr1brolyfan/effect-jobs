// Inert optional-driver import probe. No connect(), query or transaction.
import pg from "pg"
import * as Drizzle from "drizzle-orm/effect-postgres"

export default {
  fetch() {
    return Response.json({
      pgClientConstructor: typeof pg.Client,
      nativeDrizzleFactory: typeof Drizzle.makeWithDefaults
    })
  }
}
