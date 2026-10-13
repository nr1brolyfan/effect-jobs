// Qualification FFI: new owned config only; no resource acquisition on import.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { Cause, Effect, Redacted } from "effect"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as Pg from "@effect/sql-pg/PgClient"
import { SqlClient } from "effect/sql/SqlClient"
import * as Qualification from "../repairs/PostgreSqlQualification.js"
import * as Migrations from "../../src/persistence/MigrationRegistry.js"
import * as Event from "../../src/execution/Event.js"
import * as Executor from "../../src/execution/Executor.js"
import * as Drain from "effect-jobs/JobWorkerRuntime"
import * as Manager from "../../src/demo/Manager.js"
import * as Showcase from "../../src/demo/RepairShowcase.js"
import * as DemoHttp from "../../src/demo/Http.js"

const cfg = JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG!, "utf8"))
const directory = process.env.D6_RESOURCE_DIRECTORY!
const url = `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${cfg.port}/${cfg.database}`
const report: {
  checks: string[]
  stage: string
  success: boolean
  failureTags?: string[]
  sqlFailure?: ReturnType<typeof safeFailure>
} = {
  checks: [],
  stage: "original app qualification",
  success: false
}
// PostgreSQL metadata only, never SQL, provider messages, credentials or payloads.
export const safeFailure = (error: unknown) => {
  const failure = error as {
    reason?: {
      _tag?: string
      cause?: { code?: string; position?: string; routine?: string; constraint?: string }
    }
  }
  const reason = failure?.reason
  return {
    reason: reason?._tag,
    code: reason?.cause?.code,
    position: reason?.cause?.position,
    routine: reason?.cause?.routine,
    constraint: reason?.cause?.constraint
  }
}
const native = Effect.scoped(
  Effect.gen(function* () {
    const client = yield* Pg.make({
      url: Redacted.make(url),
      maxConnections: 4,
      minConnections: 0,
      prepare: false,
      connectTimeout: "2 seconds"
    })
    const result = yield* Qualification.qualify(
      client,
      `repair_qualification_${randomBytes(6).toString("hex")}`
    )
    report.checks.push(...result.checks)
  })
).pipe(Effect.provide(Reactivity.layer), Effect.timeout("3 minutes"))

export const prepareRecorded = async () => {
  const config: Event.Config = { ...cfg, connectionString: url, localPrivate: true }
  const run = <A, E>(body: Parameters<typeof Event.run<A, E>>[2]) =>
    Effect.runPromise(
      Event.run(config, Effect.void, body).pipe(Effect.timeout("30 seconds"))
    )
  report.stage = "fresh mapped app migrations"
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* Pg.make({
          url: Redacted.make(url),
          maxConnections: 1,
          prepare: false
        })
        yield* client.unsafe(`CREATE SCHEMA "${cfg.schema}"`)
        yield* client.withTransaction(
          Effect.gen(function* () {
            for (const migration of Migrations.migrations(cfg.schema)) {
              report.stage = `fresh app migration ${migration.id}`
              yield* client.unsafe(migration.sql)
            }
            yield* Migrations.backfillSyntheticTenants(cfg.schema).pipe(
              Effect.provideService(SqlClient, client)
            )
          })
        )
      })
    ).pipe(Effect.provide(Reactivity.layer))
  )
  report.stage = "actual trusted demo seed and handlers"
  await run(Manager.tick(cfg.schema))
  const drain = Effect.gen(function* () {
    const plans = yield* Executor.consumers
    for (const plan of plans) {
      yield* Drain.drain(plan)
    }
  })
  // Finite bounded drains, not sleep/polling or fabricated lifecycle changes.
  await run(drain)
  await run(drain)
  await run(Manager.tick(cfg.schema))
  report.stage = "actual stored encrypted fixture and trusted repair"
  const sandbox = await run(Manager.current(cfg.schema))
  await run(Showcase.run(cfg.schema, sandbox))
  await run(drain)
  await run(drain)
  // Worker reconciliation is an application operation, independent of execution state.
  const Reconcile = await import("../../src/execution/RepairReconciliation.js")
  await run(Reconcile.run(cfg.schema, { limit: 50 }))
  await run(Showcase.run(cfg.schema, sandbox))
  await run(drain)
  await run(Reconcile.run(cfg.schema, { limit: 50 }))
  const ready = await run(DemoHttp.readyCurrent(cfg.schema))
  assert.deepEqual(ready.ref, sandbox.ref)
  report.checks.push(
    "actual native encrypted seed/worker/corrected successor/audited resolution"
  )
  return sandbox
}

if (process.env.REPAIR_PREPARE_ONLY !== "true") {
  try {
    await Effect.runPromise(native)
    report.success = true
    console.log(JSON.stringify(report))
  } catch (error) {
    const cause = Cause.isCause(error) ? error : undefined
    report.sqlFailure = safeFailure(error)
    report.failureTags = cause
      ? cause.reasons.map((reason) => reason._tag)
      : [error instanceof Error ? error.name : "Unknown"]
    console.log(JSON.stringify(report))
    process.exitCode = 1
  } finally {
    writeFileSync(
      `${directory}/app-pg-receipt.json`,
      JSON.stringify(report, null, 2) + "\n"
    )
  }
}
