import { Cause, Context, Effect, Exit, Layer, Schema, SchemaGetter } from "effect"
import { describe, expect, it } from "vitest"
import * as Job from "../../../src/Job.js"
import * as JobConsumer from "../../../src/JobConsumer.js"
import * as JobProducer from "../../../src/JobProducer.js"
import * as JobQueue from "../../../src/JobQueue.js"
import * as JobRegistry from "../../../src/JobRegistry.js"
import {
  EnqueueResults,
  JobPayloadCodecError,
  type EncodedJobPayload,
  type HandlerContext,
  type JobPayloadDecoder,
  type JobPayloadEncoder,
  type PreparedJob
} from "../../../src/JobContract.js"
import { JobFailures } from "../../../src/JobFailure.js"
import { JobId } from "../../../src/JobId.js"
import { InvalidOperationId, JobDeclarationError } from "../../../src/JobIdentity.js"
import * as JobPolicy from "../../../src/JobPolicy.js"
import type { JobsTransaction, JobEnqueueError } from "../../../src/JobTransaction.js"
import { withJoinedTransaction } from "../../../src/internal/JobTransaction.js"

const queue = JobQueue.make("billing")
const producer = JobProducer.make({ operation: "billing.issue", slots: ["pdf", "email"] })
const identity = producer.identity({ operationId: "operation", slot: "pdf" })
const policy = JobPolicy.make()
const jobId = Schema.decodeSync(JobId)("generated-id")
// Deliberately opaque test fixtures: only forwarding is qualified here, not codec bytes.
const encoded: EncodedJobPayload = {
  formatVersion: 1,
  payloadBytes: new Uint8Array([1]),
  semanticProjectionBytes: new Uint8Array([2])
}
const encode: JobPayloadEncoder = () => Effect.succeed(encoded)
const job = Job.make({
  queue,
  kind: "invoice.generate",
  version: 1,
  payload: Schema.Struct({ amount: Schema.Finite }),
  encodePayload: encode
})
const input = { producer: identity, payload: { amount: 1.5 }, policy }
const context: HandlerContext = {
  jobId,
  catalog: job.catalog,
  producer: identity,
  attemptNumber: 1
}
const failure = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.flip(effect)

describe("immutable declarations", () => {
  it("copies and freezes slots without freezing or retaining caller configuration", () => {
    const slots = ["pdf", "email"]
    const options = { operation: "billing.issue", slots }
    const declaration = JobProducer.make(options)
    slots[0] = "sms"
    options.operation = "changed"
    expect(declaration.operation).toBe("billing.issue")
    expect(declaration.slots).toEqual(["pdf", "email"])
    expect(Object.isFrozen(declaration)).toBe(true)
    expect(Object.isFrozen(declaration.slots)).toBe(true)
    expect(
      Object.isFrozen(declaration.identity({ operationId: "op", slot: "pdf" }))
    ).toBe(true)
    expect(() => declaration.identity({ operationId: "op", slot: "sms" })).toThrow(
      JobDeclarationError
    )
  })

  it.each([
    { operation: "Bad", slots: ["pdf"] },
    { operation: "ok", slots: [] },
    { operation: "ok", slots: ["pdf", "pdf"] },
    { operation: "ok", slots: ["pdf", "Bad"] }
  ])("validates declarations synchronously: %j", (options) => {
    expect(() => JobProducer.make(options)).toThrow(JobDeclarationError)
  })

  it.each(["", "secret\u0000value", "\ud800", "x".repeat(257)])(
    "rejects private operation IDs without echo",
    (operationId) => {
      let caught: unknown
      try {
        producer.identity({ operationId, slot: "pdf" })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(InvalidOperationId)
      expect(JSON.stringify(caught)).not.toContain("secret")
      expect(caught).not.toHaveProperty("operationId")
    }
  )

  it("preserves exact IDs and validates queue/catalog boundaries", () => {
    expect(producer.identity({ operationId: " Opé ", slot: "email" }).operationId).toBe(
      " Opé "
    )
    expect(() => JobQueue.make("Bad")).toThrow(JobQueue.InvalidJobQueue)
    expect(() => JobQueue.make("x".repeat(65))).toThrow(JobQueue.InvalidJobQueue)
    expect(() =>
      Job.make({
        queue,
        kind: "Bad",
        version: 1,
        payload: Schema.String,
        encodePayload: encode
      })
    ).toThrow(Job.InvalidJobDefinition)
    expect(() =>
      Job.make({
        queue,
        kind: "ok",
        version: 0,
        payload: Schema.String,
        encodePayload: encode
      })
    ).toThrow(Job.InvalidJobDefinition)
    expect(Object.isFrozen(queue)).toBe(true)
    expect(Object.isFrozen(job)).toBe(true)
    expect(Object.isFrozen(job.catalog)).toBe(true)
  })
})

describe("explicit transaction enqueue", () => {
  it("snapshots metadata before encoding can yield or mutate caller options", async () => {
    const mutable = {
      producer: {
        operation: identity.operation,
        operationId: identity.operationId,
        slot: identity.slot
      },
      policy: { ...policy, retrySchedule: { ...policy.retrySchedule } },
      availableAt: 12,
      payload: "value"
    }
    const definition = Job.make({
      queue,
      kind: "snapshot",
      version: 1,
      payload: Schema.String,
      encodePayload: () =>
        Effect.sync(() => {
          mutable.producer.operationId = "changed"
          mutable.policy.retrySchedule.delayMillis = 99
          mutable.availableAt = 99
          return encoded
        })
    })
    let prepared: PreparedJob | undefined
    await Effect.runPromise(
      withJoinedTransaction(
        (value) => {
          prepared = value
          return Effect.succeed(EnqueueResults.Inserted({ jobId }))
        },
        (tx) => definition.enqueue(tx, mutable)
      )
    )
    expect(prepared).toMatchObject({
      producer: identity,
      availableAt: 12,
      policy: { retrySchedule: { delayMillis: 5000 } }
    })
  })
  it("forwards complete prepared input and returns the backend's provisional result", async () => {
    let prepared: PreparedJob | undefined
    const result = await Effect.runPromise(
      withJoinedTransaction(
        (value) => {
          prepared = value
          return Effect.succeed(EnqueueResults.Inserted({ jobId }))
        },
        (tx) => job.enqueue(tx, { ...input, availableAt: 12 })
      )
    )
    expect(result).toEqual(EnqueueResults.Inserted({ jobId }))
    expect(prepared).toEqual({
      catalog: job.catalog,
      producer: identity,
      policy,
      availableAt: 12,
      encoded
    })
    expect(prepared).not.toHaveProperty("jobId")
    expect(prepared?.encoded).toBe(encoded)
    expect(prepared?.producer).not.toBe(identity)
    expect(prepared?.policy).not.toBe(policy)
    expect(Object.isFrozen(prepared?.policy.retrySchedule)).toBe(true)
  })

  it("does not invent availability, deduplication equality, or a generated ID", async () => {
    let prepared: PreparedJob | undefined
    const result = await Effect.runPromise(
      withJoinedTransaction(
        (value) => {
          prepared = value
          return Effect.succeed(EnqueueResults.AlreadyPresent({ jobId }))
        },
        (tx) => job.enqueue(tx, input)
      )
    )
    expect(result.jobId).toBe(jobId)
    expect(prepared).not.toHaveProperty("availableAt")
    expect(job).not.toHaveProperty("unsafeEnqueue")
  })

  it("rejects invalid bounded metadata before encoding or insertion", async () => {
    let calls = 0
    const definition = Job.make({
      queue,
      kind: "test",
      version: 1,
      payload: Schema.String,
      encodePayload: () => {
        calls++
        return Effect.succeed(encoded)
      }
    })
    for (const [invalid, field] of [
      [
        {
          ...input,
          payload: "ok",
          producer: {
            operation: identity.operation,
            operationId: "private\u0000id",
            slot: identity.slot
          }
        },
        "producer"
      ],
      [{ ...input, payload: "ok", policy: { ...policy, maxAttempts: 0 } }, "policy"],
      [{ ...input, payload: "ok", availableAt: 0 }, "availableAt"]
    ] as const) {
      const error = await Effect.runPromise(
        failure(
          withJoinedTransaction(
            () => {
              calls++
              return Effect.succeed(EnqueueResults.Inserted({ jobId }))
            },
            (tx) => definition.enqueue(tx, invalid)
          )
        )
      )
      expect(error).toMatchObject({ _tag: "InvalidJobInput", field })
      expect(JSON.stringify(error)).not.toContain("private")
    }
    expect(calls).toBe(0)
  })

  it("preserves codec and backend failures without insertion/reclassification", async () => {
    let inserts = 0
    const definition = Job.make({
      queue,
      kind: "test",
      version: 1,
      payload: Schema.String,
      encodePayload: () =>
        Effect.fail(new JobPayloadCodecError({ reason: "invalid-schema" }))
    })
    const error = await Effect.runPromise(
      failure(
        withJoinedTransaction(
          () => {
            inserts++
            return Effect.succeed(EnqueueResults.Inserted({ jobId }))
          },
          (tx) => definition.enqueue(tx, { ...input, payload: "x" })
        )
      )
    )
    expect(error).toEqual(new JobPayloadCodecError({ reason: "invalid-schema" }))
    expect(inserts).toBe(0)
    expect(
      await Effect.runPromise(
        failure(
          withJoinedTransaction(
            () => Effect.fail("backend-failure"),
            (tx) => job.enqueue(tx, input)
          )
        )
      )
    ).toBe("backend-failure")
  })

  it("escaped and deferred enqueues cannot call a closed backend", async () => {
    let escaped: JobsTransaction | undefined
    let deferred:
      | Effect.Effect<
          import("../../../src/JobContract.js").EnqueueResult,
          JobEnqueueError
        >
      | undefined
    let calls = 0
    await Effect.runPromise(
      withJoinedTransaction(
        () => {
          calls++
          return Effect.succeed(EnqueueResults.Inserted({ jobId }))
        },
        (tx) =>
          Effect.sync(() => {
            escaped = tx
            deferred = job.enqueue(tx, input)
          })
      )
    )
    expect(await Effect.runPromise(failure(job.enqueue(escaped!, input)))).toMatchObject({
      _tag: "JobsTransactionClosed",
      reason: "callback-exited"
    })
    expect(await Effect.runPromise(failure(deferred!))).toMatchObject({
      _tag: "JobsTransactionClosed"
    })
    expect(calls).toBe(0)
  })
})

describe("local registry and Layer dependencies", () => {
  class HandlerService extends Context.Service<
    HandlerService,
    { readonly amount: number }
  >()("tests/definitions/HandlerService") {}

  it("carries Schema encoding services and captures independent decoding services", async () => {
    class Encoding extends Context.Service<Encoding, { readonly prefix: string }>()(
      "tests/definitions/Encoding"
    ) {}
    class Decoding extends Context.Service<Decoding, { readonly suffix: string }>()(
      "tests/definitions/Decoding"
    ) {}
    const schema = Schema.String.pipe(
      Schema.decodeTo(Schema.String, {
        encode: SchemaGetter.transformEffect((value: string) =>
          Effect.map(Encoding, ({ prefix }) => prefix + value)
        ),
        decode: SchemaGetter.transformEffect((value: string) =>
          Effect.map(Decoding, ({ suffix }) => value + suffix)
        )
      })
    )
    let wire: unknown
    const serviceEncode: JobPayloadEncoder = (payloadSchema, value) =>
      Schema.encodeEffect(payloadSchema)(value).pipe(
        Effect.map((value) => {
          wire = value
          return encoded
        }),
        Effect.mapError(() => new JobPayloadCodecError({ reason: "invalid-schema" }))
      )
    const definition = Job.make({
      queue,
      kind: "services",
      version: 1,
      payload: schema,
      encodePayload: serviceEncode
    })
    await Effect.runPromise(
      withJoinedTransaction(
        () => Effect.succeed(EnqueueResults.Inserted({ jobId })),
        (tx) => definition.enqueue(tx, { ...input, payload: "payload" })
      ).pipe(Effect.provideService(Encoding, { prefix: "encoded:" }))
    )
    expect(wire).toBe("encoded:payload")
    const serviceDecode: JobPayloadDecoder = (payloadSchema) =>
      Schema.decodeUnknownEffect(payloadSchema)(wire).pipe(
        Effect.mapError(() => new JobPayloadCodecError({ reason: "invalid-schema" }))
      )
    let received: string | undefined
    const installation = definition
      .handlerLayer(
        ({ payload }) =>
          Effect.sync(() => {
            received = payload
          }),
        serviceDecode
      )
      .pipe(Layer.provide(Layer.succeed(Decoding, { suffix: ":decoded" })))
    await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* JobRegistry.JobRegistry
        yield* registry
          .find(definition.catalog)!
          .execute(encoded, { ...context, catalog: definition.catalog })
      }).pipe(
        Effect.provide(
          Layer.merge(
            JobRegistry.layer,
            installation.pipe(Layer.provide(JobRegistry.layer))
          )
        )
      )
    )
    expect(received).toBe("encoded:payload:decoded")
  })

  it("fails duplicate Layers and leaves defects/interruption unclassified", async () => {
    const decode: JobPayloadDecoder = (schema) =>
      Schema.decodeEffect(schema)({ amount: 1 }).pipe(
        Effect.mapError(() => new JobPayloadCodecError({ reason: "invalid-schema" }))
      )
    const first = job.handlerLayer(() => Effect.void, decode)
    const second = job.handlerLayer(() => Effect.void, decode)
    const error = await Effect.runPromise(
      failure(
        Effect.void.pipe(
          Effect.provide(
            Layer.merge(first, second).pipe(Layer.provide(JobRegistry.layer))
          )
        )
      )
    )
    expect(error).toBeInstanceOf(JobRegistry.DuplicateJobHandler)
    for (const execute of [() => Effect.die("handler-defect"), () => Effect.interrupt]) {
      const installation = job.handlerLayer(execute, decode)
      const exit = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* JobRegistry.JobRegistry
          return yield* Effect.exit(registry.find(job.catalog)!.execute(encoded, context))
        }).pipe(
          Effect.provide(
            Layer.merge(
              JobRegistry.layer,
              installation.pipe(Layer.provide(JobRegistry.layer))
            )
          )
        )
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.hasFails(exit.cause)).toBe(false)
      }
    }
  })

  it("captures handler services, decodes before dispatch and keeps minimal context", async () => {
    let received: unknown
    const decode: JobPayloadDecoder = (schema) =>
      Schema.decodeEffect(schema)({ amount: 1.5 }).pipe(
        Effect.mapError(() => new JobPayloadCodecError({ reason: "invalid-schema" }))
      )
    const installation = job
      .handlerLayer(
        (value) =>
          Effect.gen(function* () {
            const service = yield* HandlerService
            received = value
            expect(service.amount).toBe(value.payload.amount)
          }),
        decode
      )
      .pipe(Layer.provide(Layer.succeed(HandlerService, { amount: 1.5 })))
    await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* JobRegistry.JobRegistry
        yield* registry.find(job.catalog)!.execute(encoded, context)
      }).pipe(
        Effect.provide(
          Layer.merge(
            JobRegistry.layer,
            installation.pipe(Layer.provide(JobRegistry.layer))
          )
        )
      )
    )
    expect(received).toEqual({ payload: { amount: 1.5 }, context })
  })

  it("does not run handler after decode failure and preserves mapped handler outcomes", async () => {
    let calls = 0
    const decodeFailure: JobPayloadDecoder = () =>
      Effect.fail(new JobPayloadCodecError({ reason: "projection-mismatch" }))
    const installation = job.handlerLayer(() => {
      calls++
      return Effect.void
    }, decodeFailure)
    const program = Effect.gen(function* () {
      const registry = yield* JobRegistry.JobRegistry
      return yield* failure(registry.find(job.catalog)!.execute(encoded, context))
    })
    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.merge(
            JobRegistry.layer,
            installation.pipe(Layer.provide(JobRegistry.layer))
          )
        )
      )
    )
    expect(result).toEqual(new JobPayloadCodecError({ reason: "projection-mismatch" }))
    expect(calls).toBe(0)
    const decode: JobPayloadDecoder = (schema) =>
      Schema.decodeEffect(schema)({ amount: 1 }).pipe(
        Effect.mapError(() => new JobPayloadCodecError({ reason: "invalid-schema" }))
      )
    const mapped = job.handlerLayer(
      () => Effect.fail(JobFailures.OutcomeUnknown({ code: "response_lost" })),
      decode
    )
    expect(
      await Effect.runPromise(
        program.pipe(
          Effect.provide(
            Layer.merge(JobRegistry.layer, mapped.pipe(Layer.provide(JobRegistry.layer)))
          )
        )
      )
    ).toEqual(JobFailures.OutcomeUnknown({ code: "response_lost" }))
  })

  it("detects duplicate handler installation with catalog diagnostics", async () => {
    const error = await Effect.runPromise(
      failure(
        Effect.gen(function* () {
          const registry = yield* JobRegistry.JobRegistry
          const handler = { catalog: job.catalog, execute: () => Effect.void }
          yield* registry.install(handler)
          yield* registry.install(handler)
        }).pipe(Effect.provide(JobRegistry.layer))
      )
    )
    expect(error).toMatchObject({
      _tag: "DuplicateJobHandler",
      queue: job.catalog.queue,
      kind: job.catalog.kind,
      version: job.catalog.version
    })
    expect(error.message).toContain("one handler")
  })

  it("isolates registry builds and distinguishes versions/queues", async () => {
    const install = Effect.gen(function* () {
      const registry = yield* JobRegistry.JobRegistry
      for (const catalog of [
        job.catalog,
        { queue: job.catalog.queue, kind: job.catalog.kind, version: 2 },
        { queue: "other", kind: job.catalog.kind, version: job.catalog.version }
      ]) {
        yield* registry.install({ catalog, execute: () => Effect.void })
        expect(registry.find(catalog)).toBeDefined()
      }
    }).pipe(Effect.provide(JobRegistry.layer))
    await Effect.runPromise(install)
    await Effect.runPromise(install)
    expect(
      await Effect.runPromise(
        Effect.map(JobRegistry.JobRegistry, (registry) =>
          registry.find(job.catalog)
        ).pipe(Effect.provide(JobRegistry.layer))
      )
    ).toBeUndefined()
  })

  it("rejects duplicate catalog entries, while preserving different versions", async () => {
    const second = Job.make({
      queue,
      kind: job.kind,
      version: 2,
      payload: job.payload,
      encodePayload: encode
    })
    const entries = await Effect.runPromise(JobRegistry.catalog(job, second))
    expect(entries).toEqual([job, second])
    expect(Object.isFrozen(entries)).toBe(true)
    const duplicate = Job.make({
      queue: JobQueue.make("billing"),
      kind: job.kind,
      version: 1,
      payload: job.payload,
      encodePayload: encode
    })
    expect(
      await Effect.runPromise(failure(JobRegistry.catalog(job, duplicate)))
    ).toMatchObject({
      _tag: "DuplicateJobCatalogEntry",
      queue: job.catalog.queue,
      kind: job.catalog.kind,
      version: job.catalog.version
    })
  })
})

describe("bounded consumer plans", () => {
  const options = { localConcurrency: 1, claimLimitPerRun: 10, recoveryLimitPerRun: 10 }
  it("creates frozen inert consumer/plan configuration", async () => {
    const consumer = await Effect.runPromise(JobConsumer.make(queue, options))
    const configured = await Effect.runPromise(JobConsumer.plan(consumer))
    expect(consumer).toEqual({ queue, ...options })
    expect(Object.isFrozen(consumer)).toBe(true)
    expect(Object.isFrozen(configured)).toBe(true)
    expect(Object.isFrozen(configured.consumers)).toBe(true)
  })
  it.each([
    { ...options, localConcurrency: 0 },
    { ...options, localConcurrency: 65 },
    { ...options, claimLimitPerRun: 0 },
    { ...options, claimLimitPerRun: 10001 },
    { ...options, recoveryLimitPerRun: 0 },
    { ...options, recoveryLimitPerRun: 10001 },
    { ...options, localConcurrency: 1.5 },
    { ...options, extra: true }
  ])("rejects invalid options %j", async (invalid) => {
    expect(await Effect.runPromise(failure(JobConsumer.make(queue, invalid)))).toEqual(
      new JobConsumer.InvalidJobConsumer({ reason: "invalid-options" })
    )
  })
  it("accepts upper bounds and detects duplicate logical queues", async () => {
    const consumer = await Effect.runPromise(
      JobConsumer.make(queue, {
        localConcurrency: 64,
        claimLimitPerRun: 10000,
        recoveryLimitPerRun: 10000
      })
    )
    const duplicate = await Effect.runPromise(
      JobConsumer.make(JobQueue.make("billing"), options)
    )
    expect(
      await Effect.runPromise(failure(JobConsumer.plan(consumer, duplicate)))
    ).toMatchObject({ _tag: "DuplicateJobConsumer", queue: "billing" })
    const other = await Effect.runPromise(
      JobConsumer.make(JobQueue.make("other"), options)
    )
    expect(
      (await Effect.runPromise(JobConsumer.plan(consumer, other))).consumers
    ).toEqual([consumer, other])
  })
})
