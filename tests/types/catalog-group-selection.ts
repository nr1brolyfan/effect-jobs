import { Effect, Layer, Schema } from "effect"
import * as Api from "../../src/JobApi.js"
import * as Group from "../../src/JobGroup.js"
import * as Worker from "../../src/JobWorker.js"
import * as Storage from "../../src/JobStorage.js"
import * as Queue from "../../src/JobQueue.js"
import type { HandlerContext } from "../../src/JobContract.js"

const a = Effect.runSync(
  Group.make("a", { run: { name: "a", version: 1, payload: Schema.String } })
)
const b = Effect.runSync(
  Group.make("b", { run: { name: "b", version: 1, payload: Schema.String } })
)
const api = Effect.runSync(Api.make("app").pipe(Api.addGroup(a), Api.addGroup(b)))
const options = { queues: [{ queue: Effect.runSync(Queue.make("queue")) }] }
const one = Group.handlers(a, (h) =>
  h.handle("run", (input) => {
    const payload: string = input.payload
    const context: HandlerContext = input.context
    void payload
    void context
    return Effect.void
  })
)
const two = Group.handlers(b, (h) => h.handle("run", () => Effect.void))
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

const picked = Effect.runSync(Api.pick(api, ["a"]))
export const selectedGroup: typeof a = picked.groups.a
// @ts-expect-error Unselected groups are absent.
export const missingGroup = picked.groups.b
const pickedWorker = Worker.layer(picked, options).pipe(Layer.provide(one))
export const onlySelectedGroup: Layer.Layer<
  Worker.JobWorker,
  Worker.JobWorkerConfigurationError | Group.JobGroupConfigurationError,
  Storage.JobStorage
> = pickedWorker

declare const selectedGroupName: Group.JobGroup<"a" | "b", typeof a.definitions>
/* oxlint-disable effecttsgo/any-unknown-in-error-context -- The invalid installer call deliberately falls back to existential requirements. */
// @ts-expect-error One group can install only its own service.
Group.handlers(selectedGroupName, (h) => h.handle("run", () => Effect.void))
/* oxlint-enable effecttsgo/any-unknown-in-error-context */
// @ts-expect-error One group cannot add two possible group names.
Api.addGroup(selectedGroupName)

declare const selected: "a" | "b"
declare const alternativeLists: readonly ["a"] | readonly ["b"]
declare const variableLength: ReadonlyArray<"a" | "b">
// @ts-expect-error A missing group cannot be picked.
void Api.pick(api, ["c"])
// @ts-expect-error One dynamic name cannot assert that both groups are present.
void Api.pick(api, [selected])
// @ts-expect-error A variable-length array does not prove every possible name is present.
void Api.pick(api, variableLength)
// @ts-expect-error Alternative tuples also do not prove every listed group is selected.
void Api.pick(api, alternativeLists)
export function narrowedSelection(name: "a" | "b") {
  return name === "a" ? Api.pick(api, [name]) : Api.pick(api, [name])
}
