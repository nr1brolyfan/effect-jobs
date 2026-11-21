// Shared lazy declarations for the workload and its inert wiring test.
import { Duration, Effect, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as Queue from "effect-jobs/JobQueue"
import * as Producer from "effect-jobs/JobProducer"
import * as Group from "effect-jobs/JobGroup"
import * as Api from "effect-jobs/JobApi"
import * as Policy from "effect-jobs/JobPolicy"

export const make = (options) =>
  Effect.gen(function* () {
    const queues = yield* Effect.forEach(
      Array.from({ length: options.queues }, (_, index) => index),
      (index) => Queue.make(`soak.q${index}`)
    )
    // One pure contract per name/version, reused across queue routes.
    // parseOptions fixes this maintained workload to exactly two kinds.
    const kind0 = yield* Job.make({
      name: "soak.kind0",
      payload: Schema.Struct({ data: Schema.String })
    })
    const kind1 = yield* Job.make({
      name: "soak.kind1",
      payload: Schema.Struct({ data: Schema.String })
    })
    const definitions = [kind0, kind1]
    const routes = queues.flatMap((queue) =>
      definitions.map((definition) => ({ queue, definition }))
    )
    const group = yield* Group.make("soak", { kind0, kind1 })
    const catalog = yield* Api.make("soak").pipe(Api.addGroup(group))
    const makeProducers = (operation) =>
      Effect.forEach(routes, (route) =>
        Producer.make(operation).pipe(
          Producer.withSlot("work", route.definition, { queue: route.queue })
        )
      )
    const producers = {
      "soak.load": yield* makeProducers("soak.load"),
      "soak.history": yield* makeProducers("soak.history")
    }
    const churnPolicy = yield* Policy.make({
      completedRetention: Duration.seconds(options.churnRetentionSeconds)
    })
    return {
      queues,
      definitions,
      routes,
      group,
      catalog,
      producers,
      churnPolicy
    }
  })
