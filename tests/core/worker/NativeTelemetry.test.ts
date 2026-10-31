// Pinned native SQL and OTLP APIs are the integration under test.
// @effect-diagnostics unstableApiUsage:off
import assert from "node:assert/strict"
import { Cause, Context, Effect, Exit, Layer, Logger, Tracer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { OtlpExporter, OtlpSerialization, OtlpTracer } from "effect/observability"
import { makeWithTransaction } from "effect/sql/SqlClient"
import type { TransactionConnection } from "effect/sql/SqlClient"
import type { Connection } from "effect/sql/SqlConnection"
import { ConnectionError, SqlError } from "effect/sql/SqlError"
import { it } from "vitest"
import * as Native from "../../../src/PostgreSqlNative.js"

const canary = "SYNTHETIC_SQL_CONTROL_CANARY"
const providerError = () =>
  new SqlError({
    reason: new ConnectionError({ cause: new Error(canary), message: canary })
  })

for (const encoding of ["json", "protobuf"] as const) {
  for (const fault of [
    "begin",
    "commit",
    "rollback",
    "release",
    "mixed",
    "interrupt",
    "body",
    "success"
  ] as const) {
    it(`native ${fault}: preserves channels and protects SQL span through ${encoding} serialization`, async () => {
      const bodies: Uint8Array[] = []
      const spans: Tracer.Span[] = []
      const connection = {} as Connection
      const transactionService = Context.Service<
        TransactionConnection,
        readonly [Connection, number]
      >(`test/native/${fault}`)
      const client = HttpClient.make((request) => {
        if (request.body._tag === "Uint8Array") {
          bodies.push(request.body.body)
        }
        return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}")))
      })
      let rollback = 0
      let commit = 0
      const withTransaction = makeWithTransaction({
        transactionService,
        spanAttributes: [],
        acquireConnection: () =>
          Effect.acquireRelease(Effect.succeed(connection), () =>
            fault === "release" ? Effect.die(providerError()) : Effect.void
          ),
        begin: () => (fault === "begin" ? Effect.fail(providerError()) : Effect.void),
        savepoint: () => Effect.void,
        commit: () =>
          Effect.suspend(() => {
            commit++
            return fault === "commit"
              ? Effect.fail(providerError())
              : fault === "mixed"
                ? Effect.failCause(
                    Cause.combine(Cause.fail(providerError()), Cause.die(providerError()))
                  )
                : Effect.void
          }),
        rollback: () =>
          Effect.suspend(() => {
            rollback++
            return fault === "rollback" ? Effect.fail(providerError()) : Effect.void
          }),
        rollbackSavepoint: () => Effect.void
      })
      const adapter = Native.make({
        client: { transactionService, withTransaction },
        operationTimeoutMillis: 100
      })
      const bodyFailure = { marker: "SYNTHETIC_BODY_CANARY" }
      const body =
        fault === "interrupt"
          ? Effect.interrupt
          : fault === "body" || fault === "rollback"
            ? Effect.fail(bodyFailure)
            : Effect.void
      const exit = await Effect.runPromise(
        Effect.gen(function* () {
          const exporter = yield* OtlpTracer.make({
            url: "http://synthetic.invalid/v1/traces",
            resource: { serviceName: "jobs-synthetic", serviceVersion: "test" },
            exportInterval: "1 hour",
            maxBatchSize: 100,
            shutdownTimeout: "100 millis"
          })
          const host = Tracer.make({
            context: exporter.context,
            span(options) {
              const span = exporter.span(options)
              spans.push(span)
              return span
            }
          })
          const result = yield* adapter
            .ownedTransaction(() => body)
            .pipe(Effect.withTracer(host), Effect.exit)
          // Positive control proves failed application spans remain visible/exportable.
          yield* Effect.die(new Error("SYNTHETIC_APP_POSITIVE_CONTROL")).pipe(
            Effect.withSpan("application.positive"),
            Effect.withTracer(host),
            Effect.exit
          )
          yield* (yield* OtlpExporter.Flusher).flush
          return result
        }).pipe(
          Effect.provideService(HttpClient.HttpClient, client),
          Effect.provide(
            Layer.mergeAll(
              encoding === "json"
                ? OtlpSerialization.layerJson
                : OtlpSerialization.layerProtobuf,
              OtlpExporter.layerFlusher,
              Logger.layer([])
            )
          ),
          Effect.scoped
        )
      )
      assert.ok(bodies.length > 0, "nonempty actual serialization")
      const serialized = Buffer.concat(bodies).toString("utf8")
      assert.ok(serialized.includes("SYNTHETIC_APP_POSITIVE_CONTROL"))
      assert.ok(!serialized.includes(canary))
      assert.ok(!serialized.includes("SYNTHETIC_BODY_CANARY"))
      const sql = spans.find((span) => span.name === "sql.transaction")!
      assert.equal(sql.status._tag, "Ended")
      if (sql.status._tag === "Ended") {
        assert.deepEqual(sql.status.exit, Exit.succeed(undefined))
      }
      if (fault === "success") {
        assert.ok(Exit.isSuccess(exit))
      } else {
        assert.ok(Exit.isFailure(exit))
      }
      if (Exit.isFailure(exit)) {
        if (fault === "interrupt") {
          assert.ok(Cause.hasInterruptsOnly(exit.cause))
        } else if (fault === "body") {
          assert.equal(
            exit.cause.reasons[0]?._tag === "Fail" && exit.cause.reasons[0].error,
            bodyFailure
          )
        } else {
          assert.ok(!Cause.pretty(exit.cause).includes(canary))
        }
        if (fault === "mixed") {
          assert.equal(exit.cause.reasons.length, 2)
        }
      }
      assert.equal(rollback, ["body", "rollback", "interrupt"].includes(fault) ? 1 : 0)
      assert.equal(
        commit,
        ["commit", "mixed", "release", "success"].includes(fault) ? 1 : 0
      )
    })
  }
}
