import { describe, expect, it } from "vitest"
import { frames, stateOf } from "../../src/components/landing/Storyboard.js"
import { maximum, presentation } from "../../src/components/docs/VisualState.js"

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
    expect(presentation("overview", 2, "commit").labels["response"]).toBe("201 Created")
    expect(presentation("overview", 2, "commit").labels["emailState"]).toBe("—")
    expect(presentation("overview", 4, "commit").labels["emailState"]).toBe("Sent")
    expect(presentation("overview", 4, "commit").labels["jobState"]).toBe("Active")
    expect(presentation("overview", 5, "commit").labels["jobState"]).toBe("Completed")
  })
})
