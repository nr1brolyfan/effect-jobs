export const initialLimits = { concurrency: 3, maxJobs: 8, recovery: 2, workers: 1 }
export type Limits = typeof initialLimits

type Phase = "claim" | "run" | "finalize"
export type Packet =
  | { kind: "recover" | "recovered" | "finalize"; text: string }
  | { kind: "claim"; text: string; ordinal: number }
const readyRows = 64
const expiredRows = 24
const tickSeconds = 0.1
export const jobLabel = (id: number) => `J${String(id).padStart(2, "0")}`

/** A teaching trace, not a scheduler benchmark. Each retained frame has an event. */
export function drainTrace(limits: Limits) {
  let pending = readyRows
  let expired = expiredRows
  let recovered = 0
  let claimed = 0
  let completed = 0
  type Job = { id: number; phase: Phase; next: number }
  const workers = Array.from({ length: limits.workers }, () => ({
    started: 0,
    recovered: 0,
    slots: Array.from<Job | null>({ length: limits.concurrency }).fill(null),
    packets: [] as Packet[]
  }))
  const snapshot = () => ({
    pending,
    expired,
    recovered,
    completed,
    active: claimed - completed,
    workers: workers.map(({ slots, packets, ...worker }) => ({
      ...worker,
      slots: [...slots],
      packets: [...packets]
    })),
    running: workers.reduce(
      (sum, worker) => sum + worker.slots.filter((job) => job?.phase === "run").length,
      0
    )
  })
  const frames = [snapshot()]
  let peak = 0
  let durationSeconds = 0
  let done = false
  for (let tick = 1; !done; tick++) {
    let changed = false
    for (const worker of workers) {
      worker.packets = []
      if (tick === 1) {
        worker.packets.push({ kind: "recover", text: `≤${limits.recovery} leases` })
        changed = true
        continue
      }
      if (tick === 2) {
        worker.recovered = Math.min(expired, limits.recovery)
        expired -= worker.recovered
        // These rows become due Pending. The 64 seeded ready rows sort ahead of them.
        recovered += worker.recovered
        pending += worker.recovered
        worker.packets.push({ kind: "recovered", text: `${worker.recovered} recovered` })
        changed = true
        continue
      }
      for (const [slot, job] of worker.slots.entries()) {
        if (!job || job.next !== tick) continue
        changed = true
        if (job.phase === "claim") {
          worker.slots[slot] = {
            ...job,
            phase: "run",
            next: tick + 9 + ((job.id * 3) % 4)
          }
        } else if (job.phase === "run") {
          worker.slots[slot] = { ...job, phase: "finalize", next: tick + 1 }
          worker.packets.push({ kind: "finalize", text: jobLabel(job.id) })
        } else {
          worker.slots[slot] = null
          completed++
        }
      }
      const open = worker.slots.indexOf(null)
      if (open !== -1 && worker.started < limits.maxJobs && pending > 0) {
        const id = ++claimed
        pending--
        worker.started++
        worker.slots[open] = { id, phase: "claim", next: tick + 1 }
        worker.packets.push({
          kind: "claim",
          text: jobLabel(id),
          ordinal: worker.started
        })
        changed = true
      }
    }
    if (changed) {
      const frame = snapshot()
      frames.push(frame)
      peak = Math.max(peak, frame.running)
    }
    done = workers.every(
      (worker) =>
        (worker.started === limits.maxJobs || pending === 0) &&
        worker.slots.every((slot) => slot === null)
    )
    if (done) durationSeconds = tick * tickSeconds
  }
  return {
    frames,
    peak,
    durationSeconds,
    jobsPerMinute: (completed * 60) / durationSeconds
  }
}
