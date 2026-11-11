import { afterEach, describe, expect, it, vi } from "vitest"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { limits } from "@effect-jobs/playground-contracts/Sandbox"
import { liveLimits } from "@effect-jobs/playground-contracts/LiveProtocol"
import { setupLive } from "./NativeLiveUnit.js"

const now = 1_800_000_000_000
const ref = Fixtures.sandbox.ref
const setup = (options: Omit<Parameters<typeof setupLive>[0], "now"> = {}) =>
  setupLive({ ...options, now })
afterEach(() => vi.restoreAllMocks())
describe("hibernating live orchestration", () => {
  it("clears dirty before sending and rearms reconciliation after delivered wake", async () => {
    const probe = await setup({ alarm: now + 100 })
    await probe.alarmPass()
    expect(probe.events).toEqual(["dirty:false", "send"])
    expect(JSON.parse(probe.messages[0]!)).toMatchObject({
      reason: "jobs-changed",
      sequence: 2
    })
    expect(probe.alarm()).toBe(now + limits.reconciliationMillis)
    await probe.run(
      probe.object.webSocketMessage(
        probe.socket,
        JSON.stringify({ kind: "ack", sequence: 2 })
      )
    )
    await probe.alarmPass()
    expect(JSON.parse(probe.messages[1]!)).toMatchObject({
      reason: "reconcile",
      sequence: 3
    })
    expect(probe.closes).toEqual([])
  })
  it("coalesces notifications without postponing an existing earlier alarm", async () => {
    const probe = await setup({ alarm: now + 100 })
    await probe.run(probe.object.notifyCommitted(ref))
    expect(probe.storage.get("dirty")).toBe(true)
    expect(probe.alarm()).toBe(now + 100)
    await probe.run(
      probe.object.notifyCommitted({ ...ref, generation: ref.generation + 1 })
    )
    expect(probe.events).toEqual(["dirty:true"])
  })
  it("closes slow viewers at the ACK deadline and clears the alarm", async () => {
    const probe = await setup({ pending: true, sentAt: now - liveLimits.ackMillis })
    await probe.alarmPass()
    expect(probe.closes).toEqual([4008])
    expect(probe.messages).toEqual([])
    expect(probe.alarm()).toBeNull()
  })
  it.each([{ expiresAt: now }, { current: false }])(
    "fails closed for unavailable authority %j",
    async (options) => {
      const probe = await setup(options)
      await probe.alarmPass()
      expect(probe.closes).toEqual([4003])
      expect(probe.messages).toEqual([])
      expect(probe.alarm()).toBeNull()
    }
  )
  it("rejects mismatched acknowledgements and sequence overflow", async () => {
    const probe = await setup({ sequence: Number.MAX_SAFE_INTEGER })
    await probe.run(
      probe.object.webSocketMessage(
        probe.socket,
        JSON.stringify({ kind: "ack", sequence: 1 })
      )
    )
    expect(probe.closes).toEqual([4008])
    await probe.alarmPass()
    expect(probe.closes).toEqual([4008, 4008])
    expect(probe.messages).toEqual([])
  })
})
