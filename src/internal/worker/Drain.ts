import { Effect, Fiber, Semaphore } from "effect"
import { JobWorker } from "../../JobWorker.js"
import { WorkerCapability } from "./Capability.js"
import { DrainResults } from "./Results.js"
import type { JobConsumer } from "../../JobConsumer.js"
import type { DispatchResult } from "./Capability.js"

export interface DrainOptions {
  readonly recover?: boolean
  /** Internal deterministic shutdown hook; never a public polling option. */
  readonly beforeExecutionBoundary?: Effect.Effect<void>
}

export const drainWithOptions = (consumer: JobConsumer, options: DrainOptions = {}) =>
  Effect.gen(function* () {
    const worker = yield* JobWorker
    const runtime = worker[WorkerCapability]
    yield* runtime.ready(consumer.queue.name)
    const permits = yield* runtime.permits(consumer)
    const recovery = yield* (
      options.recover === false
        ? Effect.succeed(0)
        : runtime.recover(consumer.recoveryLimitPerRun)
    ).pipe(Effect.result)
    if (recovery._tag === "Failure") {
      return DrainResults.Backoff({ phase: "recovery", claimed: 0 })
    }
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const executions: Array<Fiber.Fiber<void>> = []
        let claimed = 0
        const install = (
          started: Extract<DispatchResult, { readonly _tag: "Started" }>,
          restore: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
        ) =>
          Effect.gen(function* () {
            yield* restore(options.beforeExecutionBoundary ?? Effect.void).pipe(
              Effect.onInterrupt(() => started.release)
            )
            const fiber = yield* restore(started.execution).pipe(
              Effect.ensuring(Semaphore.release(permits, 1)),
              Effect.forkScoped
            )
            executions.push(fiber)
          })
        let terminal: "Empty" | "Limit" | "Unresolved" | "Failed" = "Limit"
        for (; claimed < consumer.claimLimitPerRun; claimed++) {
          const result = yield* Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              yield* restore(Semaphore.take(permits, 1))
              let transferred = false
              return yield* restore(runtime.claim(consumer.queue.name)).pipe(
                Effect.flatMap((dispatch) => {
                  if (dispatch._tag !== "Started") {
                    return Effect.succeed(dispatch._tag)
                  }
                  return install(dispatch, restore).pipe(
                    Effect.tap(() =>
                      Effect.sync(() => {
                        transferred = true
                      })
                    ),
                    Effect.as("Started" as const)
                  )
                }),
                Effect.ensuring(
                  Effect.suspend(() =>
                    transferred ? Effect.void : Semaphore.release(permits, 1)
                  )
                )
              )
            })
          ).pipe(Effect.result)
          if (result._tag === "Failure") {
            terminal = "Failed"
            break
          }
          if (result.success !== "Started") {
            terminal = result.success
            break
          }
        }
        yield* Effect.forEach(executions, Fiber.await, { discard: true })
        if (terminal === "Failed" || terminal === "Unresolved") {
          return DrainResults.Backoff({
            phase: terminal === "Failed" ? "claim" : "reconciliation",
            claimed
          })
        }
        return terminal === "Empty"
          ? DrainResults.Idle({ claimed, recovered: recovery.success })
          : DrainResults.MoreWork({ claimed, recovered: recovery.success })
      })
    )
  })
