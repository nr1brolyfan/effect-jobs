import assert from "node:assert/strict"
import { test } from "node:test"
import {
  healthChecks,
  Measurements,
  nextArrival,
  ownedContainer,
  parseOptions,
  rates
} from "./Support.mjs"

test("plan is inert and soak defaults retain real library policy", () => {
  const options = parseOptions([])
  assert.equal(options.run, false)
  assert.equal(options.durationSeconds, 1800)
  assert.equal(options.churnEvery, 10)
  assert.equal(options.workers, 3)
  assert.equal(parseOptions(["--run", "--smoke"]).durationSeconds, 12)
})
test("reject unbounded runs, foreign database arguments and unpinned images", () => {
  for (const args of [
    ["--duration", "0"],
    ["--rate", "NaN"],
    ["--workers", "99"],
    ["--duration", "7200", "--rate", "1000"],
    ["--image", "postgres:latest"],
    ["--database-url", "postgres://production"],
    ["--duration", "Infinity"]
  ]) {
    assert.throws(() => parseOptions(args))
  }
})
test("arrivals skip missed slots without a catch-up burst", () => {
  assert.deepEqual(nextArrival(0, 0, 0, 4, 100, -1), { slot: 0, due: 0, missed: 0 })
  assert.deepEqual(nextArrival(210, 0, 0, 4, 100, 0), { slot: 5, due: 200, missed: 4 })
  assert.deepEqual(nextArrival(10, 0, 1, 4, 100, -1), { slot: 0, due: 10, missed: 0 })
})
test("histograms and counters are bounded aggregate measurements", () => {
  const measurements = new Measurements()
  measurements.count("enqueue.Inserted", 10)
  for (let n = 0; n < 100; n++) {
    measurements.record("claim.Claimed", n)
  }
  const result = measurements.snapshot()
  assert.equal(result.latencyMillis["claim.Claimed"].count, 100)
  assert.ok(result.latencyMillis["claim.Claimed"].p99 >= 98)
  assert.equal(measurements.histograms.size, 1)
  assert.deepEqual(
    rates(
      { elapsedMillis: 0, counters: {} },
      {
        elapsedMillis: 2000,
        counters: {
          "enqueue.Inserted": 10,
          "completed.Applied": 8,
          "producer.missedSlots": 2
        }
      }
    ),
    {
      seconds: 2,
      insertedPerSecond: 5,
      confirmedCompletedPerSecond: 4,
      missedArrivalSlots: 2
    }
  )
})
test("container target must have exact owner label and loopback binding", () => {
  const inspection = {
    Config: { Labels: { "effect-jobs.soak.owner": "mine" } },
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1" }] } }
  }
  assert.equal(ownedContainer(inspection, "mine"), true)
  assert.equal(ownedContainer(inspection, "someone-else"), false)
  inspection.NetworkSettings.Ports["5432/tcp"][0].HostIp = "0.0.0.0"
  assert.equal(ownedContainer(inspection, "mine"), false)
})

test("health checks reject lost work, failed operations, missing cleanup and broken accounting", () => {
  const healthy = () => ({
    counters: {
      "producer.offered": 100,
      "enqueue.Inserted": 100,
      "completed.Applied": 100,
      "cleanup.rows": 10
    },
    durable: [{ state: "Completed", count: 190 }],
    history: 100,
    orphanPayloads: 0,
    options: { history: 100, durationSeconds: 60, churnRetentionSeconds: 30 }
  })
  assert.ok(Object.values(healthChecks(healthy())).every(Boolean))
  const lost = healthy()
  lost.counters["completed.Applied"]--
  assert.equal(healthChecks(lost).allInsertedCompleted, false)
  const missedInsert = healthy()
  missedInsert.counters["enqueue.Inserted"]--
  assert.equal(healthChecks(missedInsert).allOfferedInserted, false)
  for (const operation of ["claim.Unknown", "finalize.Failure", "drain.Backoff"]) {
    const bad = healthy()
    bad.counters[operation] = 1
    assert.equal(healthChecks(bad).noOperationFailures, false)
  }
  const noCleanup = healthy()
  noCleanup.counters["cleanup.rows"] = 0
  assert.equal(healthChecks(noCleanup).cleanupExercised, false)
  const corrupt = healthy()
  corrupt.durable[0].count--
  assert.equal(healthChecks(corrupt).accounting, false)
  const history = healthy()
  history.history--
  assert.equal(healthChecks(history).historyPreserved, false)
  const active = healthy()
  active.durable.push({ state: "Active", count: 1 })
  assert.equal(healthChecks(active).onlyCompletedRemain, false)
  const orphan = healthy()
  orphan.orphanPayloads = 1
  assert.equal(healthChecks(orphan).noOrphanPayloads, false)
  const empty = healthy()
  empty.counters = {}
  assert.equal(healthChecks(empty).allOfferedInserted, false)
})
