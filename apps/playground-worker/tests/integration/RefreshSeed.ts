// Qualification-only fixture. Public enqueue owns jobs/payloads; app SQL owns associations.
// @effect-diagnostics unstableApiUsage:off
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import type { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import * as Event from "../../src/execution/Event.js"
import * as Plan from "../../src/scenarios/Plan.js"

export const seed = (
  config: Event.Config,
  ref: SandboxRef,
  count: number,
  workload = 0
) =>
  Event.run(
    config,
    Effect.void,
    Effect.gen(function* () {
      const backend = yield* PostgreSqlJobs
      const sql = yield* SqlClient
      return yield* backend.withTransaction(() =>
        Effect.gen(function* () {
          const authority = yield* sql.unsafe<{ now: string }>(
            `SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now FROM "${config.schema}".sandboxes WHERE sandbox_id=$1 AND generation=$2 AND expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint FOR UPDATE`,
            [ref.sandboxId, ref.generation]
          )
          if (!authority.length || !Number.isInteger(count) || count < 1 || count > 60) {
            return yield* Effect.die("invalid qualification seed")
          }
          const ids: string[] = []
          for (let index = 0; index < count; index++) {
            const [job] = yield* Plan.plan(
              {
                sandbox: ref,
                requestId: `refresh-${workload}-${index}`,
                scenario: "success",
                count: 1
              },
              ref,
              workload,
              Number(authority[0]!.now) + 3600000
            )
            const result = yield* Plan.enqueue(job!)
            yield* sql.unsafe(
              `INSERT INTO "${config.schema}".associations VALUES($1,$2,$3,'{}'::jsonb)`,
              [ref.sandboxId, ref.generation, result.jobId]
            )
            ids.push(result.jobId)
          }
          yield* sql.unsafe(
            `UPDATE "${config.schema}".sandboxes SET retained_jobs=retained_jobs+$2 WHERE sandbox_id=$1`,
            [ref.sandboxId, count]
          )
          return ids.sort()
        })
      )
    })
  )
