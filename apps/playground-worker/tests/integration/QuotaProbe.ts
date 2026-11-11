// Test-only real admission/enqueue qualification; no HTTP capability or quota engine.
// @effect-diagnostics unstableApiUsage:off
import assert from "node:assert/strict"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import * as Event from "../../src/execution/Event.js"
import { Application } from "../../src/server/Services.js"

export const qualify = (config: Event.Config) =>
  Event.run(
    { ...config, localPrivate: false },
    Effect.void,
    Effect.gen(function* () {
      const app = yield* Application
      const sql = yield* SqlClient
      const issued = yield* app.issue()
      const access = yield* app.authenticate(issued.credential)
      const ref = issued.sandbox.ref
      const snapshot = () =>
        sql.unsafe<{
          retained: number
          jobs: number
          payloads: number
          associations: number
          receipts: number
          admissions: number
          audits: number
        }>(
          `SELECT retained_jobs::int AS retained,
          (SELECT count(*)::int FROM "${config.schema}".jobs) AS jobs,
          (SELECT count(*)::int FROM "${config.schema}".job_payloads) AS payloads,
          (SELECT count(*)::int FROM "${config.schema}".associations) AS associations,
          (SELECT count(*)::int FROM "${config.schema}".command_receipts) AS receipts,
          (SELECT count(*)::int FROM "${config.schema}".command_admission) AS admissions,
          (SELECT count(*)::int FROM "${config.schema}".command_audit) AS audits
          FROM "${config.schema}".sandboxes WHERE sandbox_id=$1`,
          [ref.sandboxId]
        )
      // Issuance uses the real six-job starter. Every additional job is admitted
      // through the guarded production service and its actual owned transactions.
      const initial = (yield* snapshot())[0]!
      assert.equal(initial.retained, 6)
      const batches = yield* Effect.forEach(
        [10, 10, 10, 10, 10, 10, 10, 10, 10, 4],
        Effect.fnUntraced(function* (count, index) {
          const command = {
            sandbox: ref,
            requestId: `quota-fill-${index}`,
            scenario: "success" as const,
            count
          }
          const result = yield* app.run(access, command)
          assert.equal(result._tag, "Committed")
          if (result._tag !== "Committed") {
            return yield* Effect.die("quota fixture admission unconfirmed")
          }
          assert.equal(result.jobIds.length, count)
          assert.deepEqual(
            yield* app.scenarioReceipt(access, {
              sandbox: ref,
              requestId: command.requestId
            }),
            result
          )
          return result.jobIds
        }),
        { concurrency: 1 }
      )
      const ids = batches.flat()
      assert.equal(ids.length, 94)
      assert.equal(new Set(ids).size, 94)
      const persisted = yield* sql.unsafe<{ id: string }>(
        `SELECT id FROM "${config.schema}".jobs WHERE id=ANY($1) ORDER BY id`,
        [ids]
      )
      assert.deepEqual(
        persisted.map((row) => row.id),
        [...ids].sort()
      )
      const before = (yield* snapshot())[0]!
      assert.deepEqual(before, {
        retained: 100,
        jobs: 100,
        payloads: 100,
        associations: 100,
        receipts: 11,
        admissions: 11,
        audits: 11
      })
      const command = {
        sandbox: ref,
        requestId: "quota-refused",
        scenario: "success" as const,
        count: 1
      }
      const failure = yield* Effect.flip(app.run(access, command))
      assert.equal(failure._tag, "PlaygroundError")
      assert.equal(failure.code, "limit-reached")
      const after = (yield* snapshot())[0]!
      // First admission is durable separately; failed reserve rolls back all
      // job/counter/association/receipt/audit work, without granting write replay.
      assert.deepEqual(after, { ...before, admissions: before.admissions + 1 })
      const unknown = {
        _tag: "OutcomeUnknown",
        sandbox: ref,
        requestId: command.requestId
      }
      assert.deepEqual(
        yield* app.scenarioReceipt(access, {
          sandbox: ref,
          requestId: command.requestId
        }),
        unknown
      )
      assert.deepEqual(yield* app.run(access, command), unknown)
      assert.deepEqual((yield* snapshot())[0], after)
      const [admission] = yield* sql.unsafe<{ request_id: string; operation: string }>(
        `SELECT request_id,operation FROM "${config.schema}".command_admission
          WHERE sandbox_id=$1 AND generation=$2 AND request_id=$3`,
        [ref.sandboxId, ref.generation, command.requestId]
      )
      assert.deepEqual(admission, {
        request_id: command.requestId,
        operation: "Scenario"
      })
      return {
        localPrivate: false,
        limit: 100,
        before,
        after,
        rejection: failure.code,
        receipt: unknown._tag,
        replay: "no writes",
        persistedJobIds: persisted.map((row) => row.id)
      }
    })
  )
