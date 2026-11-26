import { describe, expect, it } from "vitest"
import { frames, stateOf } from "../../src/components/landing/Storyboard.js"
import { maximum, presentation } from "../../src/components/docs/VisualState.js"
import { drainTrace } from "../../src/components/docs/WorkerDrainTrace.js"

describe("landing storyboard contracts", () => {
  it("bounds execution to two slots and never assigns a slot twice", () => {
    for (const frame of frames) {
      const active = frame.filter((value) => stateOf(value) === "Active")
      expect(active.length).toBeLessThanOrEqual(2)
      expect(new Set(active).size).toBe(active.length)
      expect(frame).toHaveLength(4)
    }
  })
  it("persists the illustrated retry delay before a second claim and finishes finitely", () => {
    expect(frames.slice(4, 9).map((frame) => frame[1])).toEqual(
      Array(5).fill("RetryScheduled")
    )
    expect(frames[9][1]).toBe("Active:0")
    expect(frames.at(-1)).toEqual(Array(4).fill("Completed"))
    // No terminal completion is depicted as becoming Active again.
    for (let job = 0; job < 4; job++) {
      const completed = frames.findIndex((frame) => frame[job] === "Completed")
      expect(frames.slice(completed).every((frame) => frame[job] === "Completed")).toBe(
        true
      )
    }
  })
})

describe("documentation illustration contracts", () => {
  it("keeps expired-lease recovery separate from claim caps and slot usage", () => {
    const { frames, peak } = drainTrace({
      concurrency: 8,
      maxJobs: 16,
      recovery: 8,
      workers: 3
    })
    expect(frames[1]?.workers.map((worker) => worker.packets)).toEqual(
      Array.from({ length: 3 }, () => [{ kind: "recover", text: "≤8 leases" }])
    )
    expect(frames[2]).toMatchObject({ pending: 88, recovered: 24, expired: 0, active: 0 })
    expect(peak).toBe(24)
    expect(frames.at(-1)).toMatchObject({ pending: 40, completed: 48, active: 0 })
    const claimed = frames.flatMap((frame) =>
      frame.workers.flatMap((worker) =>
        worker.packets
          .filter((packet) => packet.kind === "claim")
          .map((packet) => packet.text)
      )
    )
    expect(claimed).toHaveLength(48)
    expect(new Set(claimed).size).toBe(48)
  })
  it("confirmed rollback exposes neither record nor a claimable job", () => {
    for (const step of [3, maximum("transaction")]) {
      const view = presentation("transaction", step, "rollback")
      expect(view.labels["order"]).toBe("—")
      expect(view.labels["job"]).toBe("—")
      expect(view.labels["workerState"]).toBe("No job")
      expect(view.nodes["worker"]).toBe(false)
      expect(view.result).toBe("rollback")
    }
  })
  it("a worker cannot claim staged transaction data", () => {
    for (const step of [0, 1, 2, 3]) {
      expect(presentation("transaction", step, "commit").nodes["worker"]).toBe(false)
    }
    expect(presentation("transaction", 4, "commit").labels["workerState"]).toBe("Claimed")
  })
  it("enqueues invoice delivery while confirmation remains independent", () => {
    const view = presentation("handoff", 3, "commit")
    expect(view.labels["confirmationState"]).toBe("Active")
    expect(view.labels["invoiceState"]).toBe("Completed")
    expect(view.labels["deliveryState"]).toBe("Pending")
    expect(view.dim).toBe(false)
  })
  it("keeps the API response, external side effect and durable completion distinct", () => {
    expect(presentation("overview", 1, "commit").labels["response"]).toBe(
      "Waiting for API"
    )
    expect(presentation("overview", 1, "commit").labels["jobState"]).toBe("—")
    expect(presentation("overview", 2, "commit").labels["jobState"]).toBe("Pending")
    expect(presentation("overview", 3, "commit").labels["response"]).toBe("201 Created")
    expect(presentation("overview", 3, "commit").labels["emailState"]).toBe("—")
    expect(presentation("overview", 5, "commit").labels["emailState"]).toBe("Sent")
    expect(presentation("overview", 5, "commit").labels["jobState"]).toBe("Active")
    expect(presentation("overview", 6, "commit").labels["jobState"]).toBe("Completed")
  })
})
