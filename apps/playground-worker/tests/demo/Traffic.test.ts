import { describe, expect, it } from "vitest"
import * as Traffic from "../../src/demo/Traffic.js"

describe("public demo traffic", () => {
  it("replays deterministic irregular batches without changing job profiles", () => {
    const sizes = new Set<number>()
    const gaps = new Set<number>()
    for (let sequence = 0; sequence < 100; sequence++) {
      const batch = Traffic.batch(sequence)
      expect(batch).toEqual(Traffic.batch(sequence))
      sizes.add(batch.jobs.length)
      gaps.add(batch.afterMillis)
      batch.jobs.forEach((job) => {
        expect(job.waitMillis).toBeGreaterThanOrEqual(0)
        expect(job.waitMillis).toBeLessThanOrEqual(60_000)
        expect(job.retryMillis).toBeGreaterThanOrEqual(45_000)
        expect(job.retryMillis).toBeLessThanOrEqual(90_000)
      })
    }
    expect([...sizes].sort((a, b) => a - b)).toEqual([1, 2, 3])
    expect([...gaps].sort((a, b) => a - b)).toEqual([5000, 10000, 15000])
  })

  it("keeps normal daily volume bounded while maintaining pending/retry traffic", () => {
    let elapsed = 0
    let total = 30
    let retries = 0
    let delayed = 0
    for (let sequence = 0; elapsed < 86_400_000; sequence++) {
      const batch = Traffic.batch(sequence)
      elapsed += batch.afterMillis
      total += batch.jobs.length
      retries += batch.jobs.filter((job) => job.behavior === "retry-then-success").length
      delayed += batch.jobs.filter((job) => job.waitMillis > 0).length
    }
    expect(total).toBeGreaterThan(12_000)
    expect(total).toBeLessThan(Traffic.maxRetainedJobs)
    expect(retries / total).toBeGreaterThan(0.25)
    expect(retries / total).toBeLessThan(0.35)
    expect(delayed / total).toBeGreaterThan(0.7)
    expect(delayed / total).toBeLessThan(0.9)
  })
})
