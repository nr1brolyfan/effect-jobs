// Qualification fixtures use public lifecycle ports; application SQL only owns associations.
// @effect-diagnostics unstableApiUsage:off
import { Duration, Effect, Redacted, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import { FailureCode } from "effect-jobs/FailureCode"
import * as Policy from "effect-jobs/JobPolicy"
import type { SandboxRef } from "@effect-jobs/playground-contracts/Sandbox"
import type {
  JobOperatorCommand,
  JobOperatorReceiptRequest
} from "@effect-jobs/playground-contracts/Operators"
import { Application } from "../../../website/src/server/Services.js"
import * as Event from "../../src/execution/Event.js"
import * as Plan from "../../src/scenarios/Plan.js"
import * as Definitions from "../../src/scenarios/Definitions.js"
import * as OperatorAuthority from "../../src/persistence/authority/PostgreSqlOperatorTransactions.js"
import * as OperatorPersistence from "../../src/persistence/commands/OperatorPersistence.js"
import { OperatorTransactions } from "../../src/persistence/commands/OperatorTransactions.js"
import { CommandTransactionFailure } from "../../src/persistence/commands/Transactions.js"
export const seed = (
  config: Event.Config,
  ref: SandboxRef,
  state: "Pending" | "RetryScheduled" | "Dead" | "Isolated" | "Active" = "Pending",
  workload = 0
) =>
  Event.run(
    config,
    Effect.void,
    Effect.gen(function* () {
      const backend = yield* PostgreSqlJobs
      const sql = yield* SqlClient
      const id = yield* backend.withTransaction(() =>
        Effect.gen(function* () {
          const [clock] = yield* sql.unsafe<{ now: string }>(
            "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now"
          )
          const [job] = yield* Plan.plan(
            {
              sandbox: ref,
              requestId: crypto.randomUUID(),
              scenario: "success",
              count: 1
            },
            ref,
            workload,
            state === "Pending" ? Number(clock!.now) + 3600000 : Number(clock!.now)
          )
          const result = yield* Plan.enqueue({
            ...job!,
            policy: yield* Policy.make({ retryDelay: Duration.seconds(600) })
          })
          yield* sql.unsafe(
            `INSERT INTO "${config.schema}".associations VALUES ($1,$2,$3,'{}'::jsonb)`,
            [ref.sandboxId, ref.generation, result.jobId]
          )
          yield* sql.unsafe(
            `UPDATE "${config.schema}".sandboxes SET retained_jobs=retained_jobs+1 WHERE sandbox_id=$1`,
            [ref.sandboxId]
          )
          return result.jobId
        })
      )
      if (state !== "Pending") {
        const definition = Definitions.definitions[workload]!
        const claim = yield* backend.store.claim({
          queue: definition.queue.name,
          supportedCatalog: [definition.catalog],
          leaseToken: crypto.randomUUID()
        })
        if (claim._tag !== "Claimed" || claim.claim.snapshot.jobId !== id) {
          return yield* Effect.die("fixture claim failed")
        }
        if (state !== "Active") {
          const finalization =
            state === "RetryScheduled"
              ? {
                  _tag: "Retry" as const,
                  code: Schema.decodeSync(FailureCode)("fixture_retry")
                }
              : {
                  _tag: state === "Dead" ? ("Dead" as const) : ("Isolate" as const),
                  code: Schema.decodeSync(FailureCode)("fixture_terminal")
                }
          const result = yield* backend.store.finalize({
            ownership: claim.claim.ownership,
            before: claim.claim.snapshot,
            finalization
          })
          if (result._tag !== "Applied") {
            return yield* Effect.die("fixture finalize failed")
          }
        }
      }
      return id
    })
  )
export const execute = (
  config: Event.Config,
  credential: string,
  command: JobOperatorCommand
) =>
  Event.run(
    config,
    Effect.void,
    Effect.gen(function* () {
      const app = yield* Application
      return yield* app.execute(
        yield* app.authenticate(Redacted.make(credential)),
        command
      )
    })
  )
export const lookup = (
  config: Event.Config,
  credential: string,
  request: JobOperatorReceiptRequest
) =>
  Event.run(
    config,
    Effect.void,
    Effect.gen(function* () {
      const app = yield* Application
      return yield* app.receipt(
        yield* app.authenticate(Redacted.make(credential)),
        request
      )
    })
  )

// Synthetic lost owning COMMIT response after the real native transaction resolves.
// This tests reconciliation, not a network/server-crash guarantee.
export const lostCommit = (
  config: Event.Config,
  credential: string,
  command: JobOperatorCommand
) =>
  Event.run(
    config,
    Effect.void,
    Effect.gen(function* () {
      const app = yield* Application
      const access = yield* app.authenticate(Redacted.make(credential))
      const transactions = yield* OperatorAuthority.make(config.schema)
      const service = yield* OperatorPersistence.make.pipe(
        Effect.provideService(OperatorTransactions, {
          ...transactions,
          owned: (access, command, body) =>
            transactions
              .owned(access, command, body)
              .pipe(
                Effect.flatMap(() =>
                  Effect.fail(
                    new CommandTransactionFailure({ commitKnowledge: "Unknown" })
                  )
                )
              )
        })
      )
      return yield* service.execute(access, command)
    })
  )
