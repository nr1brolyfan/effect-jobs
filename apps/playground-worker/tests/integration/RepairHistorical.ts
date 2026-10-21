// Qualification FFI: exact historical source produces receipts/state; fresh config only.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { Effect, Redacted, Schema } from "effect"
import * as Pg from "@effect/sql-pg/PgClient"
import * as Reactivity from "effect/reactivity/Reactivity"
import { SqlClient } from "effect/sql/SqlClient"
import * as Migrations from "../../src/persistence/MigrationRegistry.js"
import * as Qualification from "../repairs/PostgreSqlQualification.js"

class HistoricalPopulationFailure extends Schema.TaggedError<HistoricalPopulationFailure>()(
  "HistoricalPopulationFailure",
  {}
) {}

const directory = process.env.D6_RESOURCE_DIRECTORY!
const cfg = JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG!, "utf8"))
const legacy = await import(`${directory}/LegacyPopulation.mjs`)
const schema = `repair_qualification_${randomBytes(6).toString("hex")}`
const config = {
  ...cfg,
  schema,
  localPrivate: true,
  connectionString: `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
}
const report: {
  checks: string[]
  stage: string
  success: boolean
  failureClass?: string
} = {
  checks: [],
  stage: "historical v1-v5 descriptors",
  success: false
}
try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* Pg.make({
          url: Redacted.make(config.connectionString),
          maxConnections: 1,
          prepare: false,
          connectTimeout: "2 seconds"
        })
        const descriptors = Migrations.migrations(schema)
        assert.deepEqual(legacy.migrations(schema), descriptors.slice(0, 5))
        yield* Effect.acquireRelease(client.unsafe(`CREATE SCHEMA "${schema}"`), () =>
          client.unsafe(`DROP SCHEMA "${schema}" CASCADE`).pipe(Effect.orDie)
        )
        yield* client.withTransaction(
          Effect.gen(function* () {
            for (const descriptor of descriptors.slice(0, 5)) {
              yield* client.unsafe(Qualification.migrationCommand(descriptor.sql))
            }
          })
        )
        report.stage = "real historical enqueue/worker/operator receipt"
        const populated = yield* Effect.tryPromise({
          try: () => legacy.populate(config),
          catch: () => new HistoricalPopulationFailure()
        }).pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Struct({
                ref: Schema.Struct({
                  sandboxId: Schema.String,
                  generation: Schema.Number
                }),
                sourceJobId: Schema.String,
                resultJobId: Schema.String,
                requestId: Schema.String
              })
            )
          )
        )
        report.checks.push(
          "exact accepted-base v1-v5 SQL/checksums; actual historical producer/worker/redrive receipt"
        )
        const table = (name: string) => `"${schema}"."${name}"`
        const snapshot = (name: string) =>
          client.unsafe<{ row: Record<string, unknown> }>(
            `SELECT row_to_json(t) AS row FROM ${table(name)} t ORDER BY row_to_json(t)::text`
          )
        const before: Record<string, ReadonlyArray<{ row: Record<string, unknown> }>> = {}
        for (const name of [
          "jobs",
          "job_payloads",
          "sandboxes",
          "associations",
          "command_admission",
          "command_receipts",
          "command_audit",
          "provider_ledger"
        ]) {
          before[name] = yield* snapshot(name)
        }
        report.stage = "populated additive v6 and same-client tenant backfill"
        yield* client.withTransaction(
          Effect.gen(function* () {
            yield* client.unsafe(Qualification.migrationCommand(descriptors[5]!.sql))
            yield* Migrations.backfillSyntheticTenants(schema).pipe(
              Effect.provideService(SqlClient, client)
            )
          })
        )
        for (const [name, rows] of Object.entries(before)) {
          report.stage = `preserve historical ${name}`
          const after = yield* snapshot(name)
          const original = new Map(
            rows.map(({ row }) => [
              JSON.stringify(
                name === "associations"
                  ? [row.sandbox_id, row.generation, row.job_id]
                  : name === "command_audit"
                    ? row
                    : (row.id ?? row.job_id ?? row.request_id ?? row.sandbox_id ?? row)
              ),
              row
            ])
          )
          assert.equal(after.length, rows.length)
          for (const { row } of after) {
            const key = JSON.stringify(
              name === "associations"
                ? [row.sandbox_id, row.generation, row.job_id]
                : name === "command_audit"
                  ? row
                  : (row.id ?? row.job_id ?? row.request_id ?? row.sandbox_id ?? row)
            )
            const expected = original.get(key)!
            assert.ok(expected)
            const retained = Object.fromEntries(
              Object.keys(expected).map((key) => [key, row[key]])
            )
            if (name === "associations") {
              const relations = { ...(retained.relations as Record<string, unknown>) }
              assert.ok(
                ["demo-tenant-a", "demo-tenant-b"].includes(
                  String(relations.syntheticTenant)
                )
              )
              delete relations.syntheticTenant
              retained.relations = relations
            }
            assert.deepEqual(retained, expected)
          }
        }
        report.checks.push(
          "populated v6 preserves all historical job/payload/policy/counter/admission/receipt/audit/provider bytes; canonical tenant backfill"
        )
        const [child] = yield* client.unsafe<{
          original_source_job_id: string
          source_job_id: string
          redrive_kind: string
        }>(
          `SELECT original_source_job_id,source_job_id,redrive_kind FROM ${table("jobs")} WHERE id=$1`,
          [populated.resultJobId]
        )
        assert.deepEqual(child, {
          original_source_job_id: populated.sourceJobId,
          source_job_id: populated.sourceJobId,
          redrive_kind: "Redrive"
        })
        const [problem] = yield* client.unsafe<{
          problem: { rootJobId: string; state: string; outcomeKnowledge: string }
        }>(`SELECT problem FROM ${table("job_problems")} WHERE root_job_id=$1`, [
          populated.sourceJobId
        ])
        assert.equal(problem!.problem.rootJobId, populated.sourceJobId)
        assert.equal(problem!.problem.state, "InProgress")
        assert.equal(problem!.problem.outcomeKnowledge, "Unknown")
        const receiptBefore = yield* client.unsafe(
          `SELECT receipt FROM ${table("command_receipts")} WHERE request_id=$1`,
          [populated.requestId]
        )
        report.stage = "historical scoped source deletion and no child cascade"
        yield* client.withTransaction(
          Effect.gen(function* () {
            yield* client.unsafe(
              `DELETE FROM ${table("provider_ledger")} WHERE job_id=$1`,
              [populated.sourceJobId]
            )
            yield* client.unsafe(`DELETE FROM ${table("associations")} WHERE job_id=$1`, [
              populated.sourceJobId
            ])
            yield* client.unsafe(`DELETE FROM ${table("jobs")} WHERE id=$1`, [
              populated.sourceJobId
            ])
          })
        )
        const [edge] = yield* client.unsafe<Record<string, unknown>>(
          `SELECT sandbox_id,generation,original_source_job_id,source_job_id,original_successor_job_id,successor_job_id,root_job_id FROM ${table("operator_redrives")} WHERE request_id=$1`,
          [populated.requestId]
        )
        assert.equal(edge!.sandbox_id, populated.ref.sandboxId)
        assert.equal(Number(edge!.generation), populated.ref.generation)
        assert.equal(edge!.source_job_id, null)
        assert.equal(edge!.original_source_job_id, populated.sourceJobId)
        assert.equal(edge!.original_successor_job_id, populated.resultJobId)
        assert.equal(edge!.successor_job_id, populated.resultJobId)
        assert.equal(edge!.root_job_id, populated.sourceJobId)
        const [retained] = yield* client.unsafe<{
          source_job_id: string | null
          original_source_job_id: string
        }>(
          `SELECT source_job_id,original_source_job_id FROM ${table("jobs")} WHERE id=$1`,
          [populated.resultJobId]
        )
        assert.equal(retained!.source_job_id, null)
        assert.equal(retained!.original_source_job_id, populated.sourceJobId)
        assert.equal(
          (yield* client.unsafe(
            `SELECT job_id FROM ${table("job_payloads")} WHERE job_id=$1`,
            [populated.sourceJobId]
          )).length,
          0
        )
        assert.equal(
          (yield* client.unsafe(
            `SELECT job_id FROM ${table("job_payloads")} WHERE job_id=$1`,
            [populated.resultJobId]
          )).length,
          1
        )
        assert.deepEqual(
          yield* client.unsafe(
            `SELECT receipt FROM ${table("command_receipts")} WHERE request_id=$1`,
            [populated.requestId]
          ),
          receiptBefore
        )
        report.checks.push(
          "historical core/app scoped SET NULL preserves scope/original IDs/problem/exact receipt and successor payload; source payload removed"
        )
      })
    ).pipe(Effect.provide(Reactivity.layer), Effect.timeout("3 minutes"))
  )
  report.success = true
} catch (error) {
  report.failureClass = error instanceof Error ? error.name : "Unknown"
  process.exitCode = 1
} finally {
  writeFileSync(
    `${directory}/historical-receipt.json`,
    JSON.stringify(report, null, 2) + "\n"
  )
  console.log(JSON.stringify(report))
}
