import { Effect, Layer, Schema } from "effect"
import * as Api from "../../src/JobApi.js"
import * as Builder from "../../src/JobApiBuilder.js"
import * as Group from "../../src/JobGroup.js"
import * as Worker from "../../src/JobWorker.js"
import * as Storage from "../../src/JobStorage.js"
import * as Queue from "../../src/JobQueue.js"
import type { HandlerContext } from "../../src/JobContract.js"

const a = Group.make("a", { run: { name: "a", version: 1, payload: Schema.String } })
const b = Group.make("b", { run: { name: "b", version: 1, payload: Schema.String } })
const api = Api.make("app").pipe(Api.addGroup(a), Api.addGroup(b))
const options = { queues: [{ queue: Queue.make("queue") }] }
const one = Builder.group(api, "a", (h) =>
  h.handle("run", (input) => {
    const payload: string = input.payload
    const context: HandlerContext = input.context
    void payload
    void context
    return Effect.void
  })
)
const two = Builder.group(api, "b", (h) => h.handle("run", () => Effect.void))
export const literalOutput: Layer.Layer<
  Group.Handlers<"a", typeof a.definitions>,
  Group.JobGroupConfigurationError
> = one
const incomplete = Worker.layer(api, options).pipe(Layer.provide(one))
export const literalKeepsOtherGroup: Layer.Layer<
  Worker.JobWorker,
  Worker.JobWorkerConfigurationError | Group.JobGroupConfigurationError,
  Storage.JobStorage | Group.Handlers<"b", typeof b.definitions>
> = incomplete
type ExpectFalse<T extends false> = T
export type CannotDischargeOtherGroup = ExpectFalse<
  typeof incomplete extends Layer.Layer<unknown, unknown, Storage.JobStorage>
    ? true
    : false
>
export const complete: Layer.Layer<
  Worker.JobWorker,
  Worker.JobWorkerConfigurationError | Group.JobGroupConfigurationError,
  Storage.JobStorage
> = Worker.layer(api, options).pipe(Layer.provide(Layer.mergeAll(one, two)))

/* oxlint-disable effecttsgo/any-unknown-in-error-context -- Intentionally invalid union/generic selections fall back to existential constraints; the literal output assertions above retain concrete services. */
declare const selected: "a" | "b"
// @ts-expect-error One dynamic union selection cannot install both groups.
Builder.group(api, selected, (h) => h.handle("run", () => Effect.void))
Builder.group<
  "app",
  typeof api.groups,
  "a" | "b",
  Builder.Handlers<typeof a.definitions, never>
>(
  api,
  // @ts-expect-error Explicit union type arguments cannot bypass singleton selection.
  selected,
  (h) => h.handle("run", () => Effect.void)
)
export function unresolved<K extends "a" | "b">(name: K) {
  // @ts-expect-error An unresolved generic may select either group.
  return Builder.group(api, name, (h) => h.handle("run", () => Effect.void))
}
export function explicitUnresolved<K extends "a" | "b">(name: K) {
  return Builder.group<
    "app",
    typeof api.groups,
    K,
    Builder.Handlers<typeof a.definitions, never>
  >(
    api,
    // @ts-expect-error Explicit unresolved generics cannot promise every variant.
    name,
    (h) => h.handle("run", () => Effect.void)
  )
}
declare const widened: Api.JobApi<"app", Api.Groups>
declare const broad: string
// @ts-expect-error A broad string is not a statically selected declaration.
Builder.group(widened, broad, (h) => h.handle("run", () => Effect.void))
/* oxlint-enable effecttsgo/any-unknown-in-error-context */
