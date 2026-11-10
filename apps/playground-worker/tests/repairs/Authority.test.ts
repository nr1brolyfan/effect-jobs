// @effect-diagnostics unstableApiUsage:off
import { describe, expect, it } from "vitest"
import { Effect, Exit, Semaphore, Stream } from "effect"
import * as SqlClient from "effect/sql/SqlClient"
import type { Connection } from "effect/sql/SqlConnection"
import { SqlError, ConnectionError } from "effect/sql/SqlError"
import * as Reactivity from "effect/reactivity/Reactivity"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as Adapter from "../../src/persistence/authority/PostgreSqlRepairTransactions.js"
import * as Mode from "../../src/persistence/authority/PrivateMode.js"
import * as Source from "../../src/persistence/commands/RepairSource.js"
import * as Persistence from "../../src/persistence/commands/RepairPersistence.js"
import * as Fixture from "./Fixtures.js"

// Actual Effect SQL statement/transaction runtime with a finite synthetic driver.
// This qualifies protocol/control behavior, NOT PostgreSQL SQL or locking.
const fixture = Effect.gen(function* () {
  const gate = yield* Semaphore.make(1)
  const queries: string[] = []
  let admissions = new Map<string, Record<string, unknown>>()
  let receipts = new Map<string, Record<string, unknown>>()
  let stagedAdmissions = new Map(admissions),
    stagedReceipts = new Map(receipts)
  let now = 900,
    demo = false,
    loseCommit = false,
    expireAtSource = false
  const key = (params: readonly unknown[]) => JSON.stringify(params.slice(0, 4))
  const execute: Connection["execute"] = (text, params) =>
    Effect.suspend(() => {
      queries.push(text)
      if (text === "BEGIN") {
        stagedAdmissions = new Map(admissions)
        stagedReceipts = new Map(receipts)
        return Effect.succeed([])
      }
      if (text === "COMMIT") {
        admissions = new Map(stagedAdmissions)
        receipts = new Map(stagedReceipts)
        if (loseCommit && receipts.size > 0) {
          loseCommit = false
          return Effect.fail(
            new SqlError({
              reason: new ConnectionError({ cause: "synthetic lost response" })
            })
          )
        }
        return Effect.succeed([])
      }
      if (text === "ROLLBACK") {
        return Effect.succeed([])
      }
      if (text.includes('SELECT * FROM "repair_test"."sandboxes"')) {
        return Effect.succeed([
          {
            sandbox_id: Fixture.ref.sandboxId,
            generation: 1,
            expires_at: 100000,
            demo_owned: demo
          }
        ])
      }
      if (text.includes("clock_timestamp()")) {
        return Effect.succeed([{ now }])
      }
      if (
        text.includes(
          'SELECT command_digest,actor_category FROM "repair_test"."repair_admission"'
        )
      ) {
        return Effect.succeed(
          stagedAdmissions.has(key(params)) ? [stagedAdmissions.get(key(params))!] : []
        )
      }
      if (
        text.includes(
          'SELECT receipt,command_digest FROM "repair_test"."repair_receipts"'
        )
      ) {
        return Effect.succeed(
          stagedReceipts.has(key(params)) ? [stagedReceipts.get(key(params))!] : []
        )
      }
      if (text.includes("SELECT (SELECT count(*)")) {
        return Effect.succeed([{ n: stagedAdmissions.size }])
      }
      if (text.includes('INSERT INTO "repair_test"."repair_admission"')) {
        stagedAdmissions.set(key(params), {
          command_digest: params[4],
          actor_category: params[5]
        })
        return Effect.succeed([])
      }
      if (text.includes('INSERT INTO "repair_test"."repair_receipts"')) {
        stagedReceipts.set(key(params), {
          command_digest: params[4],
          receipt: JSON.parse(String(params[5]))
        })
        return Effect.succeed([])
      }
      if (
        text.includes('SELECT root_job_id FROM "repair_test"."job_repair_members"') ||
        text.includes('SELECT problem FROM "repair_test"."job_problems"')
      ) {
        return Effect.succeed([])
      }
      if (text.includes("SELECT j.*,p.format_version")) {
        if (expireAtSource) {
          now = 100001
        }
        return Effect.succeed([Fixture.sourceRow])
      }
      return Effect.die(new Error(`Unexpected fixture statement: ${text}`))
    })
  const connection: Connection = {
    execute,
    executeUnprepared: execute,
    executeRaw: (text, params) => execute(text, params, undefined),
    executeStream: () => Stream.die("Unexpected stream"),
    executeValues: () => Effect.die("Unexpected values"),
    executeValuesUnprepared: () => Effect.die("Unexpected values")
  }
  const acquirer = Effect.acquireRelease(gate.take(1).pipe(Effect.as(connection)), () =>
    gate.release(1)
  )
  const client = yield* SqlClient.make({
    acquirer,
    compiler: PgClient.makeCompiler(),
    spanAttributes: []
  }).pipe(Effect.provide(Reactivity.layer))
  const adapter = yield* Adapter.make("repair_test").pipe(
    Effect.provideService(SqlClient.SqlClient, client),
    Effect.provideService(Mode.LocalPrivate, true)
  )
  const access = {
    sandbox: {
      ref: Fixture.ref,
      expiresAt: 100000,
      capabilities: {
        runScenario: true,
        resetSandbox: true,
        retryJob: true,
        cancelJob: true,
        redriveJob: true
      }
    }
  }
  const digest = yield* Source.commandDigest(Fixture.command)
  const result = {
    _tag: "Rejected" as const,
    sandbox: Fixture.ref,
    requestId: Fixture.command.requestId,
    jobId: Fixture.sourceId,
    reason: "not-eligible" as const
  }
  const executeRejected = (command = Fixture.command, identity = digest) =>
    adapter.owned(access, command, identity, (tx) =>
      Effect.gen(function* () {
        if (tx.stored) {
          return tx.stored.result
        }
        if (tx.admission === "Conflict") {
          return { ...result, reason: "request-conflict" as const }
        }
        if (tx.admission === "Unresolved") {
          return {
            _tag: "OutcomeUnknown" as const,
            sandbox: command.sandbox,
            requestId: command.requestId
          }
        }
        yield* tx.save(result)
        return result
      })
    )
  return {
    adapter,
    access,
    digest,
    result,
    client,
    queries,
    executeRejected,
    corruptReceipt: (result: unknown) => {
      for (const row of receipts.values()) {
        row.receipt = { commandDigest: digest, result }
      }
    },
    counts: () => ({ admissions: admissions.size, receipts: receipts.size }),
    loseCommit: () => {
      loseCommit = true
    },
    demo: () => {
      demo = true
    },
    expire: () => {
      expireAtSource = true
    }
  }
})

describe("native admission/receipt authority protocol with synthetic driver", () => {
  it("rejects a receipt of the wrong operation and mismatched source identity", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* fixture
        yield* db.executeRejected()
        db.corruptReceipt({
          _tag: "Committed",
          sandbox: Fixture.ref,
          requestId: Fixture.command.requestId,
          observedAt: 1000,
          problem: {
            ...Fixture.problem,
            state: "Resolved",
            resolution: {
              kind: "ManualClose",
              reason: "Synthetic closure",
              observedAt: 1000,
              successorJobId: Fixture.successorId
            }
          }
        })
        expect(
          Exit.isFailure(
            yield* Effect.exit(db.adapter.lookup(db.access, Fixture.command, "Repair"))
          )
        ).toBe(true)
        const fresh = yield* fixture
        const failed = yield* Effect.exit(
          fresh.adapter.owned(fresh.access, Fixture.command, fresh.digest, (tx) =>
            tx.save({ ...fresh.result, jobId: Fixture.successorId })
          )
        )
        expect(Exit.isFailure(failed)).toBe(true)
        expect(fresh.counts()).toEqual({ admissions: 1, receipts: 0 })
      })
    )
  })
  it("serializes identical concurrent requests, preserves exact receipt and rejects conflicting reuse", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* fixture
        const results = yield* Effect.all([db.executeRejected(), db.executeRejected()], {
          concurrency: 2
        })
        expect(results).toEqual([db.result, db.result])
        expect(db.counts()).toEqual({ admissions: 1, receipts: 1 })
        const conflict = yield* db.executeRejected(
          { ...Fixture.command, reason: "Another reason" },
          yield* Source.commandDigest({ ...Fixture.command, reason: "Another reason" })
        )
        expect(conflict).toMatchObject({ _tag: "Rejected", reason: "request-conflict" })
        expect(db.counts()).toEqual({ admissions: 1, receipts: 1 })
      })
    )
  })
  it("lost durable COMMIT acknowledgement is resolved by exact read-only receipt lookup", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* fixture
        db.loseCommit()
        expect(
          (yield* db
            .executeRejected()
            .pipe(Effect.catchCause(Persistence.recover(Fixture.command))))._tag
        ).toBe("OutcomeUnknown")
        const before = db.queries.length
        const receipt = yield* db.adapter.lookup(
          db.access,
          { sandbox: Fixture.ref, requestId: Fixture.command.requestId },
          "Repair"
        )
        expect(receipt?.result).toEqual(db.result)
        expect(
          db.queries.slice(before).some((q) => /^\s*(INSERT|UPDATE|DELETE)/u.test(q))
        ).toBe(false)
        expect(yield* db.executeRejected()).toEqual(db.result)
        expect(db.counts()).toEqual({ admissions: 1, receipts: 1 })
      })
    )
  })
  it("persisted demo ownership defeats forged capability hints", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* fixture
        db.demo()
        expect(Exit.isFailure(yield* Effect.exit(db.executeRejected()))).toBe(true)
        expect(db.counts()).toEqual({ admissions: 0, receipts: 0 })
      })
    )
  })
  it("expiry after source lock aborts receipt writes, preserves admission and refuses later replay", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* fixture
        db.expire()
        const exit = yield* Effect.exit(
          db.adapter.owned(db.access, Fixture.command, db.digest, (tx) =>
            Effect.gen(function* () {
              yield* tx.source()
              yield* tx.save(db.result)
            })
          )
        )
        expect(Exit.isFailure(exit)).toBe(true)
        expect(db.counts()).toEqual({ admissions: 1, receipts: 0 })
        expect(db.queries.some((q) => q === "ROLLBACK")).toBe(true)
      })
    )
  })
  it("rejects already active exact-client context before admitting or issuing nested controls", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* fixture
        const exit = yield* Effect.exit(db.client.withTransaction(db.executeRejected()))
        expect(Exit.isFailure(exit)).toBe(true)
        expect(db.counts()).toEqual({ admissions: 0, receipts: 0 })
        expect(db.queries.filter((q) => q === "BEGIN")).toHaveLength(1)
        expect(db.queries.some((q) => q.startsWith("SAVEPOINT"))).toBe(false)
      })
    )
  })
})
