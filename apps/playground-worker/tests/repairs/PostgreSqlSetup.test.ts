import assert from "node:assert/strict"
import { Effect, Exit, Cause } from "effect"
import type { PgClient } from "@effect/sql-pg/PgClient"
import { test } from "vitest"
import * as Registry from "../../src/persistence/MigrationRegistry.js"
import { qualify } from "./PostgreSqlQualification.js"

// Exercise only the real harness setup with a recording client. This proves
// sequencing/context and cleanup, not PostgreSQL DDL or transaction semantics.
for (const failBackfill of [false, true]) {
  test(`qualification setup keeps registered DDL and backfill in one transaction (${failBackfill ? "failure" : "success"})`, async () => {
    const schema = "repair_qualification_abcdef123456"
    const migrations = Registry.migrations(schema)
    const statements: string[] = []
    let inTransaction = false
    let transactionCalls = 0
    const stop = new Error(failBackfill ? "backfill failed" : "setup observed")
    // The fixture deliberately has no pool/backend API: stop after setup.
    const client = {
      unsafe: (sql: string) =>
        Effect.suspend(() => {
          statements.push(sql)
          if (sql === "SHOW server_version") {
            return Effect.succeed([{ server_version: "16.15" }])
          }
          if (migrations.some((migration) => migration.sql === sql)) {
            assert.ok(inTransaction)
            return Effect.succeed([])
          }
          if (sql.startsWith("SELECT a.*")) {
            assert.ok(inTransaction)
            assert.ok(sql.includes("syntheticTenant"))
            assert.deepEqual(
              statements.slice(2, -1),
              migrations.map((m) => m.sql)
            )
            return failBackfill ? Effect.die(stop) : Effect.succeed([])
          }
          assert.ok(
            sql === `CREATE SCHEMA "${schema}"` ||
              sql === `DROP SCHEMA "${schema}" CASCADE`
          )
          assert.equal(inTransaction, false)
          return Effect.succeed([])
        }),
      withTransaction: (operation: Effect.Effect<unknown, unknown, unknown>) =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            transactionCalls++
            inTransaction = true
          }),
          () => operation,
          () =>
            Effect.sync(() => {
              inTransaction = false
            })
        ).pipe(Effect.flatMap(() => Effect.die(stop)))
    } as unknown as PgClient
    const exit = await Effect.runPromise(Effect.exit(qualify(client, schema)))
    assert.ok(Exit.isFailure(exit))
    assert.equal(Cause.squash(exit.cause), stop)
    assert.equal(transactionCalls, 1)
    assert.equal(statements.length, migrations.length + 4)
    assert.equal(statements.at(-1), `DROP SCHEMA "${schema}" CASCADE`)
    assert.equal(inTransaction, false)
  })
}
