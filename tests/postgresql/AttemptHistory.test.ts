import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { Duration, Effect, Schema } from "effect"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "vitest"
import { define } from "../../src/FailureCode.js"
import * as Job from "../../src/Job.js"
import * as Lifecycle from "../../src/JobLifecycle.js"
import { defaultPolicy } from "../../src/JobPolicy.js"
import * as Producer from "../../src/JobProducer.js"
import * as Queue from "../../src/JobQueue.js"
import * as Jobs from "../../src/postgresql/PostgreSqlJobs.js"
import * as Tables from "../../src/postgresql/PostgreSqlSchema.js"
import {
  PostgreSqlApplication,
  PostgreSqlFailure
} from "../../src/postgresql/PostgreSqlTransaction.js"
import type { ApplicationAdapter } from "../../src/postgresql/PostgreSqlTransaction.js"
import { readQualificationResource } from "../qualification/Resource.mjs"
import * as App from "../qualification/d6-pg/ApplicationTransactions.js"
import { Pool } from "../qualification/d6-pg/PgDriver.js"
import * as Adapter from "./Adapter.js"

type PreHistoryJobs = Pick<
  Jobs.Service,
  "withTransaction" | "store" | "cleanup" | "ready"
>

const resource = process.env.D6_RESOURCE_DIRECTORY
const baselineModule = process.env.D6_ATTEMPT_HISTORY_BASELINE_MODULE
const mapping = Tables.tables({
  schema: "attempt_fixture",
  jobsTable: "tasks",
  payloadsTable: "artifacts"
})
const { jobs: jobsRelation, payloads } = Tables.relations(mapping)
const history = `"${mapping.schema}"."${Tables.attemptHistoryTableName(mapping)}"`
const expiryIndex = `"${mapping.schema}"."${Tables.indexPrefix(mapping)}_attempt_exp"`
const baseline = readFileSync(
  new URL("./fixtures/BeforeAttemptHistory.sql", import.meta.url),
  "utf8"
)

const queue = Effect.runSync(Queue.make("history"))
const definition = Effect.runSync(Job.make({ name: "fixture", payload: Schema.String }))
const producer = Effect.runSync(
  Producer.make("fixture").pipe(Producer.withSlot("job", definition, { queue }))
)
const code = define({ temporary: "fixture_retry" }).temporary
const complete = Lifecycle.JobFinalizations.Complete()
const retry = Lifecycle.JobFinalizations.Retry({ code })
const all = { mode: "all", ttlMillis: 3_600_000 } as const

describe.skipIf(resource === undefined)("attempt history on real PostgreSQL", () => {
  let pool: Pool
  let adapter: ApplicationAdapter
  let off: Jobs.Service
  let preHistory: PreHistoryJobs

  const make = (attemptHistory?: Jobs.AttemptHistoryCapture, app = adapter) =>
    Effect.runPromise(
      Jobs.make({
        ...mapping,
        operationResponseBudget: Duration.millis(100),
        ...(attemptHistory === undefined ? {} : { attemptHistory })
      }).pipe(Effect.provideService(PostgreSqlApplication, app))
    )
  const migrate = () => pool.query(Tables.attemptHistoryMigration(mapping))
  const enqueue = (operationId: string, jobs: PreHistoryJobs = off) =>
    Effect.runPromise(
      jobs.withTransaction(() =>
        producer.enqueue({
          slot: "job",
          operationId,
          payload: "fixture"
        })
      )
    )
  const claim = async (jobs: PreHistoryJobs = off) => {
    const result = await Effect.runPromise(
      jobs.store.claim({
        queue: queue.name,
        supportedCatalog: [
          { queue: queue.name, name: definition.name, version: definition.version }
        ],
        leaseToken: Schema.decodeSync(Lifecycle.LeaseToken)(randomUUID())
      })
    )
    if (result._tag !== "Claimed") {
      throw new Error(`Expected a claim, got ${result._tag}`)
    }
    return result.claim
  }
  const row = async (jobId: string) =>
    (await pool.query(`SELECT * FROM ${jobsRelation} WHERE id=$1`, [jobId])).rows[0]
  const setDue = (jobId: string) =>
    pool.query(`UPDATE ${jobsRelation} SET available_at=1 WHERE id=$1`, [jobId])
  const expireLease = (jobId: string) =>
    pool.query(`UPDATE ${jobsRelation} SET lease_expires_at=1 WHERE id=$1`, [jobId])
  const expireHistory = (jobId: string, version: number) =>
    pool.query(
      `UPDATE ${history} SET expires_at=1 WHERE job_id=$1 AND lifecycle_version=$2`,
      [jobId, version]
    )

  beforeAll(() => {
    const ownership = readQualificationResource(resource!)
    const env = Object.fromEntries(
      readFileSync(join(resource!, "postgres.env"), "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("="))
    )
    pool = new Pool({
      host: "127.0.0.1",
      port: Number(ownership.ports["5432/tcp"][0].HostPort),
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      database: env.POSTGRES_DB,
      connectionTimeoutMillis: 2000,
      statement_timeout: 5000,
      max: 4
    })
    adapter = Adapter.make(App.source(pool))
  })
  beforeEach(async () => {
    await pool.query(`CREATE SCHEMA "${mapping.schema}"`)
    await pool.query(baseline)
    off = await make()
    if (baselineModule === undefined) {
      preHistory = await make({ mode: "off" })
    } else {
      // Optional local qualification of the exact pre-feature build against this fixture.
      const previous: Pick<typeof Jobs, "make"> = await import(
        /* @vite-ignore */ pathToFileURL(baselineModule).href
      )
      preHistory = await Effect.runPromise(
        previous
          .make({ ...mapping, operationResponseBudget: Duration.millis(100) })
          .pipe(Effect.provideService(PostgreSqlApplication, adapter))
      )
      expect(preHistory).not.toHaveProperty("attemptHistory")
    }
  })
  afterEach(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${mapping.schema}" CASCADE`)
  })
  afterAll(async () => {
    await pool?.end()
  })

  test("populated additive migration preserves rows, deduplication, retry and fencing", async () => {
    await Effect.runPromise(off.ready)
    const on = await make(all)
    await expect(Effect.runPromise(on.ready)).rejects.toMatchObject({
      readiness: {
        reason: "attempt-history-migration-required",
        check: "attempt-history"
      }
    })
    const scheduled = await enqueue("scheduled", preHistory)
    const previous = await claim(preHistory)
    const retryRequest = {
      ownership: previous.ownership,
      before: previous.snapshot,
      finalization: retry
    }
    await Effect.runPromise(preHistory.store.finalize(retryRequest))
    const active = await enqueue("active", preHistory)
    const held = await claim(preHistory)
    const pending = await enqueue("pending", preHistory)
    const ids = [scheduled.jobId, active.jobId, pending.jobId]
    const before = await Promise.all(ids.map(row))
    expect(before.map((value) => value.state)).toEqual([
      "RetryScheduled",
      "Active",
      "Pending"
    ])
    const payloadsBefore = (await pool.query(`SELECT * FROM ${payloads} ORDER BY job_id`))
      .rows
    await migrate()
    await Effect.runPromise(preHistory.ready)
    await Effect.runPromise(off.ready)
    await Effect.runPromise(on.ready)
    expect(await Promise.all(ids.map(row))).toEqual(before)
    expect((await pool.query(`SELECT * FROM ${payloads} ORDER BY job_id`)).rows).toEqual(
      payloadsBefore
    )
    expect(await enqueue("scheduled", on)).toEqual({
      _tag: "AlreadyPresent",
      jobId: scheduled.jobId
    })
    expect(await enqueue("active", on)).toEqual({
      _tag: "AlreadyPresent",
      jobId: active.jobId
    })
    expect(await enqueue("pending", on)).toEqual({
      _tag: "AlreadyPresent",
      jobId: pending.jobId
    })
    expect(
      await Effect.runPromise(on.store.reconcileClaim(held.ownership.leaseToken))
    ).toMatchObject({ _tag: "Owned", claim: held })
    expect(
      await Effect.runPromise(on.store.reconcileFinalization(retryRequest))
    ).toMatchObject({ _tag: "Applied" })
    expect(
      await Effect.runPromise(
        on.attemptHistory.read({ jobId: scheduled.jobId, limit: 10 })
      )
    ).toEqual({ entries: [], nextCursor: null })
    await Effect.runPromise(
      on.store.finalize({
        ownership: held.ownership,
        before: held.snapshot,
        finalization: complete
      })
    )
    expect(
      await Effect.runPromise(on.attemptHistory.read({ jobId: active.jobId, limit: 10 }))
    ).toMatchObject({
      entries: [
        {
          kind: "Finalization",
          state: "Completed",
          lifecycleVersion: held.snapshot.lifecycleVersion + 1,
          finalizedAttempt: 1
        }
      ]
    })
    // A writer running with the old storage behavior keeps working after migration.
    const oldClaim = await claim(preHistory)
    expect(oldClaim.ownership.jobId).toBe(pending.jobId)
    await Effect.runPromise(
      preHistory.store.finalize({
        ownership: oldClaim.ownership,
        before: oldClaim.snapshot,
        finalization: complete
      })
    )
    expect(
      await Effect.runPromise(on.attemptHistory.read({ jobId: pending.jobId, limit: 10 }))
    ).toEqual({ entries: [], nextCursor: null })
    await pool.query(`DROP INDEX ${expiryIndex}`)
    await expect(Effect.runPromise(on.ready)).rejects.toMatchObject({
      readiness: { reason: "attempt-history-migration-required" }
    })
    await Effect.runPromise(off.ready)
  })

  test.each(["DROP IDENTITY", "SET GENERATED BY DEFAULT"])(
    "rejects ALWAYS identity and records the explicit recovery version after %s",
    async (restoreIdentity) => {
      await migrate()
      await pool.query(
        `ALTER TABLE ${history} ALTER COLUMN lifecycle_version ADD GENERATED ALWAYS AS IDENTITY (START WITH 1000)`
      )
      const captureAll = await make(all)
      const captureProblems = await make({ ...all, mode: "problems" })
      const captureOff = await make({ mode: "off" })
      const job = await enqueue("identity-recovery", captureOff)
      const claimed = await claim(captureOff)
      expect(claimed.ownership.jobId).toBe(job.jobId)
      await expireLease(job.jobId)
      expect((await row(job.jobId)).state).toBe("Active")

      for (const jobs of [captureAll, captureProblems]) {
        await expect(Effect.runPromise(jobs.ready)).rejects.toMatchObject({
          _tag: "PostgreSqlFailure",
          commitKnowledge: "NotCommitted",
          readiness: {
            reason: "attempt-history-migration-required",
            check: "attempt-history"
          }
        })
      }
      await Effect.runPromise(captureOff.ready)

      await pool.query(
        `ALTER TABLE ${history} ALTER COLUMN lifecycle_version ${restoreIdentity}`
      )
      await Effect.runPromise(captureAll.ready)
      await Effect.runPromise(captureProblems.ready)
      expect(
        await Effect.runPromise(captureAll.store.recoverExpired(queue.name, 1))
      ).toBe(1)
      const recovered = await row(job.jobId)
      const expectedVersion = claimed.snapshot.lifecycleVersion + 1
      expect(recovered.state).toBe("Pending")
      expect(Number(recovered.lifecycle_version)).toBe(expectedVersion)
      expect(
        await Effect.runPromise(
          captureAll.attemptHistory.read({ jobId: job.jobId, limit: 10 })
        )
      ).toEqual({
        entries: [
          {
            jobId: job.jobId,
            lifecycleVersion: expectedVersion,
            occurredAt: Number(recovered.updated_at),
            kind: "LeaseRecovery",
            state: "Pending",
            stalledCount: 1,
            failureCode: null
          }
        ],
        nextCursor: null
      })
    }
  )

  test("validates modes and captures resulting states, retry eligibility and recovery counts", async () => {
    for (const setting of [
      { mode: "all" },
      { mode: "unknown", ttlMillis: 1 },
      { mode: "all", ttlMillis: 0 },
      { mode: "all", ttlMillis: -1 },
      { mode: "all", ttlMillis: Infinity },
      { mode: "all", ttlMillis: 1.5 },
      { mode: "all", ttlMillis: Number.MAX_SAFE_INTEGER + 1 },
      { mode: "off", ttlMillis: 1 }
    ]) {
      await expect(make(setting as Jobs.AttemptHistoryCapture)).rejects.toMatchObject({
        _tag: "PostgreSqlConfigurationError",
        field: "attemptHistory"
      })
    }
    await migrate()
    const problems = await make({ mode: "problems", ttlMillis: 3_600_000 })
    const job = await enqueue("problem")
    const first = await claim(problems)
    await Effect.runPromise(
      problems.store.finalize({
        ownership: first.ownership,
        before: first.snapshot,
        finalization: retry
      })
    )
    const after = await row(job.jobId)
    expect(Number(after.available_at) - Number(after.updated_at)).toBe(
      defaultPolicy.retrySchedule.delayMillis
    )
    expect(
      await Effect.runPromise(
        problems.attemptHistory.read({ jobId: job.jobId, limit: 10 })
      )
    ).toEqual({
      entries: [
        {
          jobId: job.jobId,
          lifecycleVersion: Number(after.lifecycle_version),
          occurredAt: Number(after.updated_at),
          kind: "Finalization",
          state: "RetryScheduled",
          finalizedAttempt: 1,
          failureCode: code,
          retryAt: Number(after.available_at)
        }
      ],
      nextCursor: null
    })
    await setDue(job.jobId)
    const second = await claim(problems)
    await Effect.runPromise(
      problems.store.finalize({
        ownership: second.ownership,
        before: second.snapshot,
        finalization: Lifecycle.JobFinalizations.Retry({ code, retryBefore: 1 })
      })
    )
    const done = await enqueue("success")
    const completed = await claim(problems)
    expect(completed.ownership.jobId).toBe(done.jobId)
    await Effect.runPromise(
      problems.store.finalize({
        ownership: completed.ownership,
        before: completed.snapshot,
        finalization: complete
      })
    )
    expect(
      (
        await Effect.runPromise(
          problems.attemptHistory.read({ jobId: done.jobId, limit: 10 })
        )
      ).entries
    ).toEqual([])
    expect(
      (
        await Effect.runPromise(
          problems.attemptHistory.read({ jobId: job.jobId, limit: 10 })
        )
      ).entries[0]
    ).toMatchObject({
      kind: "Finalization",
      state: "Dead",
      finalizedAttempt: 2,
      retryAt: null
    })
    const isolated = await enqueue("isolate")
    const malformed = await claim(problems)
    await Effect.runPromise(
      problems.store.finalize({
        ownership: malformed.ownership,
        before: malformed.snapshot,
        finalization: Lifecycle.JobFinalizations.Isolate({ code })
      })
    )
    expect(
      (
        await Effect.runPromise(
          problems.attemptHistory.read({ jobId: isolated.jobId, limit: 10 })
        )
      ).entries[0]
    ).toMatchObject({
      kind: "Finalization",
      state: "Isolated",
      finalizedAttempt: 1
    })

    const stalled = await enqueue("stalled")
    for (const count of [1, 2]) {
      const lease = await claim(problems)
      await expireLease(stalled.jobId)
      expect(await Effect.runPromise(problems.store.recoverExpired(queue.name, 1))).toBe(
        1
      )
      const recovered = await row(stalled.jobId)
      expect(Number(recovered.attempts_made)).toBe(0)
      const event = (
        await Effect.runPromise(
          problems.attemptHistory.read({ jobId: stalled.jobId, limit: 1 })
        )
      ).entries[0]
      expect(event).toEqual({
        jobId: stalled.jobId,
        lifecycleVersion: lease.snapshot.lifecycleVersion + 1,
        occurredAt: Number(recovered.updated_at),
        kind: "LeaseRecovery",
        state: count === 1 ? "Pending" : "Dead",
        stalledCount: count,
        failureCode: count === 1 ? null : "stall_limit_exceeded"
      })
    }
    const corrupt = await enqueue("corrupt")
    await claim(problems)
    await pool.query(
      `UPDATE ${jobsRelation} SET lease_expires_at=1,policy='{}' WHERE id=$1`,
      [corrupt.jobId]
    )
    expect(await Effect.runPromise(problems.store.recoverExpired(queue.name, 1))).toBe(1)
    expect((await row(corrupt.jobId)).state).toBe("Isolated")
    expect(
      (
        await Effect.runPromise(
          problems.attemptHistory.read({ jobId: corrupt.jobId, limit: 10 })
        )
      ).entries
    ).toEqual([])
  })

  test("rolls back both writes on history insert failure and never duplicates after lost acknowledgement", async () => {
    await migrate()
    const jobs = await make(all)
    const job = await enqueue("fault")
    const owned = await claim(jobs)
    const initial = await row(job.jobId)
    const finalization = {
      ownership: owned.ownership,
      before: owned.snapshot,
      finalization: retry
    }
    await pool.query(
      `ALTER TABLE ${history} ADD CONSTRAINT reject_insert CHECK (false) NOT VALID`
    )
    await expect(
      Effect.runPromise(jobs.store.finalize(finalization))
    ).rejects.toMatchObject({ commitKnowledge: "NotCommitted" })
    expect(await row(job.jobId)).toEqual(initial)
    expect(
      (await Effect.runPromise(jobs.attemptHistory.read({ jobId: job.jobId, limit: 10 })))
        .entries
    ).toEqual([])
    await pool.query(`ALTER TABLE ${history} DROP CONSTRAINT reject_insert`)

    const lost = await make(all, {
      ...adapter,
      ownedTransaction: (body) =>
        adapter
          .ownedTransaction(body)
          .pipe(
            Effect.andThen(
              Effect.fail(new PostgreSqlFailure({ commitKnowledge: "Unknown" }))
            )
          )
    })
    expect(await Effect.runPromise(lost.store.finalize(finalization))).toEqual({
      _tag: "Unknown"
    })
    expect(
      await Effect.runPromise(jobs.store.reconcileFinalization(finalization))
    ).toMatchObject({ _tag: "Applied" })
    await expect(
      Effect.runPromise(jobs.store.finalize(finalization))
    ).rejects.toMatchObject({ _tag: "JobOwnershipLost" })
    expect(
      (await Effect.runPromise(jobs.attemptHistory.read({ jobId: job.jobId, limit: 10 })))
        .entries
    ).toHaveLength(1)

    await setDue(job.jobId)
    await claim(jobs)
    await expireLease(job.jobId)
    const expired = await row(job.jobId)
    await pool.query(
      `ALTER TABLE ${history} ADD CONSTRAINT reject_insert CHECK (false) NOT VALID`
    )
    await expect(
      Effect.runPromise(jobs.store.recoverExpired(queue.name, 1))
    ).rejects.toMatchObject({ commitKnowledge: "NotCommitted" })
    expect(await row(job.jobId)).toEqual(expired)
    await pool.query(`ALTER TABLE ${history} DROP CONSTRAINT reject_insert`)
    await expect(
      Effect.runPromise(lost.store.recoverExpired(queue.name, 1))
    ).rejects.toMatchObject({ commitKnowledge: "Unknown" })
    expect(await Effect.runPromise(jobs.store.recoverExpired(queue.name, 1))).toBe(0)
    expect(
      (
        await Effect.runPromise(jobs.attemptHistory.read({ jobId: job.jobId, limit: 10 }))
      ).entries.map((event) => event.kind)
    ).toEqual(["LeaseRecovery", "Finalization"])
  })

  test("keyset paging, write-time TTL, bounded cleanup with capture off and parent cascade", async () => {
    await migrate()
    const jobs = await make(all)
    const longer = await make({ ...all, ttlMillis: all.ttlMillis * 2 })
    const job = await enqueue("timeline")
    for (const command of [retry, retry, complete]) {
      const writer = command === complete ? longer : jobs
      const owned = await claim(writer)
      await Effect.runPromise(
        writer.store.finalize({
          ownership: owned.ownership,
          before: owned.snapshot,
          finalization: command
        })
      )
      if (command === retry) {
        await setDue(job.jobId)
      }
    }
    const physical = (
      await pool.query(`SELECT lifecycle_version::int AS version,
      (expires_at - occurred_at)::int AS ttl FROM ${history} ORDER BY lifecycle_version`)
    ).rows
    expect(physical).toEqual([
      { version: 2, ttl: all.ttlMillis },
      { version: 4, ttl: all.ttlMillis },
      { version: 6, ttl: all.ttlMillis * 2 }
    ])
    const read = (before?: Jobs.AttemptHistoryCursor) =>
      Effect.runPromise(
        off.attemptHistory.read({
          jobId: job.jobId,
          limit: 1,
          ...(before === undefined ? {} : { before })
        })
      )
    const first = await read()
    expect(first.entries.map((event) => event.lifecycleVersion)).toEqual([6])
    expect(first.nextCursor).not.toBeNull()
    const other = await enqueue("other")
    await expect(
      Effect.runPromise(
        off.attemptHistory.read({
          jobId: other.jobId,
          limit: 1,
          before: first.nextCursor!
        })
      )
    ).rejects.toMatchObject({ reason: "invalid-input" })
    await expireHistory(job.jobId, 4)
    const last = await read(first.nextCursor!)
    expect(last.entries.map((event) => event.lifecycleVersion)).toEqual([2])
    expect(last.nextCursor).toBeNull()
    await expireHistory(job.jobId, 2)
    expect(await read(first.nextCursor!)).toEqual({ entries: [], nextCursor: null })
    expect(await Effect.runPromise(off.attemptHistory.cleanup(1))).toBe(1)
    expect(await Effect.runPromise(off.attemptHistory.cleanup(1))).toBe(1)
    expect(await Effect.runPromise(off.attemptHistory.cleanup(1))).toBe(0)
    expect(await enqueue("timeline")).toEqual({
      _tag: "AlreadyPresent",
      jobId: job.jobId
    })
    expect(
      (await pool.query(`SELECT job_id FROM ${payloads} WHERE job_id=$1`, [job.jobId]))
        .rowCount
    ).toBe(1)
    expect((await read()).entries).toHaveLength(1)
    // Advance parent retention in the fixture and invoke regular default/off cleanup.
    await pool.query(
      `UPDATE ${jobsRelation} SET completed_at=1,cleanup_at=1 WHERE id=$1`,
      [job.jobId]
    )
    expect(await Effect.runPromise(preHistory.cleanup.cleanup(1))).toBe(1)
    expect(await read()).toEqual({ entries: [], nextCursor: null })
    expect(
      (await pool.query(`SELECT job_id FROM ${payloads} WHERE job_id=$1`, [job.jobId]))
        .rowCount
    ).toBe(0)
    expect(
      (await pool.query(`SELECT COUNT(*)::int AS count FROM ${history}`)).rows[0]
    ).toEqual({ count: 0 })
    expect((await enqueue("timeline")).jobId).not.toBe(job.jobId)
  })
})
