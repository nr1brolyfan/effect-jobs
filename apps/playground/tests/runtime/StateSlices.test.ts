import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import * as Fixtures from "@effect-jobs/playground-contracts/Fixtures"
import * as Atoms from "../../src/features/jobs/Atoms.js"
import { JobsClient } from "../../src/features/jobs/Adapter.js"
import * as FixtureClient from "../fixtures/FixtureClient.js"

describe("independent Atom views", () => {
  it("keeps list/query/stats quiet during detail, command and connection changes", async () => {
    const state = Atoms.make(Fixtures.sandbox)
    const notifications = {
      list: 0,
      query: 0,
      stats: 0,
      detail: 0,
      commands: 0,
      status: 0
    }
    const unsubs = [
      state.registry.subscribe(state.views.list, () => {
        notifications.list++
      }),
      state.registry.subscribe(state.views.query, () => {
        notifications.query++
      }),
      state.registry.subscribe(state.atoms.stats, () => {
        notifications.stats++
      }),
      state.registry.subscribe(state.views.detail, () => {
        notifications.detail++
      }),
      state.registry.subscribe(state.views.commands, () => {
        notifications.commands++
      }),
      state.registry.subscribe(state.views.status, () => {
        notifications.status++
      })
    ]
    try {
      await Effect.runPromise(
        state.refresh.pipe(Effect.provideService(JobsClient, FixtureClient.client))
      )
      const before = { ...notifications }
      state.registry.set(state.atoms.selected, FixtureClient.page.items[0]!.jobId)
      state.registry.set(state.atoms.notice, "Receipt lookup required; never replay")
      state.connection("reconnecting")
      expect(notifications).toEqual({
        ...before,
        detail: before.detail + 1,
        commands: before.commands + 1,
        status: before.status + 1
      })
      expect(state.registry.get(state.views.query).resultsCurrent).toBe(true)
      expect(state.snapshot().pagination).toEqual(
        state.registry.get(state.views.list).pagination
      )
    } finally {
      unsubs.forEach((unsubscribe) => unsubscribe())
      state.dispose()
    }
  })

  it("does not share registry data or subscriptions across mount lifetimes", () => {
    const first = Atoms.make(Fixtures.sandbox)
    const second = Atoms.make(Fixtures.sandbox)
    let observed = 0
    const unsubscribe = second.registry.subscribe(second.views.commands, () => {
      observed++
    })
    first.registry.set(first.atoms.notice, "private receipt")
    first.registry.set(first.atoms.filters, { state: "Dead" })
    expect(observed).toBe(0)
    expect(second.registry.get(second.views.commands).notice).toBe("")
    expect(second.registry.get(second.views.query).filters).toEqual({})
    unsubscribe()
    first.dispose()
    second.dispose()
  })
})
