import { Context, Effect, Layer } from "effect"
import { expect, it } from "vitest"
import * as Definitions from "../../src/scenarios/Definitions.js"

it("shares one lazy definitions graph across producer and worker consumers", async () => {
  class ProducerView extends Context.Service<ProducerView, Definitions.Setup>()(
    "tests/setup/ProducerView"
  ) {}
  class WorkerView extends Context.Service<WorkerView, Definitions.Setup>()(
    "tests/setup/WorkerView"
  ) {}
  let constructions = 0
  const shared = Layer.effect(
    Definitions.Definitions,
    Definitions.make.pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          constructions++
        })
      )
    )
  )
  const producer = Layer.effect(ProducerView, Definitions.Definitions).pipe(
    Layer.provide(shared)
  )
  const worker = Layer.effect(WorkerView, Definitions.Definitions).pipe(
    Layer.provide(shared)
  )
  expect(constructions).toBe(0)
  await Effect.runPromise(
    Effect.gen(function* () {
      const producer = yield* ProducerView
      const worker = yield* WorkerView
      expect(producer).toBe(worker)
      expect(producer.PrivateDataExport).toBe(worker.definitions[3])
      expect(producer.PrivateDataExport.payload).toBe(worker.ExportPayload)
      expect(producer.SyntheticDocumentExport.payload).toBe(worker.SyntheticExportPayload)
      expect(constructions).toBe(1)
    }).pipe(Effect.provide(Layer.mergeAll(producer, worker)))
  )
  expect(constructions).toBe(1)
})
