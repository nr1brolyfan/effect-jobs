import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { Cause, Duration, Effect, Exit, Option, Result, Schema } from "effect"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import * as Tables from "../../../src/PostgreSqlSchema.js"
import { ready } from "../../../src/internal/postgresql/Readiness.js"
import { makeOperators } from "../../../src/internal/postgresql/Operators.js"
import { makeStore, makeCleanup } from "../../../src/internal/postgresql/Store.js"
import { snapshot, writeSnapshot } from "../../../src/internal/postgresql/Rows.js"
import { insertOrCompare } from "../../../src/internal/postgresql/Producer.js"
import { JobOperatorExpected } from "../../../src/JobOperators.js"
import type { JobOperatorsService } from "../../../src/JobOperators.js"
import { PostgreSqlInvalidHandle } from "../../../src/PostgreSqlTransaction.js"
import type {
  ApplicationAdapter,
  PostgreSqlError,
  TransactionQuery
} from "../../../src/PostgreSqlTransaction.js"
import * as Policy from "../../../src/JobPolicy.js"
import * as App from "../../qualification/d6-pg/ApplicationTransactions.js"
import * as Adapter from "../Adapter.js"
import { encodeJobPayload } from "../../../src/JobPayloadCodec.js"
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core"
import * as Payload from "../../../src/JobPayload.js"
import {
  Document,
  DocumentEncryption,
  DocumentKeys,
  EncryptedDocument,
  keys
} from "../../core/codec/EncryptedFixture.js"
import { makeJobTables } from "../../../src/PostgreSqlDrizzleSchema.js"

const configPath = process.env.OPERATORS_PG_CONFIG_FILE
const definition = {
  catalog: { queue: "billing", kind: "invoice", version: 1 },
  payload: Schema.Struct({ value: Schema.String })
}
const producer = (id = randomUUID()) => ({
  operation: "manual",
  operationId: id,
  slot: "replacement"
})
const failure = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none()

describe.skipIf(!configPath)(
  "operators real PostgreSQL (application-owned fixture adapter)",
  () => {
    let pool: Pool
    let source: App.Source
    let adapter: ApplicationAdapter
    let operators: JobOperatorsService<PostgreSqlError>
    let jobs: string
    let payloads: string
    const mapping = Tables.tables({ schema: "operators_fixture" })
    const run = <A, E>(body: (query: TransactionQuery) => Effect.Effect<A, E>) =>
      Effect.runPromise(
        adapter.withTransaction(() => Effect.flatMap(adapter.ambient!, body))
      )
    const query = async (sql: string, values: unknown[] = []) =>
      (await pool.query(sql, values)).rows
    const seed = async (
      state: "Pending" | "RetryScheduled" | "Dead" | "Isolated" = "Pending",
      exhausted = false,
      policy: Policy.JobPolicy = Policy.defaultPolicy
    ) => {
      const result = await run((q) =>
        Effect.gen(function* () {
          const encoded = yield* encodeJobPayload(definition.payload, { value: "valid" })
          return yield* insertOrCompare(q, jobs, payloads, {
            catalog: definition.catalog,
            producer: producer(),
            policy,
            encoded,
            availableAt: Date.now() + 60000
          })
        })
      )
      await query(
        `UPDATE ${jobs} SET state=$2,completed_at=CASE WHEN $2='Dead' THEN updated_at ELSE NULL END,attempts_made=$3 WHERE id=$1`,
        [result.jobId, state, exhausted ? 3 : 0]
      )
      return Schema.decodeSync(JobOperatorExpected)({
        jobId: result.jobId,
        state,
        lifecycleVersion: 0
      })
    }
    beforeAll(async () => {
      const config = JSON.parse(readFileSync(configPath!, "utf8"))
      pool = new Pool({
        ...config,
        max: 6,
        connectionTimeoutMillis: 500,
        statement_timeout: 3000,
        query_timeout: 4000
      })
      expect((await query("SHOW server_version"))[0].server_version).toMatch(/^16\.15/)
      source = App.source(pool)
      const fixture = Adapter.make(source)
      adapter = {
        ...fixture,
        ambient: Effect.flatMap(App.activeHandle, (handle) =>
          Option.isNone(handle)
            ? Effect.fail(new PostgreSqlInvalidHandle({ reason: "inactive-handle" }))
            : fixture.validate(handle.value)
        )
      }
      ;({ jobs, payloads } = Tables.relations(mapping))
      operators = makeOperators(adapter, jobs, payloads, 100)
      await query(`CREATE SCHEMA "operators_fixture"`)
      await query(Tables.migration(mapping))
      await query(
        `CREATE TABLE operators_fixture.receipts (id text PRIMARY KEY,job_id text NOT NULL REFERENCES ${jobs}(id), observed_at bigint NOT NULL, xid bigint NOT NULL)`
      )
    })
    afterAll(async () => {
      if (pool) {
        await query(`DROP SCHEMA IF EXISTS operators_fixture CASCADE`)
        await query(`DROP SCHEMA IF EXISTS operators_legacy CASCADE`)
        await query(`DROP SCHEMA IF EXISTS operators_drizzle CASCADE`)
        await pool.end()
      }
    })
    test("fresh schema ready and Cancelled SQL timestamp parity", async () => {
      await Effect.runPromise(ready(adapter, jobs, payloads))
      const expected = await seed()
      await expect(
        query(`UPDATE ${jobs} SET state='Cancelled' WHERE id=$1`, [expected.jobId])
      ).rejects.toThrow()
      const result = await run(() => operators.cancel(expected))
      expect(result.after.state).toBe("Cancelled")
      const row = (await query(`SELECT * FROM ${jobs} WHERE id=$1`, [expected.jobId]))[0]
      expect(row.cleanup_at).toBeNull()
      expect(row.completed_at).toBe(String(result.after.updatedAt))
    })
    test("cancel receipt composes on same xid and rollback undoes all writes", async () => {
      const expected = await seed("RetryScheduled")
      const result = await run((q) =>
        Effect.gen(function* () {
          const xid = (yield* q.query("SELECT txid_current()::text AS xid"))[0]!.xid
          const accepted = yield* operators.cancel(expected)
          yield* q.query(
            "INSERT INTO operators_fixture.receipts VALUES ($1,$2,$3,txid_current())",
            [randomUUID(), expected.jobId, accepted.after.updatedAt]
          )
          const receipt = (yield* q.query(
            "SELECT xid::text FROM operators_fixture.receipts WHERE job_id=$1",
            [expected.jobId]
          ))[0]!
          expect(receipt.xid).toBe(xid)
          return accepted
        })
      )
      expect(result.after.attemptsMade).toBe(0)
      const rollback = await seed()
      await expect(
        run((q) =>
          Effect.gen(function* () {
            yield* operators.cancel(rollback)
            yield* q.query(
              "INSERT INTO operators_fixture.receipts VALUES ('broken',NULL,1,1)"
            )
          })
        )
      ).rejects.toThrow()
      expect(
        (
          await query(`SELECT state,lifecycle_version FROM ${jobs} WHERE id=$1`, [
            rollback.jobId
          ])
        )[0]
      ).toEqual({ state: "Pending", lifecycle_version: "0" })
    })
    test("future retry accelerates exactly and due rows/stale guards are nonmutation", async () => {
      const expected = await seed("RetryScheduled")
      const before = (
        await query(`SELECT * FROM ${jobs} WHERE id=$1`, [expected.jobId])
      )[0]
      const result = await run(() => operators.retryNow(expected))
      expect(result.after.availableAt).toBe(result.after.updatedAt)
      expect(result.after.availableAt).toBeLessThan(Number(before.available_at))
      expect(result.after.attemptsMade).toBe(Number(before.attempts_made))
      expect(result.after.policy).toEqual(before.policy)
      const after = (
        await query(`SELECT * FROM ${jobs} WHERE id=$1`, [expected.jobId])
      )[0]
      await expect(run(() => operators.retryNow(expected))).rejects.toThrow()
      await expect(
        run(() => operators.retryNow({ ...expected, lifecycleVersion: 1 }))
      ).rejects.toThrow()
      expect(
        (await query(`SELECT * FROM ${jobs} WHERE id=$1`, [expected.jobId]))[0]
      ).toEqual(after)
    })
    test("redrive exhausted source copies exact artifacts/policy, fresh counters and unchanged source", async () => {
      const expected = await seed("Dead", true)
      const before = (
        await query(
          `SELECT j.*,p.payload,p.projection,p.format_version FROM ${jobs} j JOIN ${payloads} p ON p.job_id=j.id WHERE id=$1`,
          [expected.jobId]
        )
      )[0]
      const request = { expected, producer: producer() }
      const successor = await run(() => operators.redrive(definition, request))
      expect(successor.jobId).not.toBe(expected.jobId)
      const after = (
        await query(
          `SELECT j.*,p.payload,p.projection,p.format_version FROM ${jobs} j JOIN ${payloads} p ON p.job_id=j.id WHERE id=$1`,
          [expected.jobId]
        )
      )[0]
      expect(after).toEqual(before)
      const newRow = (
        await query(
          `SELECT j.*,p.payload,p.projection FROM ${jobs} j JOIN ${payloads} p ON p.job_id=j.id WHERE id=$1`,
          [successor.jobId]
        )
      )[0]
      expect(newRow).toMatchObject({
        state: "Pending",
        attempts_made: "0",
        stalled_count: "0",
        lifecycle_version: "0",
        policy: before.policy,
        payload: before.payload,
        projection: before.projection,
        completed_at: null,
        last_failure_code: null,
        available_at: String(successor.dbNow),
        initial_available_at: String(successor.dbNow)
      })
      const duplicate = await run(() => operators.redrive(definition, request))
      expect(duplicate.jobId).toBe(successor.jobId)
      expect(duplicate.inserted).toBe(false)
      const deliberate = await run(() =>
        operators.redrive(definition, { expected, producer: producer() })
      )
      expect(deliberate.jobId).not.toBe(successor.jobId)
    })
    test("valid Isolated redrives; corrupted, same producer, unsupported catalog reject without mutation", async () => {
      const expected = await seed("Isolated")
      await run(() => operators.redrive(definition, { expected, producer: producer() }))
      const row = (await query(`SELECT * FROM ${jobs} WHERE id=$1`, [expected.jobId]))[0]
      const original = {
        operation: row.operation,
        operationId: row.operation_id,
        slot: row.slot
      }
      const count = (await query(`SELECT count(*)::int AS n FROM ${jobs}`))[0].n
      await expect(
        run(() => operators.redrive(definition, { expected, producer: original }))
      ).rejects.toThrow()
      await expect(
        run(() =>
          operators.redrive(
            { ...definition, catalog: { ...definition.catalog, version: 2 } },
            { expected, producer: producer() }
          )
        )
      ).rejects.toThrow()
      await query(
        `UPDATE ${payloads} SET payload=convert_to('{"value":"tampered"}','UTF8') WHERE job_id=$1`,
        [expected.jobId]
      )
      await expect(
        run(() => operators.redrive(definition, { expected, producer: producer() }))
      ).rejects.toThrow()
      expect((await query(`SELECT count(*)::int AS n FROM ${jobs}`))[0].n).toBe(count)
      expect(
        (await query(`SELECT * FROM ${jobs} WHERE id=$1`, [expected.jobId]))[0]
      ).toEqual(row)
    })
    test("missing/foreign ambient fails before queries; invalid lookup and version reject", async () => {
      const expected = await seed()
      const sqlCount = source.counters.sql.length
      const result = await Effect.runPromiseExit(operators.cancel(expected))
      expect(failure(result)).toMatchObject({ value: { reason: "inactive-handle" } })
      expect(source.counters.sql.length).toBe(sqlCount)
      const other = App.source(pool)
      const foreign = await Effect.runPromiseExit(
        App.transaction(other, () => operators.cancel(expected))
      )
      expect(failure(foreign)).toMatchObject({ value: { reason: "foreign-source" } })
      await expect(
        run(() =>
          operators.cancel({
            ...expected,
            jobId: Schema.decodeSync(JobOperatorExpected.fields.jobId)("absent")
          })
        )
      ).rejects.toThrow()
      await expect(
        run(() => operators.cancel({ ...expected, lifecycleVersion: 1 }))
      ).rejects.toThrow()
    })
    test("encrypted redrive decodes with current keys, preserves ciphertext and samples time after decoder work", async () => {
      const ring = keys()
      const encoded = await Effect.runPromise(
        encodeJobPayload(EncryptedDocument, { recipient: "fixture", total: 12n }).pipe(
          Effect.provideService(DocumentKeys, ring)
        )
      )
      const result = await run((q) =>
        insertOrCompare(q, jobs, payloads, {
          catalog: definition.catalog,
          producer: producer(),
          policy: Policy.defaultPolicy,
          encoded
        })
      )
      await query(`UPDATE ${jobs} SET state='Isolated' WHERE id=$1`, [result.jobId])
      const expected = Schema.decodeSync(JobOperatorExpected)({
        jobId: result.jobId,
        state: "Isolated",
        lifecycleVersion: 0
      })
      let decoded = false
      const payload = Payload.encrypted({
        schema: Document,
        codec: {
          ...DocumentEncryption,
          open: (value) =>
            Effect.gen(function* () {
              yield* Effect.sleep("10 millis")
              const document = yield* DocumentEncryption.open(value)
              decoded = true
              return document
            })
        }
      })
      const sampled = makeOperators(
        {
          ...adapter,
          ambient: adapter.ambient!.pipe(
            Effect.map((q) => ({
              query: (text: string, values?: ReadonlyArray<unknown>) => {
                if (text.startsWith("SELECT floor")) {
                  expect(decoded).toBe(true)
                }
                return q.query(text, values)
              }
            }))
          )
        },
        jobs,
        payloads,
        100
      )
      const accepted = await run(() =>
        sampled
          .redrive({ ...definition, payload }, { expected, producer: producer() })
          .pipe(Effect.provideService(DocumentKeys, ring))
      )
      const artifact = (
        await query(`SELECT payload,projection FROM ${payloads} WHERE job_id=$1`, [
          accepted.jobId
        ])
      )[0]
      expect(new Uint8Array(artifact.payload)).toEqual(encoded.payloadBytes)
      expect(new Uint8Array(artifact.projection)).toEqual(encoded.semanticProjectionBytes)
      const count = (await query(`SELECT count(*)::int AS n FROM ${jobs}`))[0].n
      await expect(
        run(() =>
          operators
            .redrive(
              { ...definition, payload: EncryptedDocument },
              { expected, producer: producer() }
            )
            .pipe(Effect.provideService(DocumentKeys, { ...ring, encryption: {} }))
        )
      ).rejects.toThrow()
      expect((await query(`SELECT count(*)::int AS n FROM ${jobs}`))[0].n).toBe(count)
    })
    test.each([
      "format",
      "missing",
      "projection",
      "initial-time",
      "attempts",
      "lease-reserve"
    ])("redrive refuses invalid %s without repairing original", async (variant) => {
      const expected = await seed("Isolated")
      if (variant === "format") {
        await query(`UPDATE ${payloads} SET format_version=99 WHERE job_id=$1`, [
          expected.jobId
        ])
      }
      if (variant === "missing") {
        await query(`DELETE FROM ${payloads} WHERE job_id=$1`, [expected.jobId])
      }
      if (variant === "projection") {
        await query(
          `UPDATE ${payloads} SET projection=convert_to('{}','UTF8') WHERE job_id=$1`,
          [expected.jobId]
        )
      }
      if (variant === "initial-time") {
        await query(`UPDATE ${jobs} SET initial_available_at=-1 WHERE id=$1`, [
          expected.jobId
        ])
      }
      if (variant === "attempts") {
        await query(`UPDATE ${jobs} SET attempts_made=4 WHERE id=$1`, [expected.jobId])
      }
      if (variant === "lease-reserve") {
        await query(
          `UPDATE ${jobs} SET policy=jsonb_set(policy,'{leaseDurationMillis}','30001') WHERE id=$1`,
          [expected.jobId]
        )
      }
      const before = (
        await query(`SELECT * FROM ${jobs} WHERE id=$1`, [expected.jobId])
      )[0]
      const count = (await query(`SELECT count(*)::int AS n FROM ${jobs}`))[0].n
      await expect(
        run(() => operators.redrive(definition, { expected, producer: producer() }))
      ).rejects.toThrow()
      expect(
        (await query(`SELECT * FROM ${jobs} WHERE id=$1`, [expected.jobId]))[0]
      ).toEqual(before)
      expect((await query(`SELECT count(*)::int AS n FROM ${jobs}`))[0].n).toBe(count)
    })
    test("concurrent cancel has one winner and worker claims cannot reclaim Cancelled", async () => {
      const expected = await seed()
      const outcomes = await Promise.allSettled([
        run(() => operators.cancel(expected)),
        run(() => operators.cancel(expected))
      ])
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1)
      await query(`UPDATE ${jobs} SET available_at=1 WHERE id=$1`, [expected.jobId])
      const store = makeStore(adapter, jobs, payloads, 100)
      const claim = await Effect.runPromise(
        store.claim({
          queue: "billing",
          supportedCatalog: [definition.catalog],
          leaseToken: randomUUID()
        })
      )
      if (claim._tag === "Claimed") {
        expect(claim.claim.snapshot.jobId).not.toBe(expected.jobId)
      }
      expect(await Effect.runPromise(store.recoverExpired(100))).toBe(0)
      await Effect.runPromise(makeCleanup(adapter, jobs).cleanup(100))
      expect(
        (await query(`SELECT state FROM ${jobs} WHERE id=$1`, [expected.jobId]))[0].state
      ).toBe("Cancelled")
    })
    test("worker-held Active row makes waiting cancel fail after lock with no state mutation", async () => {
      const expected = await seed()
      const held = await pool.connect()
      await held.query("BEGIN")
      await held.query(`SELECT id FROM ${jobs} WHERE id=$1 FOR UPDATE`, [expected.jobId])
      const cancellation = run(() => operators.cancel(expected))
      await held.query(
        `UPDATE ${jobs} SET state='Active',lifecycle_version=1,lease_token=$2,lease_expires_at=updated_at+90000 WHERE id=$1`,
        [expected.jobId, randomUUID()]
      )
      await held.query("COMMIT")
      held.release()
      await expect(cancellation).rejects.toThrow()
      expect(
        (
          await query(`SELECT state,lifecycle_version FROM ${jobs} WHERE id=$1`, [
            expected.jobId
          ])
        )[0]
      ).toEqual({ state: "Active", lifecycle_version: "1" })
      await expect(
        run(() => operators.cancel({ ...expected, state: "Active", lifecycleVersion: 1 }))
      ).rejects.toThrow()
      // Restore only this fixture so recovery assertions elsewhere stay isolated.
      await query(
        `UPDATE ${jobs} SET state='Isolated',lease_token=NULL,lease_expires_at=NULL WHERE id=$1`,
        [expected.jobId]
      )
    })
    test("durable COMMIT response loss stays Unknown and exact receipt reconciles without replay", async () => {
      const expected = await seed()
      const outcome = await Effect.runPromiseExit(
        App.transaction(
          source,
          () =>
            Effect.gen(function* () {
              const result = yield* operators.cancel(expected)
              const q = yield* adapter.ambient!
              yield* q.query(
                "INSERT INTO operators_fixture.receipts VALUES ($1,$2,$3,txid_current())",
                ["unknown-receipt", expected.jobId, result.after.updatedAt]
              )
            }),
          "after-durable"
        )
      )
      expect(failure(outcome)).toMatchObject({ value: { commitKnowledge: "Unknown" } })
      expect(
        (
          await query(`SELECT state,lifecycle_version FROM ${jobs} WHERE id=$1`, [
            expected.jobId
          ])
        )[0]
      ).toEqual({ state: "Cancelled", lifecycle_version: "1" })
      expect(
        (
          await query(
            "SELECT job_id FROM operators_fixture.receipts WHERE id='unknown-receipt'"
          )
        )[0].job_id
      ).toBe(expected.jobId)
    })
    test("successor conflict poisons transaction and source stays intact", async () => {
      const first = await seed("Dead")
      const second = await seed("Dead")
      await query(
        `UPDATE ${payloads} SET payload=convert_to('{"value":"different"}','UTF8') WHERE job_id=$1`,
        [second.jobId]
      )
      const encoded = await Effect.runPromise(
        encodeJobPayload(definition.payload, { value: "different" })
      )
      await query(`UPDATE ${payloads} SET projection=$2 WHERE job_id=$1`, [
        second.jobId,
        encoded.semanticProjectionBytes
      ])
      const tuple = producer()
      await run(() => operators.redrive(definition, { expected: first, producer: tuple }))
      await expect(
        run((q) =>
          Effect.gen(function* () {
            yield* q.query(
              "INSERT INTO operators_fixture.receipts VALUES ('conflict-domain',$1,1,txid_current())",
              [second.jobId]
            )
            // Catching the typed integrity error must not permit committing partial domain writes.
            yield* operators
              .redrive(definition, { expected: second, producer: tuple })
              .pipe(Effect.catchTags({ JobIntegrityConflict: () => Effect.void }))
          })
        )
      ).rejects.toThrow()
      expect(
        await query(
          "SELECT id FROM operators_fixture.receipts WHERE id='conflict-domain'"
        )
      ).toEqual([])
      expect(
        (
          await query(`SELECT state,lifecycle_version FROM ${jobs} WHERE id=$1`, [
            second.jobId
          ])
        )[0]
      ).toEqual({ state: "Dead", lifecycle_version: "0" })
    })
    test.each(["Dead", "Isolated"] as const)(
      "corrected %s replaces missing bytes, preserves source and deduplicates concurrently",
      async (state) => {
        const expected = await seed(state, state === "Dead")
        await query(`DELETE FROM ${payloads} WHERE job_id=$1`, [expected.jobId])
        const before = (
          await query(`SELECT * FROM ${jobs} WHERE id=$1`, [expected.jobId])
        )[0]
        const request = { expected, producer: producer(), payload: { value: "fixed" } }
        const results = await Promise.all([
          run(() => operators.correctedRedrive(definition, request)),
          run(() => operators.correctedRedrive(definition, request))
        ])
        expect(results[0]!.jobId).toBe(results[1]!.jobId)
        expect(
          results.map((r) => r.inserted).sort((a, b) => Number(a) - Number(b))
        ).toEqual([false, true])
        const child = (
          await query(
            `SELECT j.*,p.payload FROM ${jobs} j JOIN ${payloads} p ON p.job_id=j.id WHERE id=$1`,
            [results[0]!.jobId]
          )
        )[0]
        expect(child).toMatchObject({
          state: "Pending",
          attempts_made: "0",
          stalled_count: "0",
          lifecycle_version: "0",
          policy: before.policy,
          original_source_job_id: expected.jobId,
          source_job_id: expected.jobId,
          redrive_kind: "CorrectedRedrive"
        })
        expect(child.payload.toString("utf8")).toBe('{"value":"fixed"}')
        expect(
          (await query(`SELECT * FROM ${jobs} WHERE id=$1`, [expected.jobId]))[0]
        ).toEqual(before)
        await expect(
          run(() => operators.redrive(definition, { expected, producer: producer() }))
        ).rejects.toThrow()
      }
    )
    test("source/kind lineage conflict poisons caught rejections and rolls back domain writes", async () => {
      const first = await seed("Dead")
      const second = await seed("Dead")
      const tuple = producer()
      await run(() => operators.redrive(definition, { expected: first, producer: tuple }))
      for (const operation of [
        () => operators.redrive(definition, { expected: second, producer: tuple }),
        () =>
          operators.correctedRedrive(definition, {
            expected: first,
            producer: tuple,
            payload: { value: "valid" }
          })
      ]) {
        await expect(
          run((q) =>
            Effect.gen(function* () {
              yield* q.query(
                "INSERT INTO operators_fixture.receipts VALUES ('lineage-conflict',$1,1,txid_current())",
                [first.jobId]
              )
              yield* operation().pipe(
                Effect.catchTags({
                  JobOperatorRejected: (error) => {
                    expect(error.reason).toBe("lineage-conflict")
                    return Effect.void
                  }
                })
              )
            })
          )
        ).rejects.toThrow()
        expect(
          await query(
            "SELECT id FROM operators_fixture.receipts WHERE id='lineage-conflict'"
          )
        ).toEqual([])
      }
    })
    test("corrected semantic conflict, rollback and unknown COMMIT retain exact evidence", async () => {
      const expected = await seed("Dead")
      const tuple = producer()
      await run(() =>
        operators.correctedRedrive(definition, {
          expected,
          producer: tuple,
          payload: { value: "first" }
        })
      )
      await expect(
        run(() =>
          operators.correctedRedrive(definition, {
            expected,
            producer: tuple,
            payload: { value: "different" }
          })
        )
      ).rejects.toThrow()
      const rollbackTuple = producer()
      await expect(
        run((q) =>
          Effect.gen(function* () {
            yield* operators.correctedRedrive(definition, {
              expected,
              producer: rollbackTuple,
              payload: { value: "rollback" }
            })
            yield* q.query(
              "INSERT INTO operators_fixture.receipts VALUES ('broken',NULL,1,1)"
            )
          })
        )
      ).rejects.toThrow()
      expect(
        await query(`SELECT id FROM ${jobs} WHERE operation_id=$1`, [
          rollbackTuple.operationId
        ])
      ).toEqual([])
      const lost = await Effect.runPromiseExit(
        App.transaction(
          source,
          () =>
            Effect.gen(function* () {
              const result = yield* operators.correctedRedrive(definition, {
                expected,
                producer: producer(),
                payload: { value: "committed" }
              })
              const q = yield* adapter.ambient!
              yield* q.query(
                "INSERT INTO operators_fixture.receipts VALUES ('corrected-unknown',$1,$2,txid_current())",
                [result.jobId, result.dbNow]
              )
            }),
          "after-durable"
        )
      )
      expect(failure(lost)).toMatchObject({ value: { commitKnowledge: "Unknown" } })
      const receipt = (
        await query(
          "SELECT job_id FROM operators_fixture.receipts WHERE id='corrected-unknown'"
        )
      )[0]
      expect(
        (await query(`SELECT redrive_kind FROM ${jobs} WHERE id=$1`, [receipt.job_id]))[0]
          .redrive_kind
      ).toBe("CorrectedRedrive")
    })
    test("retention nulls live source, preserves durable identity and never cascades to successor", async () => {
      const expected = await seed(
        "Dead",
        false,
        await Effect.runPromise(Policy.make({ deadRetention: Duration.millis(1) }))
      )
      const forever = await seed("Dead")
      // Age both sources without waiting. The cleanup hint alone must not override Forever.
      await query(`UPDATE ${jobs} SET completed_at=1,cleanup_at=2 WHERE id=ANY($1)`, [
        [expected.jobId, forever.jobId]
      ])
      const child = await run(() =>
        operators.correctedRedrive(definition, {
          expected,
          producer: producer(),
          payload: { value: "retained" }
        })
      )
      expect(await Effect.runPromise(makeCleanup(adapter, jobs).cleanup(100))).toBe(1)
      expect(await query(`SELECT id FROM ${jobs} WHERE id=$1`, [forever.jobId])).toEqual([
        { id: forever.jobId }
      ])
      expect(
        await query(`SELECT job_id FROM ${payloads} WHERE job_id=$1`, [forever.jobId])
      ).toEqual([{ job_id: forever.jobId }])
      expect(await query(`SELECT id FROM ${jobs} WHERE id=$1`, [expected.jobId])).toEqual(
        []
      )
      expect(
        await query(`SELECT job_id FROM ${payloads} WHERE job_id=$1`, [expected.jobId])
      ).toEqual([])
      expect(
        (
          await query(
            `SELECT original_source_job_id,source_job_id,redrive_kind FROM ${jobs} WHERE id=$1`,
            [child.jobId]
          )
        )[0]
      ).toEqual({
        original_source_job_id: expected.jobId,
        source_job_id: null,
        redrive_kind: "CorrectedRedrive"
      })
      expect(
        (
          await query(`SELECT payload FROM ${payloads} WHERE job_id=$1`, [child.jobId])
        )[0].payload.toString("utf8")
      ).toBe('{"value":"retained"}')
      for (const assignment of [
        "source_job_id=id",
        "original_source_job_id=id",
        "redrive_kind=NULL",
        "redrive_kind='Bogus'"
      ]) {
        await expect(
          query(`UPDATE ${jobs} SET ${assignment} WHERE id=$1`, [child.jobId])
        ).rejects.toThrow()
      }
    })
    test("mapped additive lineage migration preserves ordinary rows and rejects CASCADE readiness", async () => {
      const mapping = Tables.tables({
        schema: "operators_lineage",
        jobsTable: "mapped_jobs",
        payloadsTable: "mapped_payloads"
      })
      const rel = Tables.relations(mapping)
      await query('CREATE SCHEMA "operators_lineage"')
      try {
        await query(Tables.migration(mapping))
        await run((q) =>
          Effect.gen(function* () {
            const encoded = yield* encodeJobPayload(definition.payload, {
              value: "legacy"
            })
            yield* insertOrCompare(q, rel.jobs, rel.payloads, {
              catalog: definition.catalog,
              producer: producer(),
              policy: Policy.defaultPolicy,
              encoded
            })
          })
        )
        await query(
          `DROP INDEX "operators_lineage"."${Tables.indexPrefix(mapping)}_source"`
        )
        await query(
          `ALTER TABLE ${rel.jobs} DROP COLUMN original_source_job_id CASCADE, DROP COLUMN source_job_id CASCADE, DROP COLUMN redrive_kind CASCADE`
        )
        const before = await query(`SELECT * FROM ${rel.jobs}`)
        await expect(
          Effect.runPromise(ready(adapter, rel.jobs, rel.payloads))
        ).rejects.toThrow()
        await query(Tables.lineageMigration(mapping))
        await Effect.runPromise(ready(adapter, rel.jobs, rel.payloads))
        expect(await query(`SELECT * FROM ${rel.jobs}`)).toEqual(
          before.map((r) => ({
            ...r,
            original_source_job_id: null,
            source_job_id: null,
            redrive_kind: null
          }))
        )
        await query(
          `ALTER TABLE ${rel.jobs} DROP CONSTRAINT "${Tables.indexPrefix(mapping)}_source_fk", ADD FOREIGN KEY (source_job_id) REFERENCES ${rel.jobs}(id) ON DELETE CASCADE`
        )
        await expect(
          Effect.runPromise(ready(adapter, rel.jobs, rel.payloads))
        ).rejects.toThrow()
      } finally {
        await query('DROP SCHEMA "operators_lineage" CASCADE')
      }
    })
    test("concurrent different-source tuple reuse has one lineage winner", async () => {
      const first = await seed("Dead")
      const second = await seed("Dead")
      const tuple = producer()
      const outcomes = await Promise.allSettled(
        [first, second].map((expected) =>
          run(() =>
            operators.correctedRedrive(definition, {
              expected,
              producer: tuple,
              payload: { value: "same" }
            })
          )
        )
      )
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1)
      expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1)
      const rows = await query(
        `SELECT original_source_job_id,source_job_id,redrive_kind FROM ${jobs} WHERE operation_id=$1`,
        [tuple.operationId]
      )
      expect(rows).toHaveLength(1)
      expect([first.jobId, second.jobId]).toContain(rows[0].original_source_job_id)
      expect(rows[0].source_job_id).toBe(rows[0].original_source_job_id)
      expect(rows[0].redrive_kind).toBe("CorrectedRedrive")
    })
    test("source deletion winning the lock race refuses repair without a successor", async () => {
      const expected = await seed("Dead")
      const tuple = producer()
      const held = await pool.connect()
      try {
        await held.query("BEGIN")
        await held.query(`SELECT id FROM ${jobs} WHERE id=$1 FOR UPDATE`, [
          expected.jobId
        ])
        const outcome = run(() =>
          operators.correctedRedrive(definition, {
            expected,
            producer: tuple,
            payload: { value: "fixed" }
          })
        )
        const assertion = expect(outcome).rejects.toThrow()
        await held.query(`DELETE FROM ${jobs} WHERE id=$1`, [expected.jobId])
        await held.query("COMMIT")
        await assertion
        expect(
          await query(`SELECT id FROM ${jobs} WHERE operation_id=$1`, [tuple.operationId])
        ).toEqual([])
      } finally {
        await held.query("ROLLBACK")
        held.release()
      }
    })
    test("corrected rejection never repairs invalid metadata or accepts invalid replacement", async () => {
      const expected = await seed("Isolated")
      const invalid = producer()
      await expect(
        run(() =>
          operators.correctedRedrive(definition, {
            expected,
            producer: invalid,
            payload: { value: 12 } as never
          })
        )
      ).rejects.toThrow()
      expect(
        await query(`SELECT id FROM ${jobs} WHERE operation_id=$1`, [invalid.operationId])
      ).toEqual([])
      await query(`UPDATE ${jobs} SET initial_available_at=-1 WHERE id=$1`, [
        expected.jobId
      ])
      await expect(
        run(() =>
          operators.correctedRedrive(definition, {
            expected,
            producer: invalid,
            payload: { value: "fixed" }
          })
        )
      ).rejects.toThrow()
      expect(
        await query(`SELECT id FROM ${jobs} WHERE operation_id=$1`, [invalid.operationId])
      ).toEqual([])
    })
    test("Cancelled writeSnapshot never derives dead retention", async () => {
      const expected = await seed()
      await run((q) =>
        Effect.gen(function* () {
          const row = (yield* q.query(`SELECT * FROM ${jobs} WHERE id=$1`, [
            expected.jobId
          ]))[0]!
          const before = Result.getOrThrow(snapshot(row))
          yield* writeSnapshot(q, jobs, {
            ...before,
            state: "Cancelled",
            completedAt: before.updatedAt,
            policy: { ...before.policy, deadRetention: { _tag: "Duration", millis: 1 } }
          })
        })
      )
      expect(
        (await query(`SELECT cleanup_at FROM ${jobs} WHERE id=$1`, [expected.jobId]))[0]
          .cleanup_at
      ).toBeNull()
    })
    test("populated six-state migration rejects old readiness, preserves data and unrelated CHECKs", async () => {
      const legacy = Tables.tables({ schema: "operators_legacy" })
      const rel = Tables.relations(legacy)
      await query("CREATE SCHEMA operators_legacy")
      await query(Tables.migration(legacy).replaceAll(",'Cancelled'", ""))
      await query(
        `ALTER TABLE ${rel.jobs} ADD CONSTRAINT app_guard CHECK (operation <> 'blocked')`
      )
      await run((q) =>
        Effect.gen(function* () {
          const encoded = yield* encodeJobPayload(definition.payload, { value: "legacy" })
          yield* insertOrCompare(q, rel.jobs, rel.payloads, {
            catalog: definition.catalog,
            producer: producer(),
            policy: Policy.defaultPolicy,
            encoded
          })
        })
      )
      const before = await query(`SELECT * FROM ${rel.jobs}`)
      await expect(
        Effect.runPromise(ready(adapter, rel.jobs, rel.payloads))
      ).rejects.toThrow()
      await query(Tables.operatorMigration(legacy))
      await Effect.runPromise(ready(adapter, rel.jobs, rel.payloads))
      expect(await query(`SELECT * FROM ${rel.jobs}`)).toEqual(before)
      expect(
        (
          await query(
            "SELECT count(*)::int AS n FROM pg_constraint WHERE conname='app_guard'"
          )
        )[0].n
      ).toBe(1)
      await query(Tables.operatorMigration(legacy))
      await query(
        `ALTER TABLE ${rel.jobs} DROP CONSTRAINT jobs_state_check; ALTER TABLE ${rel.jobs} ADD CONSTRAINT unusual_state CHECK (state <> 'Bogus')`
      )
      await expect(query(Tables.operatorMigration(legacy))).rejects.toThrow()
      expect(
        (
          await query(
            "SELECT count(*)::int AS n FROM pg_constraint WHERE conname='unusual_state'"
          )
        )[0].n
      ).toBe(1)
    })
    test("Drizzle-named CHECKs have exact SQL parity and migrate without touching other constraints", async () => {
      const mapping = Tables.tables({ schema: "operators_drizzle" })
      const rel = Tables.relations(mapping)
      await query("CREATE SCHEMA operators_drizzle")
      await query(Tables.migration(mapping))
      const config = getTableConfig(makeJobTables(mapping).jobs)
      const dialect = new PgDialect()
      await query(
        `ALTER TABLE ${rel.jobs} DROP CONSTRAINT jobs_state_check, DROP CONSTRAINT jobs_check2`
      )
      for (const check of config.checks.filter(
        (c) => c.name.endsWith("_state") || c.name.endsWith("_completed")
      )) {
        const text = dialect
          .sqlToQuery(check.value)
          .sql.replaceAll('"operators_drizzle"."jobs".', "")
        await query(
          `ALTER TABLE ${rel.jobs} ADD CONSTRAINT "${check.name}" CHECK (${text})`
        )
      }
      await Effect.runPromise(ready(adapter, rel.jobs, rel.payloads))
      await query(Tables.operatorMigration(mapping))
      await Effect.runPromise(ready(adapter, rel.jobs, rel.payloads))
    })
  }
)
