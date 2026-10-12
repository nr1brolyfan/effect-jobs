// Durable synthetic provider only: no network/payment/email and no lifecycle SQL.
// @effect-diagnostics unstableApiUsage:off
import { Cause, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import {
  FakeProvider,
  InvariantViolation,
  PayloadConflict,
  ResponseLost,
  RetryRejected,
  TerminalRejected,
  LedgerFull
} from "../providers/FakeProvider.js"
import type { ProviderCommand, ProviderFailure } from "../providers/FakeProvider.js"
import * as Tables from "../persistence/authority/Schema.js"

export const make = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const t = Tables.relations(schema)
    return FakeProvider.of({
      execute: (command: ProviderCommand) =>
        Effect.gen(function* () {
          // Copy before the first async boundary; only the hash persists, never payload bytes.
          const projection = new Uint8Array(command.semanticProjection)
          const signature = yield* Effect.tryPromise({
            try: async () =>
              JSON.stringify([
                command.workload,
                command.behavior,
                Array.from(
                  new Uint8Array(await crypto.subtle.digest("SHA-256", projection))
                )
              ]),
            catch: () => new InvariantViolation()
          })
          const outcome = yield* sql
            .withTransaction(
              Effect.gen(function* () {
                const rows = yield* sql.unsafe<Record<string, unknown>>(
                  `SELECT *
          FROM ${t.sandboxes} WHERE sandbox_id=$1 FOR UPDATE`,
                  [command.sandbox.sandboxId]
                )
                const sandbox = rows[0]
                const [clock] = yield* sql.unsafe<{ now: string }>(
                  "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now"
                )
                if (
                  !sandbox ||
                  Number(sandbox.generation) !== command.sandbox.generation ||
                  Number(sandbox.expires_at) <= Number(clock!.now)
                ) {
                  return new InvariantViolation()
                }
                // A decoded payload is insufficient authority: bind producer to its actual mapped job.
                const jobs = yield* sql.unsafe<Record<string, unknown>>(
                  `SELECT j.id FROM ${t.jobs} j JOIN ${t.associations} a ON a.job_id=j.id
          WHERE a.sandbox_id=$1 AND a.generation=$2 AND j.operation=$3 AND j.operation_id=$4 AND j.slot=$5 AND j.kind=$6`,
                  [
                    command.sandbox.sandboxId,
                    command.sandbox.generation,
                    command.producer.operation,
                    command.producer.operationId,
                    command.producer.slot,
                    `playground.${command.workload}`
                  ]
                )
                const job = jobs[0]
                if (!job) {
                  return new InvariantViolation()
                }
                const existing = (yield* sql.unsafe<Record<string, unknown>>(
                  `SELECT * FROM ${t.ledger} WHERE job_id=$1`,
                  [job.id]
                ))[0]
                if (existing && existing.signature !== signature) {
                  return new PayloadConflict()
                }
                if (!existing) {
                  const size = (yield* sql.unsafe<{ n: number }>(
                    `SELECT count(*)::int AS n FROM ${t.ledger} WHERE sandbox_id=$1`,
                    [command.sandbox.sandboxId]
                  ))[0]!.n
                  if (size >= (sandbox.demo_owned === true ? 3000 : 100)) {
                    return new LedgerFull()
                  }
                }
                const invocations = Math.min(
                  Number(existing?.invocations ?? 0) + 1,
                  1_000_000
                )
                const alreadyAccepted = existing?.accepted === true
                const accepted =
                  alreadyAccepted ||
                  (command.behavior !== "dead" &&
                    command.behavior !== "isolated" &&
                    !(command.behavior === "retry-then-success" && invocations === 1))
                yield* sql.unsafe(
                  `INSERT INTO ${t.ledger} VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (sandbox_id,generation,job_id) DO UPDATE SET accepted=EXCLUDED.accepted,invocations=EXCLUDED.invocations`,
                  [
                    command.sandbox.sandboxId,
                    command.sandbox.generation,
                    job.id,
                    signature,
                    accepted,
                    invocations
                  ]
                )
                if (alreadyAccepted) {
                  return undefined
                }
                switch (command.behavior) {
                  case "success":
                    return undefined
                  case "retry-then-success":
                    return invocations === 1 ? new RetryRejected() : undefined
                  case "dead":
                    return new TerminalRejected()
                  case "isolated":
                    return new InvariantViolation()
                  case "accepted-response-lost":
                    return new ResponseLost()
                }
              })
            )
            .pipe(
              Effect.catchCause((cause) =>
                Effect.failCause(Cause.map(cause, () => new ResponseLost()))
              )
            )
          // Expected synthetic failure is returned AFTER acknowledged ledger commit.
          if (outcome) {
            return yield* Effect.fail(outcome as ProviderFailure)
          }
        }),
      // Mock observation DTO has source="mock"; a durable ledger must not impersonate it.
      inspect: () => Effect.succeed(undefined)
    })
  })
export const layerNoDeps = (schema: string) => Layer.effect(FakeProvider, make(schema))
