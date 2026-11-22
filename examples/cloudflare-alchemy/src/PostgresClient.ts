// @effect-diagnostics unstableApiUsage:off
import { createPool } from "drizzle-orm/postgres/client"
import { DrizzlePostgresClient } from "drizzle-orm/postgres/client/effect"
import { Effect, Redacted } from "effect"

// Own a single, bounded pool for the lifetime of this invocation.
export const make = (url: Redacted.Redacted<string>) =>
  DrizzlePostgresClient.fromPool({
    acquire: Effect.acquireRelease(
      Effect.try({
        try: () =>
          createPool({
            url: Redacted.value(url),
            applicationName: "effect-jobs-alchemy-example",
            max: 2,
            prepare: false,
            reconnect: false,
            connectTimeout: 2000,
            acquireTimeoutMillis: 2000,
            idleTimeoutMillis: 1000,
            statementTimeout: 2000,
            idleInTransactionSessionTimeout: 5000,
            options: "-c lock_timeout=1000"
          }),
        catch: (cause) => DrizzlePostgresClient.toSqlError(cause, "connect")
      }),
      (pool) => Effect.promise(() => pool.end())
    )
  })
