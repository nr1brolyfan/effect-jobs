import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Effect, Exit } from "effect"
import { createFixture } from "./Fixture.mjs"
import { producer, catalog, queue, makeJobs } from "./Scenario.mjs"

describe.sequential("real PostgreSQL worker process crash", () => {
  /** @type {Awaited<ReturnType<typeof createFixture>>} */
  let fixture
  /** @type {Awaited<ReturnType<typeof makeJobs>>} */
  let composition
  beforeAll(async () => {
    fixture = await createFixture()
    composition = await makeJobs(fixture.connection)
    console.log(`Worker crash test evidence: ${fixture.directory}`)
  })
  afterAll(async () => {
    try {
      await composition?.runtime.dispose()
    } finally {
      await fixture?.close()
    }
  })
  const run = (effect) => composition.runtime.runPromise(effect)
  const enqueue = (id) =>
    run(
      composition.jobs.withTransaction((tx) =>
        producer.enqueueInTransaction(tx, {
          operationId: id,
          slot: "delivery",
          payload: { consequenceId: id }
        })
      )
    )
  const row = async (id) =>
    (await fixture.pool.query("SELECT * FROM crash_fixture.jobs WHERE id=$1", [id]))
      .rows[0]
  const provider = async (id) =>
    (
      await fixture.pool.query(
        "SELECT * FROM crash_provider.effects WHERE idempotency_key=$1",
        [id]
      )
    ).rows
  const message = async (child, type) => {
    await expect
      .poll(() => child.messages.find((value) => value.type === type), {
        timeout: 8000,
        interval: 25
      })
      .toBeDefined()
    expect(child.messages.some((value) => value.type === "failed")).toBe(false)
    return child.messages.find((value) => value.type === type)
  }

  it("control: a normal worker executes the effect and confirms completion once", async () => {
    const inserted = await enqueue("control")
    const child = fixture.startWorker()
    try {
      await message(child, "effect-committed")
      await message(child, "drained")
      expect(await child.closed).toEqual({ code: 0, signal: null })
      const stored = await row(inserted.jobId)
      expect(stored.state).toBe("Completed")
      expect(Number(stored.attempts_made)).toBe(1)
      expect(Number(stored.stalled_count)).toBe(0)
      expect(await provider("control")).toEqual([
        { idempotency_key: "control", requests: 1 }
      ])
    } finally {
      await child.kill()
    }
  })

  it("SIGKILL after external commit: recovery re-invokes safely and fences the old owner", async () => {
    const inserted = await enqueue("crash")
    const artifacts = (
      await fixture.pool.query(
        "SELECT * FROM crash_fixture.job_payloads WHERE job_id=$1",
        [inserted.jobId]
      )
    ).rows[0]
    const first = fixture.startWorker(true)
    let oldClaim
    let active
    try {
      oldClaim = await message(first, "claimed")
      await message(first, "effect-committed")
      active = await row(inserted.jobId)
      expect(active.state).toBe("Active")
      expect(Number(active.attempts_made)).toBe(0)
      expect(active.lease_token).toBe(oldClaim.ownership.leaseToken)
      expect(await provider("crash")).toEqual([{ idempotency_key: "crash", requests: 1 }])
      // Actual process death, not Effect interruption or a simulated store response.
      await first.kill()
      expect(await first.closed).toEqual({ code: null, signal: "SIGKILL" })
    } finally {
      await first.kill()
    }

    // Use DB time as the oracle. A slow environment must fail rather than silently
    // skip the pre-expiry negative control.
    const remaining = (
      await fixture.pool.query(
        `SELECT lease_expires_at-floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS millis
      FROM crash_fixture.jobs WHERE id=$1`,
        [inserted.jobId]
      )
    ).rows[0]
    expect(Number(remaining.millis)).toBeGreaterThan(1000)
    expect(await run(composition.jobs.store.recoverExpired(queue.name, 1))).toBe(0)
    expect(
      await run(
        composition.jobs.store.claim({
          queue: queue.name,
          supportedCatalog: [catalog],
          leaseToken: crypto.randomUUID()
        })
      )
    ).toEqual({ _tag: "Empty" })
    expect(await row(inserted.jobId)).toEqual(active)
    expect(await provider("crash")).toEqual([{ idempotency_key: "crash", requests: 1 }])

    await expect
      .poll(
        async () =>
          (
            await fixture.pool.query(
              `SELECT lease_expires_at <= floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS expired
      FROM crash_fixture.jobs WHERE id=$1`,
              [inserted.jobId]
            )
          ).rows[0].expired,
        { timeout: 15000, interval: 50 }
      )
      .toBe(true)
    expect(await run(composition.jobs.store.recoverExpired(queue.name, 1))).toBe(1)
    const recovered = await row(inserted.jobId)
    expect(recovered.state).toBe("Pending")
    expect(recovered.lease_token).toBeNull()
    expect(Number(recovered.stalled_count)).toBe(1)
    expect(Number(recovered.attempts_made)).toBe(0)

    const second = fixture.startWorker(true)
    try {
      const newClaim = await message(second, "claimed")
      await message(second, "effect-committed")
      expect(newClaim.ownership.leaseToken).not.toBe(oldClaim.ownership.leaseToken)
      expect(newClaim.ownership.lifecycleVersion).toBeGreaterThan(
        oldClaim.ownership.lifecycleVersion
      )
      expect(await provider("crash")).toEqual([{ idempotency_key: "crash", requests: 2 }])
      const newActive = await row(inserted.jobId)
      expect(newActive.state).toBe("Active")
      expect(newActive.lease_token).toBe(newClaim.ownership.leaseToken)

      // Negative control: authentic old capability/snapshot, now stale. It must
      // neither complete nor release the replacement owner's job.
      const stale = await run(
        composition.jobs.store
          .finalize({
            ownership: oldClaim.ownership,
            before: oldClaim.snapshot,
            finalization: { _tag: "Complete" }
          })
          .pipe(Effect.exit)
      )
      expect(Exit.isFailure(stale)).toBe(true)
      expect(stale.cause.reasons[0].error._tag).toBe("JobOwnershipLost")
      const staleRelease = await run(
        composition.jobs.store
          .release(oldClaim.ownership, "BeforeExecution")
          .pipe(Effect.exit)
      )
      expect(Exit.isFailure(staleRelease)).toBe(true)
      expect(staleRelease.cause.reasons[0].error._tag).toBe("JobOwnershipLost")
      expect(await row(inserted.jobId)).toEqual(newActive)

      second.process.send("resume")
      await message(second, "drained")
      expect(await second.closed).toEqual({ code: 0, signal: null })
      const completed = await row(inserted.jobId)
      expect(completed.state).toBe("Completed")
      expect(Number(completed.stalled_count)).toBe(1)
      // Finalized attempts, not all handler invocations: the killed attempt did not finalize.
      expect(Number(completed.attempts_made)).toBe(1)
      expect(completed.lease_token).toBeNull()
      expect(completed.policy).toEqual(active.policy)
      expect(
        (
          await fixture.pool.query(
            "SELECT * FROM crash_fixture.job_payloads WHERE job_id=$1",
            [inserted.jobId]
          )
        ).rows[0]
      ).toEqual(artifacts)
      expect(await provider("crash")).toEqual([{ idempotency_key: "crash", requests: 2 }])
    } finally {
      await second.kill()
    }
  })
})
