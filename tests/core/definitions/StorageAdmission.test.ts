/** Statement-port controls; real SQL admission is covered by Jobs.test.ts. */
import { Effect, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { JobId } from "../../../src/JobId.js"
import { EnqueueResult } from "../../../src/JobContract.js"
import type { PreparedJob } from "../../../src/JobContract.js"
import { defaultPolicy, maximumMillis } from "../../../src/JobPolicy.js"
import { encodeJobPayload } from "../../../src/JobPayloadCodec.js"
import { insertOrCompareAt } from "../../../src/internal/postgresql/Producer.js"
import type { TransactionQuery } from "../../../src/PostgreSqlTransaction.js"

const id = Schema.decodeSync(JobId)("admission-fixture")
const prepare = (reserve: number) =>
  Effect.gen(function* () {
    const encoded = yield* encodeJobPayload(Schema.String, "same")
    return {
      catalog: { queue: "billing", kind: "billing.receipt", version: 1 },
      producer: { operation: "billing.issue", operationId: "one", slot: "receipt" },
      policy: {
        ...defaultPolicy,
        leaseDurationMillis: defaultPolicy.attemptTimeoutMillis + reserve
      },
      encoded
    } satisfies PreparedJob
  })

describe("storage-owned production admission", () => {
  it("rejects a lease that would overflow the bounded storage clock before persistence", async () => {
    let parents = 0
    const query: TransactionQuery = {
      query: (sql, values = []) =>
        Effect.sync(() => {
          if (sql.startsWith('INSERT INTO "jobs"')) {
            expect(values[14]).toBe(false)
            if (values[14] === true) {
              parents++
              return [{ id }]
            }
          }
          return []
        })
    }
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const value = yield* prepare(100)
        const oversized = {
          ...value,
          policy: { ...value.policy, leaseDurationMillis: maximumMillis }
        }
        return yield* insertOrCompareAt(
          query,
          '"jobs"',
          '"payloads"',
          oversized,
          1000,
          100
        )
      }).pipe(Effect.result)
    )
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "JobPolicyIncompatible" }
    })
    expect(parents).toBe(0)
  })
  it.each([99, 100, 101])(
    "gates a new policy with response reserve %s before parent or artifact persistence",
    async (reserve) => {
      const statements: string[] = []
      let parents = 0
      let artifacts = 0
      const query: TransactionQuery = {
        query: (sql, values = []) =>
          Effect.sync(() => {
            statements.push(sql)
            if (sql.startsWith('INSERT INTO "jobs"')) {
              expect(sql).toContain("WHERE $15::boolean")
              expect(values[14]).toBe(reserve >= 100)
              if (values[14] === true) {
                parents++
                return [{ id }]
              }
              return []
            }
            if (sql.startsWith('INSERT INTO "payloads"')) {
              artifacts++
              return []
            }
            if (sql.startsWith("SELECT j.id")) {
              return []
            }
            throw new Error("Unexpected admission statement")
          })
      }
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const prepared = yield* prepare(reserve)
          return yield* insertOrCompareAt(
            query,
            '"jobs"',
            '"payloads"',
            prepared,
            1000,
            100,
            id
          )
        }).pipe(Effect.result)
      )
      if (reserve < 100) {
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "JobPolicyIncompatible" }
        })
        expect(parents).toBe(0)
        expect(artifacts).toBe(0)
      } else {
        expect(result).toMatchObject({
          _tag: "Success",
          success: EnqueueResult.Inserted({ jobId: id })
        })
        expect(parents).toBe(1)
        expect(artifacts).toBe(1)
      }
      expect(statements).not.toContain("SELECT 1/0")
    }
  )

  it("ignores incompatible new policy for a matching retained job but still rejects semantic conflict", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const prepared = yield* prepare(1)
        let conflict = false
        const statements: string[] = []
        const query: TransactionQuery = {
          query: (sql, values = []) =>
            Effect.sync(() => {
              statements.push(sql)
              if (sql.startsWith("INSERT INTO")) {
                expect(values[14]).toBe(false)
                return []
              }
              if (sql === "SELECT 1/0") {
                return []
              }
              return [
                {
                  id,
                  queue: "original-queue",
                  kind: prepared.catalog.kind,
                  version: 1,
                  format_version: 1,
                  projection: conflict
                    ? new Uint8Array([0])
                    : prepared.encoded.semanticProjectionBytes,
                  original_source_job_id: null,
                  source_job_id: null,
                  redrive_kind: null
                }
              ]
            })
        }
        expect(
          yield* insertOrCompareAt(query, '"jobs"', '"payloads"', prepared, 1000, 100)
        ).toEqual(EnqueueResult.AlreadyPresent({ jobId: id }))
        expect(
          statements.some(
            (sql) => sql.startsWith('INSERT INTO "payloads"') || sql.startsWith("UPDATE")
          )
        ).toBe(false)
        conflict = true
        const rejected = yield* insertOrCompareAt(
          query,
          '"jobs"',
          '"payloads"',
          prepared,
          1000,
          100
        ).pipe(Effect.result)
        expect(rejected).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "JobIntegrityConflict" }
        })
        expect(statements.at(-1)).toBe("SELECT 1/0")
      })
    )
  })
})
