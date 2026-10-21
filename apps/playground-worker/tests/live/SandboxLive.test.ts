import { afterEach, describe, expect, it, vi } from "vitest"
import { Effect } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import { liveLimits } from "../../../website/src/live/Protocol.js"
import * as Live from "../../src/live/SandboxLive.js"

const now = 1_800_000_000_000
const ref = Fixtures.sandbox.ref
const setup = async (
  options: {
    readonly pending?: boolean
    readonly sentAt?: number
    readonly expiresAt?: number
    readonly sequence?: number
    readonly current?: boolean
    readonly alarm?: number | null
  } = {}
) => {
  vi.spyOn(Date, "now").mockReturnValue(now)
  let attachment: unknown = {
    sandbox: ref,
    expiresAt: options.expiresAt ?? now + 60_000,
    sequence: options.sequence ?? 1,
    sentAt: options.sentAt ?? now,
    pending: options.pending ?? false
  }
  const events: string[] = []
  const messages: string[] = []
  const closes: number[] = []
  let alarm = options.alarm ?? null
  let ready = Promise.resolve()
  const socket: Live.HibernatingSocket = {
    readyState: 1,
    send: (message) => {
      events.push("send")
      messages.push(message)
    },
    close: (code) => {
      closes.push(code)
    },
    serializeAttachment: (value) => {
      attachment = value
    },
    deserializeAttachment: () => attachment
  }
  const storage = new Map<string, unknown>([
    ["scope", ref],
    ["dirty", true]
  ])
  function get<T>(key: string): Promise<T | undefined>
  async function get(key: string): Promise<unknown> {
    return storage.get(key)
  }
  const state: Live.LiveState = {
    storage: {
      get,
      put: async (key, value) => {
        events.push(`${key}:${String(value)}`)
        storage.set(key, value)
      },
      getAlarm: async () => alarm,
      setAlarm: async (at) => {
        alarm = at
      },
      deleteAlarm: async () => {
        alarm = null
      }
    },
    blockConcurrencyWhile: (callback) => {
      const result = callback()
      ready = result.then(() => undefined)
      return result
    },
    acceptWebSocket: () => undefined,
    getWebSockets: () => [socket]
  }
  class Base {
    constructor(_state: Live.LiveState, _env: undefined) {}
  }
  const ObjectClass = Live.makeDurableObject<undefined, Live.LiveState>(
    {
      origin: () => "https://example.test",
      authorize: () => Effect.succeed({ ...Fixtures.sandbox, expiresAt: now + 60_000 }),
      isCurrent: () => Effect.succeed(options.current ?? true)
    },
    Base
  )
  const object = new ObjectClass(state, undefined)
  await ready
  return { object, socket, events, messages, closes, storage, alarm: () => alarm }
}
afterEach(() => vi.restoreAllMocks())
describe("hibernating live orchestration", () => {
  it("clears dirty before sending and preserves an earlier alarm", async () => {
    const probe = await setup({ alarm: now + 100 })
    await probe.object.alarm()
    expect(probe.events).toEqual(["dirty:false", "send"])
    expect(JSON.parse(probe.messages[0]!)).toMatchObject({
      reason: "jobs-changed",
      sequence: 2
    })
    expect(probe.alarm()).toBe(now + 100)
    await probe.object.webSocketMessage(
      probe.socket,
      JSON.stringify({ kind: "ack", sequence: 2 })
    )
    await probe.object.alarm()
    expect(JSON.parse(probe.messages[1]!)).toMatchObject({
      reason: "reconcile",
      sequence: 3
    })
    expect(probe.closes).toEqual([])
  })
  it("coalesces notifications without postponing an existing earlier alarm", async () => {
    const probe = await setup({ alarm: now + 100 })
    await probe.object.notifyCommitted(ref)
    expect(probe.storage.get("dirty")).toBe(true)
    expect(probe.alarm()).toBe(now + 100)
    await probe.object.notifyCommitted({ ...ref, generation: ref.generation + 1 })
    expect(probe.events).toEqual(["dirty:true"])
  })
  it("closes slow viewers at the ACK deadline and clears the alarm", async () => {
    const probe = await setup({ pending: true, sentAt: now - liveLimits.ackMillis })
    await probe.object.alarm()
    expect(probe.closes).toEqual([4008])
    expect(probe.messages).toEqual([])
    expect(probe.alarm()).toBeNull()
  })
  it.each([{ expiresAt: now }, { current: false }])(
    "fails closed for unavailable authority %j",
    async (options) => {
      const probe = await setup(options)
      await probe.object.alarm()
      expect(probe.closes).toEqual([4003])
      expect(probe.messages).toEqual([])
      expect(probe.alarm()).toBeNull()
    }
  )
  it("rejects mismatched acknowledgements and sequence overflow", async () => {
    const probe = await setup({ sequence: Number.MAX_SAFE_INTEGER })
    await probe.object.webSocketMessage(
      probe.socket,
      JSON.stringify({ kind: "ack", sequence: 1 })
    )
    expect(probe.closes).toEqual([4008])
    await probe.object.alarm()
    expect(probe.closes).toEqual([4008, 4008])
    expect(probe.messages).toEqual([])
  })
})
