import { Cause, Effect, Exit, Schema } from "effect"
import { expect, test } from "vitest"
import { makeOperators } from "../../../src/internal/postgresql/Operators.js"
import {
  PostgreSqlFailure,
  PostgreSqlInvalidHandle
} from "../../../src/PostgreSqlTransaction.js"
import type {
  ApplicationAdapter,
  TransactionQuery
} from "../../../src/PostgreSqlTransaction.js"
import { JobOperatorExpected } from "../../../src/JobOperators.js"
import * as Policy from "../../../src/JobPolicy.js"
import { encodeJobPayload } from "../../../src/JobPayloadCodec.js"

const expected = Schema.decodeSync(JobOperatorExpected)({
  jobId: "source",
  state: "Dead",
  lifecycleVersion: 4
})
const definition = {
  catalog: { queue: "billing", kind: "invoice", version: 1 },
  payload: Schema.Struct({ value: Schema.String })
}
const unavailable: ApplicationAdapter = {
  validate: () =>
    Effect.fail(new PostgreSqlInvalidHandle({ reason: "unqualified-handle" })),
  withTransaction: () =>
    Effect.fail(new PostgreSqlInvalidHandle({ reason: "unqualified-handle" })),
  ownedTransaction: () =>
    Effect.fail(new PostgreSqlInvalidHandle({ reason: "unqualified-handle" }))
}
const error = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : undefined

test.each(["foreign-source", "inactive-handle"] as const)(
  "%s fails before query/decode",
  async (reason) => {
    const service = makeOperators(
      { ...unavailable, ambient: Effect.fail(new PostgreSqlInvalidHandle({ reason })) },
      '"jobs"',
      '"payloads"',
      10
    )
    const exit = await Effect.runPromiseExit(
      service.redrive(definition, {
        expected,
        producer: { operation: "manual", operationId: "new", slot: "replacement" }
      })
    )
    expect(error(exit)).toMatchObject({ value: { reason } })
  }
)
test("absent ambient fails and never falls back to a transaction", async () => {
  const service = makeOperators(unavailable, '"jobs"', '"payloads"', 10)
  expect(error(await Effect.runPromiseExit(service.cancel(expected)))).toMatchObject({
    value: { reason: "unqualified-handle" }
  })
})
test("unknown provider query failure is preserved without retry", async () => {
  let calls = 0
  const query: TransactionQuery = {
    query: () => {
      calls++
      return Effect.fail(new PostgreSqlFailure({ commitKnowledge: "Unknown" }))
    }
  }
  const service = makeOperators(
    { ...unavailable, ambient: Effect.succeed(query) },
    '"jobs"',
    '"payloads"',
    10
  )
  expect(error(await Effect.runPromiseExit(service.cancel(expected)))).toMatchObject({
    value: { commitKnowledge: "Unknown" }
  })
  expect(calls).toBe(1)
})
test("redrive uses copied bytes, no handler and one post-validation DB sample", async () => {
  const encoded = await Effect.runPromise(
    encodeJobPayload(definition.payload, { value: "safe" })
  )
  const calls: string[] = []
  const query: TransactionQuery = {
    query: (sql, values) =>
      Effect.sync(() => {
        calls.push(sql)
        if (sql.startsWith("SELECT j.*")) {
          return [
            {
              id: "source",
              original_source_job_id: null,
              source_job_id: null,
              redrive_kind: null,
              state: "Dead",
              lifecycle_version: 4,
              policy: Policy.defaultPolicy,
              available_at: 100,
              updated_at: 100,
              created_at: null,
              attempts_made: 3,
              stalled_count: 0,
              lease_token: null,
              lease_expires_at: null,
              completed_at: 100,
              last_failure_code: null,
              initial_available_at: null,
              queue: "billing",
              kind: "invoice",
              version: 1,
              operation: "old",
              operation_id: "source",
              slot: "old",
              format_version: 1,
              payload: encoded.payloadBytes,
              projection: encoded.semanticProjectionBytes
            }
          ]
        }
        if (sql.startsWith("SELECT floor")) {
          return [{ now: "200" }]
        }
        if (sql.startsWith('INSERT INTO "jobs"')) {
          expect(values?.slice(8, 11)).toEqual([200, 200, 200])
          return [{ id: values?.[0] }]
        }
        if (sql.startsWith('INSERT INTO "payloads"')) {
          expect(values?.[2]).toEqual(encoded.payloadBytes)
          return []
        }
        throw new Error("unexpected SQL")
      })
  }
  const service = makeOperators(
    { ...unavailable, ambient: Effect.succeed(query) },
    '"jobs"',
    '"payloads"',
    10
  )
  const result = await Effect.runPromise(
    service.redrive(definition, {
      expected,
      producer: { operation: "manual", operationId: "new", slot: "replacement" }
    })
  )
  expect(result).toMatchObject({ source: expected, inserted: true, dbNow: 200 })
  expect(result.jobId).not.toBe(expected.jobId)
  expect(calls).toHaveLength(4)
})
