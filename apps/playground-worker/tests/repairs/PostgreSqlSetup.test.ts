import assert from "node:assert/strict"
import { Effect, Exit, Cause } from "effect"
import type { PgClient } from "@effect/sql-pg/PgClient"
import { test } from "vitest"
import * as Registry from "../../src/persistence/MigrationRegistry.js"
import { migrationCommand, qualify } from "./PostgreSqlQualification.js"

// Exercise only the real harness setup with a recording client. This proves
// sequencing/context and cleanup, not PostgreSQL DDL or transaction semantics.
for (const failure of ["none", "backfill", "migration"]) {
  test(`qualification setup keeps registered DDL and backfill in one transaction (${failure})`, async () => {
    const schema = "repair_qualification_abcdef123456"
    const migrations = Registry.migrations(schema)
    const statements: string[] = []
    let inTransaction = false
    let transactionCalls = 0
    const stop = new Error(failure === "none" ? "setup observed" : `${failure} failed`)
    // The fixture deliberately has no pool/backend API: stop after setup.
    const client = {
      unsafe: (sql: string) =>
        Effect.suspend(() => {
          statements.push(sql)
          if (sql === "SHOW server_version") {
            return Effect.succeed([{ server_version: "16.15" }])
          }
          if (migrations.some((migration) => migrationCommand(migration.sql) === sql)) {
            assert.ok(inTransaction)
            assert.equal(sql, migrationCommand(migrations[statements.length - 3]!.sql))
            return failure === "migration" && statements.length === 4
              ? Effect.die(stop)
              : Effect.succeed([])
          }
          if (sql.startsWith("SELECT a.*")) {
            assert.ok(inTransaction)
            assert.ok(sql.includes("syntheticTenant"))
            assert.deepEqual(
              statements.slice(2, -1),
              migrations.map((m) => migrationCommand(m.sql))
            )
            return failure === "backfill" ? Effect.die(stop) : Effect.succeed([])
          }
          assert.ok(
            sql === `CREATE SCHEMA "${schema}"` ||
              sql === `DROP SCHEMA "${schema}" CASCADE`
          )
          assert.equal(inTransaction, false)
          return Effect.succeed([])
        }),
      withTransaction: <A, E, R>(operation: Effect.Effect<A, E, R>) =>
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
    assert.equal(statements.length, failure === "migration" ? 5 : migrations.length + 4)
    assert.equal(statements.at(-1), `DROP SCHEMA "${schema}" CASCADE`)
    assert.equal(inTransaction, false)
  })
}

// Verify the wire command has exactly one DO body enclosing one literal whose
// contents are the original SQL bytes, including delimiter collision candidates.
test("migration commands preserve SQL bodies and strings at command boundaries", () => {
  const sql = `-- comment with ; and $repair_sql$ and $repair_block_$
CREATE TABLE sample (value text);
INSERT INTO sample VALUES ('quote''; backslash\\;'), ($text$dollar;value$text$);
/* nested /* comment ; */ with $repair_sql_$ */
DO $nested$ BEGIN RAISE NOTICE 'semicolon;'; END $nested$;`
  for (const original of [
    sql,
    ...Registry.migrations("repair_qualification_abcdef123456").map((m) => m.sql)
  ]) {
    const match =
      /^DO (\$repair_block_*\$) BEGIN EXECUTE (\$repair_sql_*\$)([\s\S]*)\2; END \1 LANGUAGE plpgsql;$/u.exec(
        migrationCommand(original)
      )
    assert.ok(match)
    assert.equal(match[3], original)
    assert.ok(!original.includes(match[1]!))
    assert.ok(!original.includes(match[2]!))
    assert.notEqual(match[1], match[2])
  }
})
