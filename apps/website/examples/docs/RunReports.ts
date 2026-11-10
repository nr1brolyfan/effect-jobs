// Native SQL APIs are pinned to @effect/sql-pg 4.0.5.
// @effect-diagnostics unstableApiUsage:off
import { Config, Effect, Layer } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import * as PgClient from "@effect/sql-pg/PgClient"
import { drainReports, pollReports } from "./PostgreSqlReports.js"

import { ReportsLayer, requestReport } from "./DrizzleReportRequest.js"

// #region main
const ClientLayer = PgClient.layerConfig({
  url: Config.Redacted("DATABASE_URL"),
  connectTimeout: Config.succeed("2 seconds"),
  idleTimeout: Config.succeed("10 seconds"),
  startupParameters: Config.succeed({
    statement_timeout: "2000",
    lock_timeout: "1000",
    idle_in_transaction_session_timeout: "5000"
  })
})

const ApplicationLayer = ReportsLayer.pipe(Layer.provideMerge(ClientLayer))

const program = Effect.gen(function* () {
  const mode = yield* Config.Literals(["request", "drain", "poll"], "REPORT_MODE").pipe(
    Config.withDefault("drain")
  )
  const directory = yield* Config.String("REPORT_DIRECTORY").pipe(
    Config.withDefault("./report-output")
  )
  if (mode === "request") {
    const operationId = yield* Config.String("OPERATION_ID")
    const reportId = yield* Config.String("REPORT_ID")
    yield* requestReport(operationId, {
      reportId,
      rows: [{ product: "widget", units: 3 }]
    })
    return
  }
  if (mode === "poll") {
    return yield* pollReports(directory)
  }
  yield* drainReports(directory)
}).pipe(Effect.provide(ApplicationLayer))

NodeRuntime.runMain(program)
// NodeRuntime owns signal handling and scoped client/polling shutdown.
// SQL server deadlines bound healthy-server work, not every network failure.
// Deployments must also bound native acquisition/control/release at their host.
// #endregion main
