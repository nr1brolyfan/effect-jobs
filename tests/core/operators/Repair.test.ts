import { Cause, Effect, Exit, Schema } from "effect"
import { expect, test } from "vitest"
import { makeOperators } from "../../../src/internal/postgresql/Operators.js"
import {
  insertOrCompareAt,
  insertOrCompare
} from "../../../src/internal/postgresql/Producer.js"
import { JobOperatorExpected } from "../../../src/JobOperators.js"
import { encodeJobPayload } from "../../../src/JobPayloadCodec.js"
import { PostgreSqlInvalidHandle } from "../../../src/PostgreSqlTransaction.js"
import type {
  ApplicationAdapter,
  TransactionQuery
} from "../../../src/PostgreSqlTransaction.js"
import { defaultPolicy } from "../../../src/JobPolicy.js"
import { DocumentKeys, EncryptedDocument, keys } from "../codec/EncryptedFixture.js"

const expected = Schema.decodeSync(JobOperatorExpected)({
  jobId: "source",
  state: "Dead",
  lifecycleVersion: 4
})
const definition = {
  catalog: { queue: "billing", kind: "invoice", version: 1 },
  payload: Schema.Struct({ value: Schema.String })
}
const producer = { operation: "repair", operationId: "new", slot: "replacement" }
const row = () => ({
  id: "source",
  state: "Dead",
  lifecycle_version: 4,
  policy: defaultPolicy,
  available_at: 100,
  updated_at: 100,
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
  original_source_job_id: null,
  source_job_id: null,
  redrive_kind: null
})
const unavailable: ApplicationAdapter = {
  validate: () => Effect.die("unexpected validate"),
  withTransaction: () => Effect.die("unexpected transaction"),
  ownedTransaction: () => Effect.die("unexpected owned transaction")
}
const failure = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : undefined
const fixture = (source: Record<string, unknown> = row()) => {
  const calls: Array<{ sql: string; values: ReadonlyArray<unknown> | undefined }> = []
  const query: TransactionQuery = {
    query: (sql, values) =>
      Effect.sync(() => {
        calls.push({ sql, values })
        if (sql.startsWith("SELECT *") || sql.startsWith("SELECT j.*")) {
          return [source]
        }
        if (sql.startsWith("SELECT floor")) {
          return [{ now: "200" }]
        }
        if (sql.startsWith('INSERT INTO "jobs"')) {
          return [{ id: values![0] }]
        }
        if (sql.startsWith('INSERT INTO "payloads"')) {
          return []
        }
        throw new Error("unexpected SQL")
      })
  }
  return {
    calls,
    service: makeOperators(
      { ...unavailable, ambient: Effect.succeed(query) },
      '"jobs"',
      '"payloads"',
      10
    )
  }
}

test.each(["unqualified-handle", "foreign-source", "inactive-handle"] as const)(
  "corrected redrive checks %s before preparing protected payload",
  async (reason) => {
    const service = makeOperators(
      { ...unavailable, ambient: Effect.fail(new PostgreSqlInvalidHandle({ reason })) },
      '"jobs"',
      '"payloads"',
      10
    )
    // Supply keys while checking the transaction error wins before codec work.
    const program = service
      .correctedRedrive(
        { ...definition, payload: EncryptedDocument },
        { expected, producer, payload: { recipient: "fixture", total: 12n } }
      )
      .pipe(Effect.provideService(DocumentKeys, keys()))
    expect(failure(await Effect.runPromiseExit(program))).toMatchObject({
      value: { _tag: "PostgreSqlInvalidHandle", reason }
    })
  }
)

test.each(["Dead", "Isolated"] as const)(
  "replacement repairs absent old payload on %s without reading or updating it",
  async (state) => {
    const source = { ...row(), state, completed_at: state === "Dead" ? 100 : null }
    const before = structuredClone(source)
    const { calls, service } = fixture(source)
    const result = await Effect.runPromise(
      service.correctedRedrive(definition, {
        expected: { ...expected, state },
        producer,
        payload: { value: "fixed" }
      })
    )
    expect(source).toEqual(before)
    expect(result).toMatchObject({
      inserted: true,
      dbNow: 200,
      lineage: {
        originalSourceJobId: "source",
        sourceJobId: "source",
        kind: "CorrectedRedrive"
      }
    })
    expect(calls[0]!.sql).not.toContain("JOIN")
    const values = calls.find((c) => c.sql.startsWith('INSERT INTO "jobs"'))!.values!
    expect(values.slice(7)).toEqual([
      JSON.stringify(defaultPolicy),
      200,
      200,
      200,
      "source",
      "source",
      "CorrectedRedrive"
    ])
    expect(new TextDecoder().decode(calls.at(-1)!.values![2] as Uint8Array)).toBe(
      '{"value":"fixed"}'
    )
    expect(result.jobId).not.toBe(expected.jobId)
  }
)

test.each([
  { attempts_made: 4 },
  { lifecycle_version: -1 },
  { queue: "BAD" },
  { operation: "BAD" },
  { initial_available_at: -1 },
  { lease_token: "owned" },
  { policy: { ...defaultPolicy, leaseDurationMillis: 30001 } },
  { original_source_job_id: "other", source_job_id: "wrong", redrive_kind: "Redrive" },
  { original_source_job_id: "source", source_job_id: "source", redrive_kind: "Redrive" },
  { original_source_job_id: "other", redrive_kind: null }
])("invalid source metadata cannot be repaired: %j", async (change) => {
  const { calls, service } = fixture({ ...row(), ...change })
  expect(
    failure(
      await Effect.runPromiseExit(
        service.correctedRedrive(definition, {
          expected,
          producer,
          payload: { value: "fixed" }
        })
      )
    )
  ).toMatchObject({ value: { reason: "invalid-artifact" } })
  expect(calls.every((c) => c.sql.startsWith("SELECT"))).toBe(true)
  expect(calls.some((c) => c.sql.startsWith("SELECT floor"))).toBe(false)
})

test("replacement enforces schema, canonical bounds, catalog and original producer without insertion", async () => {
  for (const [def, request] of [
    [definition, { expected, producer, payload: { value: 12 } }],
    [definition, { expected, producer, payload: { value: "ok", excess: true } }],
    [definition, { expected, producer, payload: { value: "x".repeat(65537) } }],
    [
      { ...definition, catalog: { ...definition.catalog, version: 2 } },
      { expected, producer, payload: { value: "ok" } }
    ],
    [
      definition,
      {
        expected,
        producer: { operation: "old", operationId: "source", slot: "old" },
        payload: { value: "ok" }
      }
    ]
  ] as const) {
    const { calls, service } = fixture()
    const exit = await Effect.runPromiseExit(
      service.correctedRedrive(def, request as never)
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(calls.some((c) => c.sql.startsWith("INSERT"))).toBe(false)
  }
})

test("protected replacement encodes and decodes with explicit application services", async () => {
  const { calls, service } = fixture()
  const ring = keys()
  await Effect.runPromise(
    service
      .correctedRedrive(
        { ...definition, payload: EncryptedDocument },
        { expected, producer, payload: { recipient: "fixture", total: 12n } }
      )
      .pipe(Effect.provideService(DocumentKeys, ring))
  )
  expect(calls).toHaveLength(4)
  expect(new TextDecoder().decode(calls.at(-1)!.values![2] as Uint8Array)).not.toContain(
    '"recipient":"fixture"'
  )
})

test.each(["source", "kind", "absent", "inconsistent", "semantic"])(
  "duplicate %s conflict poisons the same transaction",
  async (variant) => {
    const encoded = await Effect.runPromise(
      encodeJobPayload(definition.payload, { value: "fixed" })
    )
    const calls: string[] = []
    const query: TransactionQuery = {
      query: (sql) =>
        Effect.sync(() => {
          calls.push(sql)
          if (sql.startsWith("INSERT")) {
            return []
          }
          if (sql === "SELECT 1/0") {
            return []
          }
          return [
            {
              id: "child",
              ...definition.catalog,
              format_version: 1,
              projection:
                variant === "semantic"
                  ? new Uint8Array([0])
                  : encoded.semanticProjectionBytes,
              original_source_job_id:
                variant === "absent"
                  ? null
                  : variant === "source"
                    ? "different"
                    : "source",
              source_job_id:
                variant === "absent"
                  ? null
                  : variant === "inconsistent"
                    ? "wrong"
                    : variant === "source"
                      ? "different"
                      : "source",
              redrive_kind:
                variant === "absent"
                  ? null
                  : variant === "kind"
                    ? "Redrive"
                    : "CorrectedRedrive"
            }
          ]
        })
    }
    // Real SQL poisoning is qualified separately by the actual PG fixture.
    const exit = await Effect.runPromiseExit(
      insertOrCompareAt(
        query,
        '"jobs"',
        '"payloads"',
        { catalog: definition.catalog, producer, policy: defaultPolicy, encoded },
        200,
        undefined,
        {
          originalSourceJobId: expected.jobId,
          sourceJobId: expected.jobId,
          kind: "CorrectedRedrive"
        }
      )
    )
    expect(failure(exit)).toMatchObject({
      value:
        variant === "semantic"
          ? { _tag: "JobIntegrityConflict" }
          : { reason: "lineage-conflict" }
    })
    expect(calls.at(-1)).toBe("SELECT 1/0")
  }
)

test("exact lineage duplicate accepts deleted live reference without reassignment; ordinary enqueue cannot claim it", async () => {
  const encoded = await Effect.runPromise(
    encodeJobPayload(definition.payload, { value: "fixed" })
  )
  const calls: string[] = []
  const query: TransactionQuery = {
    query: (sql) =>
      Effect.sync(() => {
        calls.push(sql)
        if (sql.startsWith("INSERT") || sql === "SELECT 1/0") {
          return []
        }
        if (sql.startsWith("SELECT floor")) {
          return [{ now: "200" }]
        }
        return [
          {
            id: "child",
            ...definition.catalog,
            format_version: 1,
            projection: encoded.semanticProjectionBytes,
            original_source_job_id: "source",
            source_job_id: null,
            redrive_kind: "CorrectedRedrive"
          }
        ]
      })
  }
  const prepared = {
    catalog: definition.catalog,
    producer,
    policy: defaultPolicy,
    encoded
  }
  expect(
    await Effect.runPromise(
      insertOrCompareAt(query, '"jobs"', '"payloads"', prepared, 200, undefined, {
        originalSourceJobId: expected.jobId,
        sourceJobId: expected.jobId,
        kind: "CorrectedRedrive"
      })
    )
  ).toMatchObject({ _tag: "AlreadyPresent", jobId: "child" })
  expect(calls.some((sql) => sql.startsWith("UPDATE"))).toBe(false)
  expect(
    failure(
      await Effect.runPromiseExit(
        insertOrCompare(query, '"jobs"', '"payloads"', prepared)
      )
    )
  ).toMatchObject({ value: { _tag: "JobIntegrityConflict" } })
})
