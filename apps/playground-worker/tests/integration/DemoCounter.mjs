// Original v4 -> v5 reproduction, with a correctness oracle and committed readback.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { Pool } from "pg"
import { Effect } from "effect"

const { migrations, prepare, tick, batch, maxRetainedJobs } = await import(
  pathToFileURL(process.env.DEMO_COUNTER_PROBE).href
)
const cfg = JSON.parse(readFileSync(process.env.PLAYGROUND_PRIVATE_CONFIG, "utf8"))
const pool = new Pool({ connectionString: cfg.connectionString, statement_timeout: 5000 })
const schema = "demo_counter"
const config = { ...cfg, schema, localPrivate: true }
const snapshot = async () => {
  const {
    rows: [control]
  } = await pool.query(
    `SELECT current_id,sequence::text,next_tick::text,rotate_at::text FROM "${schema}".demo_control`
  )
  const {
    rows: [sandbox]
  } = await pool.query(
    `SELECT retained_jobs::text FROM "${schema}".sandboxes WHERE sandbox_id=$1`,
    [control.current_id]
  )
  const { rows: jobs } = await pool.query(
    `SELECT j.id FROM "${schema}".jobs j JOIN "${schema}".associations a ON a.job_id=j.id WHERE a.sandbox_id=$1 ORDER BY j.id`,
    [control.current_id]
  )
  const {
    rows: [counts]
  } = await pool.query(
    `SELECT (SELECT count(*)::int FROM "${schema}".jobs) AS jobs,(SELECT count(*)::int FROM "${schema}".associations) AS associations`
  )
  return {
    ...control,
    retainedJobs: Number(sandbox.retained_jobs),
    ids: jobs.map((j) => j.id),
    counts
  }
}

try {
  await pool.query(`CREATE SCHEMA "${schema}"`)
  for (const migration of migrations(schema).slice(0, 4)) {
    await pool.query(migration.sql)
  }
  assert.equal((await Effect.runPromise(prepare(config))).phase, "published")
  const outputs = []
  for (const version of [4, 5]) {
    if (version === 5) {
      await pool.query(migrations(schema)[4].sql)
    }
    // Schedule-only fixture: all jobs and lifecycle states use real producers/workers.
    await pool.query(`UPDATE "${schema}".demo_control SET next_tick=1`)
    const before = await snapshot()
    const expected = batch(Number(before.sequence))
    const startedAt = Date.now()
    const result = await Effect.runPromise(tick(config))
    const finishedAt = Date.now()
    assert.equal(result.driverType, version === 4 ? "number" : "bigint")
    assert.equal(result.result.phase, "running")
    const after = await snapshot()
    assert.equal(after.current_id, before.current_id)
    assert.equal(after.rotate_at, before.rotate_at)
    assert.equal(after.retainedJobs, before.retainedJobs + expected.jobs.length)
    assert.equal(after.counts.jobs, before.counts.jobs + expected.jobs.length)
    assert.equal(
      after.counts.associations,
      before.counts.associations + expected.jobs.length
    )
    assert.equal(
      after.ids.filter((id) => !before.ids.includes(id)).length,
      expected.jobs.length
    )
    assert.equal(Number(after.sequence), Number(before.sequence) + 1)
    assert(Number(after.next_tick) >= startedAt + expected.afterMillis)
    assert(Number(after.next_tick) <= finishedAt + expected.afterMillis)
    assert.equal((await Effect.runPromise(tick(config))).result.phase, "waiting")
    assert.deepEqual(await snapshot(), after, "not-due tick must not duplicate/backfill")
    outputs.push({ version, result, expected, before, after })
  }

  // Separate counter-boundary fixture, after the schedule-only reproduction above.
  // No fabricated lifecycle rows. Verify DB/application limits without a 20k-job soak.
  await assert.rejects(
    pool.query(`UPDATE "${schema}".sandboxes SET retained_jobs=$1 WHERE demo_owned`, [
      maxRetainedJobs + 1
    ]),
    (error) =>
      error.code === "23514" && error.constraint === "sandboxes_retained_jobs_check"
  )
  await pool.query(`UPDATE "${schema}".sandboxes SET retained_jobs=$1 WHERE demo_owned`, [
    maxRetainedJobs
  ])
  await pool.query(`UPDATE "${schema}".demo_control SET next_tick=1`)
  const beforeQuota = await snapshot()
  const result = await Effect.runPromise(tick(config))
  assert.equal(result.result.phase, "quota")
  const afterQuota = await snapshot()
  assert.deepEqual(afterQuota.ids, beforeQuota.ids)
  assert.deepEqual(afterQuota.counts, beforeQuota.counts)
  assert.equal(afterQuota.retainedJobs, maxRetainedJobs)
  assert.equal(afterQuota.sequence, beforeQuota.sequence)
  assert.equal(afterQuota.next_tick, beforeQuota.next_tick)
  assert(Number(afterQuota.rotate_at) < Number(beforeQuota.rotate_at))
  assert.equal((await Effect.runPromise(tick(config))).result.phase, "preparing")
  const {
    rows: [rotation]
  } = await pool.query(
    `SELECT d.current_id,d.candidate_id,s.retained_jobs::text FROM "${schema}".demo_control d JOIN "${schema}".sandboxes s ON s.sandbox_id=d.candidate_id`
  )
  assert.equal(rotation.current_id, beforeQuota.current_id)
  assert.notEqual(rotation.candidate_id, beforeQuota.current_id)
  assert.equal(Number(rotation.retained_jobs), 30)
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        outputs,
        quota: { beforeQuota, afterQuota, rotation },
        checks: [
          "v4/v5 real driver representation and running due ticks",
          "committed finite jobs/associations/counter and single sequence/schedule advance",
          "not-due tick has no duplicate or backfill",
          "demo DB cap rejects 20001",
          "over-limit batch adds no jobs and requests existing rotation",
          "next tick prepares real 30-job candidate without replacing current"
        ]
      },
      null,
      2
    )
  )
} finally {
  await pool.end()
}
