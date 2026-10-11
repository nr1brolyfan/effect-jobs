import { describe, expect, it } from "vitest"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import * as Consumer from "effect-jobs/JobConsumer"
import * as Job from "effect-jobs/Job"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Queue from "effect-jobs/JobQueue"
import * as Registry from "effect-jobs/JobRegistry"
import * as Worker from "effect-jobs/JobWorker"
import type { JobStoreService } from "effect-jobs/JobStore"
import { Schema } from "effect"
import { TestClock } from "effect/testing"
import * as WakeCycle from "../../src/cloudflare/WakeCycle.js"

const queue = Queue.make("cloudflare-probe")
const definition = Job.make({
  queue,
  kind: "synthetic",
  payload: Schema.String,
  encodePayload: Codec.encodeJobPayload
})

const exercise = (
  snapshots: ReadonlyArray<WakeCycle.WakeSnapshot>,
  mode: "empty" | "unknown" | "recovery-failure" | "second-read-hang" = "empty"
) => {
  const alarms: Array<number | "clear"> = []
  let claims = 0
  let recoveries = 0
  let reads = 0
  const unexpected = () => Effect.die("Unexpected mock store operation")
  const store: JobStoreService<string> = {
    claim: () =>
      Effect.sync(() => {
        claims++
        return mode === "unknown"
          ? { _tag: "Unknown" as const }
          : { _tag: "Empty" as const }
      }),
    recoverExpired: () =>
      Effect.suspend(() => {
        recoveries++
        return mode === "recovery-failure" ? Effect.fail("synthetic") : Effect.succeed(0)
      }),
    reconcileClaim: () => Effect.succeed({ _tag: "NotOwned" }),
    release: unexpected,
    finalize: unexpected,
    reconcileFinalization: unexpected
  }
  const worker = Worker.layer(store, {
    catalog: [definition],
    operationResponseBudgetMillis: 100
  }).pipe(
    Layer.provide(definition.handlerLayer(() => Effect.void, Codec.decodeJobPayload)),
    Layer.provide(Registry.layer)
  )
  const program = Consumer.make(queue, {
    localConcurrency: 2,
    claimLimitPerRun: 10,
    recoveryLimitPerRun: 10
  }).pipe(
    Effect.flatMap(WakeCycle.run),
    Effect.provide(worker),
    Effect.provideService(WakeCycle.WakeSchedule, {
      read: Effect.suspend(() =>
        mode === "second-read-hang" && reads++ > 0
          ? Effect.never
          : Effect.succeed(
              snapshots[
                Math.min(mode === "second-read-hang" ? 0 : reads++, snapshots.length - 1)
              ]!
            )
      )
    }),
    Effect.provideService(WakeCycle.WakeAlarm, {
      set: (timestamp) =>
        Effect.sync(() => {
          alarms.push(timestamp)
        }),
      clear: Effect.sync(() => {
        alarms.push("clear")
      })
    })
  )
  return {
    program,
    run: () => Effect.runPromise(program),
    alarms,
    counts: () => ({ claims, recoveries, reads })
  }
}

describe("finite wake cycle (mock storage, not PostgreSQL evidence)", () => {
  it("does no recovery/claim for expired activation", async () => {
    const probe = exercise([
      { expiresInMillis: 0, dueInMillis: null, recoveryInMillis: null }
    ])
    expect(await probe.run()).toEqual({ _tag: "Expired" })
    expect(probe.alarms).toEqual(["clear"])
    expect(probe.counts()).toEqual({ claims: 0, recoveries: 0, reads: 1 })
  })
  it("preserves delayed wake after observing an empty claim", async () => {
    const probe = exercise([
      { expiresInMillis: 60_000, dueInMillis: 2_000, recoveryInMillis: null }
    ])
    const before = Date.now()
    expect((await probe.run())._tag).toBe("Idle")
    expect(probe.alarms).toHaveLength(2)
    expect(probe.alarms[1]).toBeGreaterThanOrEqual(before + 2_000)
    expect(Number(probe.alarms[1]) - Number(probe.alarms[0])).toBeLessThan(-27_000)
    expect(probe.counts()).toEqual({ claims: 1, recoveries: 1, reads: 2 })
  })
  it("schedules expiry recovery before the repair ceiling", async () => {
    const probe = exercise([
      { expiresInMillis: 60_000, dueInMillis: null, recoveryInMillis: 500 }
    ])
    await probe.run()
    expect(Number(probe.alarms[1]) - Number(probe.alarms[0])).toBeLessThan(-29_000)
  })
  it("backs off unresolved claims and recovery failures", async () => {
    for (const mode of ["unknown", "recovery-failure"] as const) {
      const probe = exercise(
        [{ expiresInMillis: 60_000, dueInMillis: 0, recoveryInMillis: 0 }],
        mode
      )
      expect((await probe.run())._tag).toBe("Backoff")
      expect(Number(probe.alarms[1]) - Number(probe.alarms[0])).toBeLessThan(-28_000)
      expect(Number(probe.alarms[1]) - Number(probe.alarms[0])).toBeGreaterThanOrEqual(
        -29_000
      )
      expect(probe.counts().claims).toBe(mode === "unknown" ? 1 : 0)
    }
  })
  it("stops repair alarms at finite activation expiry", async () => {
    const probe = exercise([
      { expiresInMillis: 1_000, dueInMillis: null, recoveryInMillis: null },
      { expiresInMillis: 0, dueInMillis: null, recoveryInMillis: null }
    ])
    expect(await probe.run()).toEqual({ _tag: "Expired" })
    expect(probe.alarms[1]).toBe("clear")
  })
  it("rejects an oversized consumer before touching alarm or storage", async () => {
    const program = Consumer.make(queue, {
      localConcurrency: 3,
      claimLimitPerRun: 10,
      recoveryLimitPerRun: 10
    }).pipe(
      Effect.flatMap(WakeCycle.run),
      Effect.provide(
        Worker.layer(
          {
            claim: () => Effect.die("must not claim"),
            recoverExpired: () => Effect.die("must not recover"),
            reconcileClaim: () => Effect.die("must not reconcile"),
            release: () => Effect.die("must not release"),
            finalize: () => Effect.die("must not finalize"),
            reconcileFinalization: () => Effect.die("must not reconcile")
          } satisfies JobStoreService,
          {
            catalog: [definition],
            operationResponseBudgetMillis: 100
          }
        ).pipe(Layer.provide(Registry.layer))
      ),
      Effect.provideService(WakeCycle.WakeSchedule, {
        read: Effect.die("must not read")
      }),
      Effect.provideService(WakeCycle.WakeAlarm, {
        set: () => Effect.die("must not set"),
        clear: Effect.die("must not clear")
      })
    )
    const exit = await Effect.runPromiseExit(program)
    expect(Exit.isFailure(exit) && Cause.hasFails(exit.cause)).toBe(true)
  })
  it("bounds a hanging schedule read and closes the caller's scope", async () => {
    const probe = exercise(
      [{ expiresInMillis: 60_000, dueInMillis: null, recoveryInMillis: null }],
      "second-read-hang"
    )
    let closed = false
    const program = Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(Effect.void, () =>
          Effect.sync(() => {
            closed = true
          })
        )
        return yield* probe.program
      })
    )
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* program.pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* TestClock.adjust(5_000)
        return yield* Fiber.await(fiber)
      }).pipe(Effect.provide(TestClock.layer()))
    )
    expect(Exit.isFailure(exit) && Cause.hasFails(exit.cause)).toBe(true)
    expect(closed).toBe(true)
    expect(probe.alarms).toHaveLength(1)
  })
  it("preserves interruption and the prearmed repair while closing the scope", async () => {
    const probe = exercise(
      [{ expiresInMillis: 60_000, dueInMillis: null, recoveryInMillis: null }],
      "second-read-hang"
    )
    let closed = false
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.acquireRelease(Effect.void, () =>
              Effect.sync(() => {
                closed = true
              })
            )
            return yield* probe.program
          })
        ).pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* Fiber.interrupt(fiber)
        return yield* Fiber.await(fiber)
      })
    )
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true)
    expect(closed).toBe(true)
    expect(probe.alarms).toHaveLength(1)
  })
})
