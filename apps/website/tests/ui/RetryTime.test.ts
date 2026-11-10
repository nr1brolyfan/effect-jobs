import { describe, expect, it } from "vitest"
import { countdown, exactTime } from "../../src/features/jobs/RetryTime.js"

describe("retry eligibility display", () => {
  it("counts down from the persisted timestamp without rounding down early", () => {
    expect(countdown(38_001, 0)).toBe("In 39s")
    expect(countdown(38_000, 0)).toBe("In 38s")
    expect(countdown(61_000, 0)).toBe("In 1m 1s")
    expect(countdown(3_661_000, 0)).toBe("In 1h 1m 1s")
  })
  it("describes eligibility, never claiming that a worker has started", () => {
    expect(countdown(1000, 1000)).toBe("Eligible now · waiting for a worker")
    expect(countdown(1000, 2000)).toBe("Eligible now · waiting for a worker")
  })
  it("formats the exact second and local timezone", () => {
    const millis = Date.parse("2026-10-12T09:42:15Z")
    const formatted = exactTime(millis)
    expect(formatted).toContain(":15")
    expect(formatted).toContain("2026")
    expect(formatted).not.toBe(new Date(millis).toISOString())
  })
})
