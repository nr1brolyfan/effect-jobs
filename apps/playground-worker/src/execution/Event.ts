import * as Repairs from "../persistence/commands/RepairPersistence.js"
import * as RepairTransactions from "../persistence/authority/PostgreSqlRepairTransactions.js"
import { Operators as OperatorService } from "@effect-jobs/playground-contracts/Operators"
import * as Operators from "../persistence/commands/OperatorPersistence.js"
import * as OperatorTransactions from "../persistence/authority/PostgreSqlOperatorTransactions.js"
// @effect-diagnostics unstableApiUsage:off
import * as Reactivity from "effect/reactivity/Reactivity"
import { JobWorker } from "effect-jobs/JobWorker"
import { CommandPersistence } from "../persistence/commands/Transactions.js"
import { Effect, Layer, Redacted } from "effect"
import * as Pg from "@effect/sql-pg/PgClient"
import { SqlClient } from "effect/sql/SqlClient"
import * as Native from "effect-jobs/PostgreSqlNative"
import * as Backend from "effect-jobs/PostgreSqlJobs"
import { PostgreSqlApplication } from "effect-jobs/PostgreSqlTransaction"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import {
  JobsRead,
  SandboxAuthority,
  PlaygroundError
} from "@effect-jobs/playground-contracts/Services"
import * as Mode from "../persistence/authority/PrivateMode.js"
import * as Authority from "../persistence/authority/PostgreSqlAuthority.js"
import * as Commands from "../persistence/commands/Persistence.js"
import * as Executor from "./Executor.js"
import { DocumentKeys } from "../scenarios/PrivateDocument.js"
import * as Read from "../../../website/src/server/read/PostgreSqlRead.js"
import * as ReadDatabase from "../../../website/src/server/read/NativeReadDatabase.js"
import * as Cursor from "../../../website/src/server/read/CursorCodec.js"
import * as Guarded from "../../../website/src/server/commands/GuardedScenarios.js"
import * as Application from "../../../website/src/server/Services.js"

export interface Config {
  readonly localPrivate?: boolean
  readonly connectionString: string
  readonly schema: string
  // Fresh task-owned configuration retained for the lifetime of synthetic jobs.
  readonly encryptionKey: string
  readonly fingerprintKey: string
  readonly cursorKey: string
}
export const mapping = (schema: string) => ({
  schema,
  jobsTable: "jobs",
  sandboxesTable: "sandboxes",
  associationsTable: "associations"
})
const bytes = (hex: string) => {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error("Invalid synthetic key configuration")
  }
  return Uint8Array.from(hex.match(/../g)!, (byte) => Number.parseInt(byte, 16))
}
const keys = (config: Config) =>
  Effect.tryPromise({
    try: async () => ({
      encryption: await crypto.subtle.importKey(
        "raw",
        bytes(config.encryptionKey),
        "AES-GCM",
        false,
        ["encrypt", "decrypt"]
      ),
      fingerprint: await crypto.subtle.importKey(
        "raw",
        bytes(config.fingerprintKey),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
      ),
      cursor: await crypto.subtle.importKey(
        "raw",
        bytes(config.cursorKey),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
      )
    }),
    catch: () => new PlaygroundError({ code: "unavailable" })
  })

// One native client/backend per serialized event. Scope closes before return.
export const run = <A, E>(
  config: Config,
  kick: Effect.Effect<void>,
  operation: Effect.Effect<
    A,
    E,
    | Application.Application
    | SqlClient
    | Backend.PostgreSqlJobs
    | DocumentKeys
    | CommandPersistence
    | JobWorker
    | Repairs.SyntheticRepairs
    | JobsRead
  >
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* Pg.make({
        url: Redacted.make(config.connectionString),
        minConnections: 0,
        maxConnections: 2,
        prepare: false,
        connectTimeout: "2 seconds",
        idleTimeout: "1 second"
      })
      const backend = yield* Backend.make({
        schema: config.schema,
        operationResponseBudgetMillis: 500
      }).pipe(
        Effect.provideService(
          PostgreSqlApplication,
          Native.make({ client, operationTimeoutMillis: 2000 })
        )
      )
      yield* backend.ready
      const stable = yield* keys(config)
      const authority = (yield* Authority.make(config.schema).pipe(
        Effect.provideService(SqlClient, client),
        Effect.provideService(JobEnqueue, backend.producer),
        Effect.provideService(DocumentKeys, stable)
      )).authority
      const activeAuthority = Layer.succeed(SandboxAuthority, {
        ...authority,
        describe: (access) => authority.describe(access).pipe(Effect.tap(() => kick))
      })
      const commands = Commands.layerNoDeps.pipe(
        Layer.provide(Authority.transactionsLayerNoDeps(config.schema)),
        Layer.provide(Layer.succeed(JobEnqueue, backend.producer))
      )
      const worker = Executor.workerLayerNoDeps(config.schema).pipe(
        Layer.provide(Layer.succeed(Backend.PostgreSqlJobs, backend))
      )
      const read = Read.layerNoDeps(mapping(config.schema)).pipe(
        Layer.provide(ReadDatabase.layerNoDeps),
        Layer.provide(Cursor.layer(stable.cursor))
      )
      const guarded = Guarded.layerNoDeps.pipe(
        Layer.provide(Layer.mergeAll(activeAuthority, commands))
      )
      const operators = Layer.effect(
        OperatorService,
        Operators.make.pipe(
          Effect.map((service) => ({
            ...service,
            execute: (access, command) =>
              service
                .execute(access, command)
                .pipe(
                  Effect.tap((result) =>
                    result._tag === "Committed" ? kick : Effect.void
                  )
                ),
            receipt: (access, request) =>
              service
                .receipt(access, request)
                .pipe(
                  Effect.tap((result) =>
                    result._tag === "Committed" ? kick : Effect.void
                  )
                )
          }))
        )
      ).pipe(Layer.provide(OperatorTransactions.layerNoDeps(config.schema)))
      const repairs = Repairs.layerNoDeps.pipe(
        Layer.provide(RepairTransactions.layerNoDeps(config.schema))
      )
      const syntheticRepairs = Repairs.syntheticLayerNoDeps.pipe(
        Layer.provide(RepairTransactions.syntheticLayerNoDeps(config.schema))
      )
      const app = Application.layerNoDeps.pipe(
        Layer.provide(Layer.mergeAll(activeAuthority, read, guarded, operators, repairs))
      )
      return yield* operation.pipe(
        Effect.provide(app),
        Effect.provide(Layer.mergeAll(worker, commands, syntheticRepairs, read)),
        Effect.provideService(SqlClient, client),
        Effect.provideService(Backend.PostgreSqlJobs, backend),
        Effect.provideService(DocumentKeys, stable)
      )
    })
  ).pipe(
    Effect.provideService(Mode.LocalPrivate, config.localPrivate === true),
    Effect.provide(Reactivity.layer)
  )
