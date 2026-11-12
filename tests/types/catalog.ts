import { Context, Effect, Layer, Schema } from "effect"
import * as Api from "../../src/JobApi.js"
import * as Builder from "../../src/JobApiBuilder.js"
import * as Group from "../../src/JobGroup.js"
import * as Worker from "../../src/JobWorker.js"
import * as Storage from "../../src/JobStorage.js"
import * as Queue from "../../src/JobQueue.js"
import type { HandlerContext } from "../../src/JobContract.js"
import type { JobFailure } from "../../src/JobFailure.js"

class Setup extends Context.Service<Setup, {}>()("types/catalog/Setup") {}
class Invocation extends Context.Service<Invocation, {}>()("types/catalog/Invocation") {}
class Decode extends Context.Service<Decode, {}>()("types/catalog/Decode") {}
declare const schema: Schema.Codec<{ readonly id: number }, string, Decode>
const a = Group.make("a", {
  run: { name: "a", version: 1, payload: schema },
  other: { name: "other", version: 1, payload: Schema.String }
})
const b = Group.make("b", { run: { name: "b", version: 1, payload: Schema.Int } })
const api = Api.make("app").pipe(Api.addGroup(a), Api.addGroup(b))
const handlers = Builder.group(api, "a", (h) =>
  Effect.gen(function* () {
    yield* Setup
    if (yield* Effect.succeed(false)) {
      return yield* Effect.fail("setup-error" as const)
    }
    return h
      .handle("run", (input) =>
        Effect.gen(function* () {
          yield* Invocation
          const context: HandlerContext = input.context
          const id: number = input.payload.id
          // @ts-expect-error Precise payload is preserved.
          const wrong: string = input.payload.id
          void context
          void id
          void wrong
        })
      )
      .handle("other", () => Effect.void)
  })
)
export const channels: Layer.Layer<
  Group.Handlers<"a", typeof a.definitions>,
  "setup-error" | Group.JobGroupConfigurationError,
  Setup | Invocation | Decode
> = handlers
type ExpectFalse<T extends false> = T
export type KeepsSetup = ExpectFalse<
  typeof handlers extends Layer.Layer<unknown, unknown, Invocation | Decode>
    ? true
    : false
>
export type KeepsInvocation = ExpectFalse<
  typeof handlers extends Layer.Layer<unknown, unknown, Setup | Decode> ? true : false
>
export type KeepsDecode = ExpectFalse<
  typeof handlers extends Layer.Layer<unknown, unknown, Setup | Invocation> ? true : false
>
export type KeepsBuildError = ExpectFalse<
  typeof handlers extends Layer.Layer<
    unknown,
    Group.JobGroupConfigurationError,
    Setup | Invocation | Decode
  >
    ? true
    : false
>
const worker = Worker.layer(api, { queues: [{ queue: Queue.make("queue") }] }).pipe(
  Layer.provide(handlers)
)
export type KeepsMissingGroup = ExpectFalse<
  typeof worker extends Layer.Layer<
    unknown,
    unknown,
    Storage.JobStorage | Setup | Invocation | Decode
  >
    ? true
    : false
>
/* oxlint-disable effecttsgo/any-unknown-in-error-context -- Negative calls intentionally violate public generics and use their existential fallback; positive channel assertions above prove no erasure. */
// @ts-expect-error Removed installation API stays absent.
a.toLayer({})
// @ts-expect-error The worker requires a catalog.
export const removedGroupWorker = Worker.make(a, { queues: [] })
// @ts-expect-error Known duplicate names cannot overwrite catalog entries.
api.pipe(Api.addGroup(a))
// @ts-expect-error Every alias must be implemented.
Builder.group(api, "a", (h) => h.handle("run", () => Effect.void))
Builder.group(api, "a", (h) =>
  h
    .handle("run", () => Effect.void)
    // @ts-expect-error Duplicate aliases are unavailable.
    .handle("run", () => Effect.void)
)
export type RejectsDomainError = ExpectFalse<
  (() => Effect.Effect<void, "domain">) extends Parameters<
    Builder.Handlers<typeof b.definitions, "run">["handle"]
  >[1]
    ? true
    : false
>
// @ts-expect-error Unknown group names cannot widen catalog inference.
Builder.group(api, "c", (h) => h)
declare const alias: "run" | "other"
// @ts-expect-error One union-valued choice cannot prove both handlers installed.
Builder.group(api, "a", (h) => h.handle(alias, () => Effect.void))
// @ts-expect-error Unknown aliases cannot widen group inference.
Builder.group(api, "b", (h) => h.handle("missing", () => Effect.void))
/* oxlint-enable effecttsgo/any-unknown-in-error-context */
export const generic = <E, R>(effect: Effect.Effect<void, E, R>) =>
  Builder.group(api, "b", (h) =>
    effect.pipe(Effect.as(h.handle("run", () => Effect.void)))
  )
export function genericHandler<R>(
  handler: (input: {
    readonly payload: number
    readonly context: HandlerContext
  }) => Effect.Effect<void, JobFailure, R>
) {
  return Builder.group(api, "b", (h) => h.handle("run", handler))
}

export const genericBuildChannels: <E, R>(
  effect: Effect.Effect<void, E, R>
) => Layer.Layer<
  Group.Handlers<"b", typeof b.definitions>,
  E | Group.JobGroupConfigurationError,
  R
> = generic
export const genericInvocationChannels: <R>(
  handler: (input: {
    readonly payload: number
    readonly context: HandlerContext
  }) => Effect.Effect<void, JobFailure, R>
) => Layer.Layer<
  Group.Handlers<"b", typeof b.definitions>,
  Group.JobGroupConfigurationError,
  R
> = genericHandler
declare const selected: typeof api | Api.JobApi<"empty", {}>
export const unionWorker = Worker.make(selected, {
  queues: [{ queue: Queue.make("union") }]
})
export const unionChannels: Effect.Effect<
  Worker.JobWorkerService,
  Worker.JobWorkerConfigurationError,
  | Storage.JobStorage
  | Group.Handlers<"a", typeof a.definitions>
  | Group.Handlers<"b", typeof b.definitions>
> = unionWorker
export type UnionRequiresEveryPossibleGroup = ExpectFalse<
  typeof unionWorker extends Effect.Effect<
    unknown,
    unknown,
    Storage.JobStorage | Group.Handlers<"a", typeof a.definitions>
  >
    ? true
    : false
>
