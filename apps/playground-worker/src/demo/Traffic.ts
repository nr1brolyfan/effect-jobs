import type { Behavior } from "../scenarios/Definitions.js"

export const maxRetainedJobs = 20_000
export interface Profile {
  readonly behavior: Behavior
  readonly waitMillis: number
  readonly retryMillis: number
}

// Persisted slot -> reproducible irregular arrivals. Retrying a transaction cannot
// redraw a different batch, and missed alarms never accumulate catch-up work.
export const batch = (sequence: number) => {
  let seed = Math.imul(sequence + 1, 0x9e3779b1) >>> 0
  const random = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 0x1_0000_0000
  }
  const count = [1, 1, 2, 3, 3][Math.floor(random() * 5)]!
  const jobs: Profile[] = Array.from({ length: count }, () => {
    const roll = random()
    const behavior: Behavior =
      roll < 0.65
        ? "success"
        : roll < 0.95
          ? "retry-then-success"
          : roll < 0.975
            ? "dead"
            : roll < 0.99
              ? "isolated"
              : "accepted-response-lost"
    return {
      behavior,
      waitMillis: random() < 0.2 ? 0 : (15 + 5 * Math.floor(random() * 10)) * 1000,
      retryMillis: (45 + 15 * Math.floor(random() * 4)) * 1000
    }
  })
  return { jobs, afterMillis: [5000, 10000, 15000][Math.floor(random() * 3)]! }
}
