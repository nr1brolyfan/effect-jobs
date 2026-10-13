// Explicit, finite qualification entrypoint. The serial owner supplies a NEW
// application-owned PG16.15 client. No env/config/pool/resource access on import.
// NOT executed by isolated unit tests; see the handoff prerequisite.
// @effect-diagnostics unstableApiUsage:off
import assert from "node:assert/strict"
import { Effect, Exit, Schema } from "effect"
import type { PgClient } from "@effect/sql-pg/PgClient"
import { SqlClient } from "effect/sql/SqlClient"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import { JobFinalization } from "effect-jobs/JobLifecycle"
import * as Jobs from "effect-jobs/PostgreSqlJobs"
import * as Native from "effect-jobs/PostgreSqlNative"
import { PostgreSqlApplication } from "effect-jobs/PostgreSqlTransaction"
import * as Codec from "effect-jobs/JobPayloadCodec"
import { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import { JobRepairCommand } from "@effect-jobs/playground-contracts/Repairs"
import * as Registry from "../../src/persistence/MigrationRegistry.js"
import * as Adapter from "../../src/persistence/authority/PostgreSqlRepairTransactions.js"
import * as Mode from "../../src/persistence/authority/PrivateMode.js"
import * as RepairSchema from "../../src/persistence/commands/RepairSchema.js"
import { RepairTransactions } from "../../src/persistence/commands/RepairTransactions.js"
import * as Persistence from "../../src/persistence/commands/RepairPersistence.js"
import * as Reconciliation from "../../src/execution/RepairReconciliation.js"
import * as Provider from "../../src/execution/PostgreSqlProvider.js"
import * as Definitions from "../../src/scenarios/Definitions.js"
import { keysLayer } from "../../src/scenarios/PrivateDocument.js"
import * as Fixture from "./Fixtures.js"

// PgClient uses the extended protocol even for unprepared statements. Send one
// DO command and let PostgreSQL parse the unchanged descriptor through EXECUTE.
// This retains nested DO bodies, strings, comments and command order without a
// client-side SQL splitter. These registered migrations have no transaction control.
export const migrationCommand = (sql: string): string => {
  let suffix = ""
  while (
    sql.includes(`$repair_sql${suffix}$`) ||
    sql.includes(`$repair_block${suffix}$`)
  ) {
    suffix += "_"
  }
  const body = `$repair_block${suffix}$`
  const command = `$repair_sql${suffix}$`
  return `DO ${body} BEGIN EXECUTE ${command}${sql}${command}; END ${body} LANGUAGE plpgsql;`
}

export const qualify = (client: PgClient, schema: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      // A unique qualification namespace, never an existing app/preview schema.
      if (!/^repair_qualification_[a-f0-9]{12}$/u.test(schema)) {
        return yield* Effect.die(new Error("Fresh qualification schema required"))
      }
      const [version] = yield* client.unsafe<{ server_version: string }>(
        "SHOW server_version"
      )
      assert.match(version!.server_version, /^16\.15(?:\D|$)/u)
      yield* Effect.acquireRelease(client.unsafe(`CREATE SCHEMA "${schema}"`), () =>
        client.unsafe(`DROP SCHEMA "${schema}" CASCADE`).pipe(Effect.orDie)
      )
      yield* client.withTransaction(
        Effect.gen(function* () {
          for (const migration of Registry.migrations(schema)) {
            yield* client.unsafe(migrationCommand(migration.sql))
          }
          yield* Registry.backfillSyntheticTenants(schema)
        })
      )
      const backend = yield* Jobs.make({
        schema,
        operationResponseBudgetMillis: 500
      }).pipe(
        Effect.provideService(
          PostgreSqlApplication,
          Native.make({ client, operationTimeoutMillis: 2000 })
        )
      )
      const transactions = yield* Adapter.make(schema)
      const service = yield* Persistence.make.pipe(
        Effect.provideService(RepairTransactions, transactions),
        Effect.provideService(Jobs.PostgreSqlJobs, backend),
        Effect.provide(keysLayer)
      )
      const provider = yield* Provider.make(schema)
      const t = RepairSchema.relations(schema)
      const ref = Schema.decodeSync(SandboxRef)({
        sandboxId: "repair-pg-qualification",
        generation: 1
      })
      yield* client.unsafe(
        `INSERT INTO ${t.sandboxes}(sandbox_id,generation,expires_at,credential_hash) VALUES ($1,1,floor(extract(epoch FROM clock_timestamp())*1000)::bigint+3600000,'synthetic-qualification-only')`,
        [ref.sandboxId]
      )
      const access = {
        sandbox: {
          ref,
          expiresAt: Date.now() + 3600000,
          capabilities: {
            runScenario: true,
            resetSandbox: true,
            retryJob: true,
            cancelJob: true,
            redriveJob: true
          }
        }
      }
      const seed = (behavior: Definitions.Behavior) =>
        Effect.gen(function* () {
          const payload = { ...Fixture.payload, sandbox: ref, behavior }
          const producer = {
            operation: "playground.synthetic",
            operationId: crypto.randomUUID(),
            slot: "welcome-email"
          }
          const inserted = yield* client.withTransaction(
            Effect.gen(function* () {
              const result = yield* Definitions.WelcomeEmail.enqueue({
                producer,
                payload,
                policy: Fixture.detail.policy
              }).pipe(Effect.provideService(JobEnqueue, backend.producer))
              assert.equal(result._tag, "Inserted")
              if (result._tag !== "Inserted") {
                return yield* Effect.die(new Error("Fresh producer identity required"))
              }
              yield* client.unsafe(
                `INSERT INTO ${t.associations}(sandbox_id,generation,job_id,relations) VALUES ($1,1,$2,$3::jsonb)`,
                [
                  ref.sandboxId,
                  result.jobId,
                  JSON.stringify({
                    syntheticActor: payload.actor,
                    syntheticOrderId: payload.order,
                    syntheticTenant: payload.tenant
                  })
                ]
              )
              yield* client.unsafe(
                `UPDATE ${t.sandboxes} SET retained_jobs=retained_jobs+1 WHERE sandbox_id=$1`,
                [ref.sandboxId]
              )
              return result.jobId
            })
          )
          const claimed = yield* backend.store.claim({
            queue: Definitions.WelcomeEmail.catalog.queue,
            supportedCatalog: [Definitions.WelcomeEmail.catalog],
            leaseToken: crypto.randomUUID()
          })
          assert.equal(claimed._tag, "Claimed")
          if (claimed._tag !== "Claimed") {
            return yield* Effect.die(new Error("Expected fresh claim"))
          }
          assert.equal(claimed.claim.ownership.jobId, inserted)
          const encoded = yield* Codec.encodeJobPayload(Definitions.Payload, payload)
          const invoked = yield* Effect.exit(
            provider.execute({
              sandbox: ref,
              producer,
              workload: "welcome-email",
              behavior,
              semanticProjection: encoded.semanticProjectionBytes
            })
          )
          assert.ok(Exit.isFailure(invoked))
          const finalization = Schema.decodeSync(JobFinalization)(
            behavior === "dead"
              ? { _tag: "Dead", code: "fake_provider_terminal_rejected" }
              : { _tag: "Isolate", code: "fake_provider_response_lost" }
          )
          assert.equal(
            (yield* backend.store.finalize({
              ownership: claimed.claim.ownership,
              before: claimed.claim.snapshot,
              finalization
            }))._tag,
            "Applied"
          )
          const [row] = yield* client.unsafe<Record<string, unknown>>(
            `SELECT * FROM ${t.jobs} WHERE id=$1`,
            [inserted]
          )
          return { payload, jobId: inserted, row: row! }
        })
      const complete = (jobId: string) =>
        Effect.gen(function* () {
          const claimed = yield* backend.store.claim({
            queue: Definitions.WelcomeEmail.catalog.queue,
            supportedCatalog: [Definitions.WelcomeEmail.catalog],
            leaseToken: crypto.randomUUID()
          })
          assert.equal(claimed._tag, "Claimed")
          if (claimed._tag !== "Claimed") {
            return yield* Effect.die(new Error("Expected successor claim"))
          }
          assert.equal(claimed.claim.ownership.jobId, jobId)
          assert.equal(
            (yield* backend.store.finalize({
              ownership: claimed.claim.ownership,
              before: claimed.claim.snapshot,
              finalization: { _tag: "Complete" }
            }))._tag,
            "Applied"
          )
        })
      const snapshot = (jobId: string) =>
        client.unsafe(
          `SELECT j.*,encode(p.payload,'hex') AS retained_payload,encode(p.projection,'hex') AS retained_projection FROM ${t.jobs} j JOIN ${t.payloads} p ON p.job_id=j.id WHERE j.id=$1`,
          [jobId]
        )
      const known = yield* seed("dead")
      const before = yield* snapshot(known.jobId)
      const command = Schema.decodeUnknownSync(JobRepairCommand)({
        ...Fixture.command,
        sandbox: ref,
        jobId: known.jobId,
        requestId: crypto.randomUUID(),
        expectedLifecycleVersion: Number(known.row.lifecycle_version),
        payload: { ...known.payload, behavior: "success" }
      })
      const concurrent = yield* Effect.all(
        [service.execute(access, command), service.execute(access, command)],
        { concurrency: 2 }
      )
      assert.ok(
        concurrent.every(
          (result) => result._tag === "Committed" || result._tag === "OutcomeUnknown"
        )
      )
      const receipt = yield* service.receipt(access, {
        sandbox: ref,
        requestId: command.requestId
      })
      assert.equal(receipt._tag, "Committed")
      if (receipt._tag !== "Committed") {
        return yield* Effect.die(new Error("Expected acknowledged exact receipt"))
      }
      assert.deepEqual(yield* snapshot(known.jobId), before)
      const conflict = yield* service.execute(access, {
        ...command,
        reason: "Changed immutable identity"
      })
      assert.ok(conflict._tag === "Rejected" && conflict.reason === "request-conflict")
      const second = yield* service.execute(access, {
        ...command,
        requestId: crypto.randomUUID(),
        expectedResolutionVersion: 1
      })
      assert.ok(second._tag === "Rejected" && second.reason === "repair-in-progress")
      const [childCount] = yield* client.unsafe<{ n: string }>(
        `SELECT count(*) AS n FROM ${t.jobs} WHERE original_source_job_id=$1`,
        [known.jobId]
      )
      assert.equal(Number(childCount!.n), 1)
      yield* complete(receipt.resultJobId)
      yield* Reconciliation.run(schema, { limit: 50 })
      const [resolved] = yield* client.unsafe<{ problem: unknown }>(
        `SELECT problem FROM ${t.problems} WHERE sandbox_id=$1 AND generation=1 AND root_job_id=$2`,
        [ref.sandboxId, known.jobId]
      )
      assert.equal(
        (yield* RepairSchema.decodeProblem(resolved!.problem)).state,
        "Resolved"
      )
      yield* client.withTransaction(
        Effect.gen(function* () {
          yield* client.unsafe(`DELETE FROM ${t.ledger} WHERE job_id=$1`, [known.jobId])
          yield* client.unsafe(`DELETE FROM ${t.associations} WHERE job_id=$1`, [
            known.jobId
          ])
          yield* client.unsafe(`DELETE FROM ${t.jobs} WHERE id=$1`, [known.jobId])
        })
      )
      const [retainedChild] = yield* client.unsafe<{
        original_source_job_id: string
        source_job_id: string | null
      }>(`SELECT original_source_job_id,source_job_id FROM ${t.jobs} WHERE id=$1`, [
        receipt.resultJobId
      ])
      assert.equal(retainedChild!.original_source_job_id, known.jobId)
      assert.equal(retainedChild!.source_job_id, null)
      const [member] = yield* client.unsafe<{
        sandbox_id: string
        generation: string
        job_id: string
        live_job_id: string | null
      }>(
        `SELECT sandbox_id,generation,job_id,live_job_id FROM ${t.members} WHERE job_id=$1`,
        [known.jobId]
      )
      assert.equal(member!.sandbox_id, ref.sandboxId)
      assert.equal(Number(member!.generation), 1)
      assert.equal(member!.job_id, known.jobId)
      assert.equal(member!.live_job_id, null)
      assert.deepEqual(
        yield* service.receipt(access, { sandbox: ref, requestId: command.requestId }),
        receipt
      )
      const uncertain = yield* seed("accepted-response-lost")
      const unknownCommand = Schema.decodeUnknownSync(JobRepairCommand)({
        ...Fixture.command,
        sandbox: ref,
        jobId: uncertain.jobId,
        expectedState: "Isolated",
        expectedLifecycleVersion: Number(uncertain.row.lifecycle_version),
        requestId: crypto.randomUUID(),
        investigation: {
          _tag: "AcceptDuplicateRisk",
          reason: "Unknown external outcome investigated"
        },
        payload: { ...uncertain.payload, behavior: "success" }
      })
      const unknownRepair = yield* service.execute(access, unknownCommand)
      assert.equal(unknownRepair._tag, "Committed")
      if (unknownRepair._tag !== "Committed") {
        return yield* Effect.die(new Error("Expected unknown-outcome repair"))
      }
      yield* complete(unknownRepair.resultJobId)
      yield* Reconciliation.run(schema, { limit: 50 })
      const [opened] = yield* client.unsafe<{ problem: unknown }>(
        `SELECT problem FROM ${t.problems} WHERE sandbox_id=$1 AND generation=1 AND root_job_id=$2`,
        [ref.sandboxId, uncertain.jobId]
      )
      const problem = yield* RepairSchema.decodeProblem(opened!.problem)
      assert.equal(problem.state, "Open")
      assert.equal(problem.outcomeKnowledge, "Unknown")
      const close = {
        sandbox: ref,
        rootJobId: uncertain.jobId,
        expectedResolutionVersion: problem.version,
        action: "manual-close" as const,
        reason: "Explicit investigation closure",
        requestId: crypto.randomUUID()
      }
      const rejected = yield* service.resolve(access, close)
      assert.ok(
        rejected._tag === "Rejected" && rejected.reason === "investigation-required"
      )
      const closed = yield* service.resolve(access, {
        ...close,
        requestId: crypto.randomUUID(),
        confirmUnknownOutcome: true
      })
      assert.ok(
        closed._tag === "Committed" &&
          closed.problem.state === "Resolved" &&
          closed.problem.outcomeKnowledge === "Unknown"
      )
      return {
        checks: [
          "registered v1-v6 and same-transaction synthetic tenant backfill",
          "actual core source immutability",
          "concurrent immutable admissions",
          "one scoped successor",
          "known-success reconciliation",
          "scoped source-deleted retention and exact receipt",
          "unknown-success reopening and confirmed manual closure"
        ]
      }
    })
  ).pipe(
    Effect.provideService(SqlClient, client),
    Effect.provideService(Mode.LocalPrivate, true),
    Effect.timeout("2 minutes")
  )
