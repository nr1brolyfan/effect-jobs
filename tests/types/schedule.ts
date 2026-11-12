import { Context, Effect, Layer, Schema } from "effect"
import * as Schedule from "../../src/JobSchedule.js"
import * as Group from "../../src/JobGroup.js"
import * as Queue from "../../src/JobQueue.js"

class Source extends Context.Service<Source, {}>()("types/schedule/Source") {}
class Keys extends Context.Service<Keys, {}>()("types/schedule/Keys") {}
declare const schema: Schema.Codec<string, string, Keys>
declare const reader: Schedule.Reader<"provider-error", Source>
const group = Group.make("schedule", {
  run: { name: "run", version: 1, payload: schema }
})
const queue = Queue.make("schedule")

export const configured: Layer.Layer<Schedule.JobSchedule, never, Source> =
  Schedule.layer(reader)
export const observed: Effect.Effect<
  Schedule.Observation,
  Schedule.JobScheduleProtocolError | Schedule.JobScheduleUnavailable,
  Schedule.JobSchedule
> = Schedule.observe(group, queue)
export const captured: Effect.Effect<
  Schedule.Observation,
  Schedule.JobScheduleProtocolError | Schedule.JobScheduleUnavailable,
  Source
> = observed.pipe(Effect.provide(configured))
// @ts-expect-error Sampling is read-only, not a drain configuration.
export const noConcurrency = Schedule.observe(group, queue, { concurrency: 2 })
// @ts-expect-error Observation requires a JobQueue, not a raw queue string.
export const noRawQueue = Schedule.observe(group, "schedule")
type ExpectFalse<T extends false> = T
export type SourceIsRequired = ExpectFalse<
  typeof captured extends Effect.Effect<unknown, unknown> ? true : false
>
