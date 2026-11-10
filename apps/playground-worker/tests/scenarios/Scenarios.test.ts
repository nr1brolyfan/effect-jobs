import { Cause, Effect, Exit, Layer, Result, Schema } from "effect"
import { describe, expect, it } from "vitest"
import * as Codec from "effect-jobs/JobPayloadCodec"
import * as Lifecycle from "effect-jobs/JobLifecycle"
import { JobId } from "effect-jobs/JobId"
import * as Registry from "effect-jobs/JobRegistry"
import * as Policy from "effect-jobs/JobPolicy"
import {
  EnqueueResults,
  JobIntegrityConflict,
  type PreparedJob,
  type EnqueueResult
} from "effect-jobs/JobContract"
import { JobEnqueue, JobBackendError } from "effect-jobs/JobEnqueue"
import { sandbox } from "@effect-jobs/playground-contracts/Fixtures"
import { FakeProvider, RetryRejected } from "../../src/providers/FakeProvider.js"
import * as Provider from "../../src/providers/FakeProviderLayer.js"
import * as Definitions from "../../src/scenarios/Definitions.js"
import * as Handlers from "../../src/scenarios/Handlers.js"
import * as Plan from "../../src/scenarios/Plan.js"
import * as PrivateDocument from "../../src/scenarios/PrivateDocument.js"
import { dashboard } from "../../src/scenarios/Fixtures.js"

const command = {
  sandbox: sandbox.ref,
  requestId: "synthetic-request",
  scenario: "success" as const,
  count: 6
}
const jobs = () => Plan.plan(command, sandbox.ref, 0)
const jobId = Schema.decodeSync(JobId)("synthetic-job")
const unwrap = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) {
    throw new Error("unexpected lifecycle result")
  }
  return result.success
}
const initial = (availableAt = 1000): Lifecycle.JobSnapshot => ({
  jobId,
  policy: Policy.make(),
  state: "Pending",
  availableAt,
  updatedAt: 1000,
  attemptsMade: 0,
  stalledCount: 0,
  lifecycleVersion: 0,
  leaseToken: null,
  leaseExpiresAt: null,
  completedAt: null,
  lastFailureCode: null
})

describe("deterministic application planning", () => {
  it.each([
    ["success", "success"],
    ["deduplication", "success"],
    ["delayed-success", "success"],
    ["isolated", "isolated"],
    ["retry-then-success", "retry-then-success"],
    ["terminal-failure", "dead"],
    ["unknown-outcome", "accepted-response-lost"]
  ] as const)(
    "maps frozen command %s to reproducible %s outcomes",
    async (scenario, expected) => {
      const planned = await Effect.runPromise(
        Plan.plan({ ...command, scenario }, sandbox.ref, 123)
      )
      expect(
        planned.every(
          ({ payload }) =>
            payload.version === 1 && payload.seed === 123 && payload.behavior === expected
        )
      ).toBe(true)
    }
  )
  it("keeps internal traffic producer identities separate from matching manual request IDs", async () => {
    const manual = await Effect.runPromise(Plan.plan(command, sandbox.ref, 0))
    const internal = await Effect.runPromise(
      Plan.plan(command, sandbox.ref, 0, undefined, "private-traffic-v1")
    )
    expect(internal[0]!.producer.operationId).not.toBe(manual[0]!.producer.operationId)
    expect(internal[0]!.payload).toEqual(manual[0]!.payload)
  })
  it("replays a seed/version/request and spans six kinds, four queues and six slots", async () => {
    const first = await Effect.runPromise(jobs())
    expect(await Effect.runPromise(jobs())).toEqual(first)
    expect(first.map((job) => job.workload)).toEqual(Definitions.Workload.literals)
    expect(
      new Set(Definitions.definitions.map((definition) => definition.queue.name)).size
    ).toBe(4)
    expect(new Set(first.map((job) => job.producer.slot)).size).toBe(6)
    expect(
      (await Effect.runPromise(Plan.plan(command, sandbox.ref, 1)))[0]?.workload
    ).toBe("image-processing")
    const batch = await Effect.runPromise(
      Plan.plan({ ...command, count: 10 }, sandbox.ref, 0)
    )
    expect(new Set(batch.map((job) => JSON.stringify(job.producer))).size).toBe(10)
  })

  it("namespaces sandbox/generation/request without arbitrary caller producer IDs", async () => {
    const first = await Effect.runPromise(jobs())
    const nextRef = { ...sandbox.ref, generation: 2 }
    const next = await Effect.runPromise(
      Plan.plan({ ...command, sandbox: nextRef }, nextRef, 0)
    )
    expect(next[0]?.producer).not.toEqual(first[0]?.producer)
    const other = await Effect.runPromise(
      Plan.plan({ ...command, requestId: "other" }, sandbox.ref, 0)
    )
    expect(other[0]?.producer).not.toEqual(first[0]?.producer)
    for (const input of [
      { ...command, count: 11 },
      { ...command, producer: "foreign" },
      { ...command, sandbox: nextRef }
    ]) {
      expect(
        await Effect.runPromise(Effect.flip(Plan.plan(input, sandbox.ref, 0)))
      ).toBeInstanceOf(Plan.InvalidScenario)
    }
  })

  it("uses actual lifecycle eligibility and recovery with repeatable attempt numbers", () => {
    const delayed = initial(2000)
    expect(Result.isFailure(Lifecycle.claim(delayed, "a", 1999, 1))).toBe(true)
    const active = unwrap(Lifecycle.claim(delayed, "a", 2000, 1))
    expect(
      Result.isFailure(Lifecycle.recoverExpired(active, active.leaseExpiresAt! - 1))
    ).toBe(true)
    const recovered = unwrap(Lifecycle.recoverExpired(active, active.leaseExpiresAt!))
    expect(recovered.stalledCount).toBe(1)
    expect(recovered.attemptsMade).toBe(0)
    expect(Lifecycle.attemptNumber(recovered)).toBe(Lifecycle.attemptNumber(active))
    expect(unwrap(Lifecycle.claim(recovered, "b", active.leaseExpiresAt!, 1)).state).toBe(
      "Active"
    )
  })

  it("decodes fixtures for every actual dashboard state and keeps unknown Active", () => {
    expect(new Set(dashboard.map(({ detail }) => detail.job.state))).toEqual(
      new Set(Lifecycle.JobState.literals)
    )
    expect(dashboard.find(({ label }) => label === "unknown")?.detail.job.state).toBe(
      "Active"
    )
    expect(
      dashboard.find(({ label }) => label === "delayed")?.detail.job.availableAt
    ).toBeGreaterThan(1_800_000_000_000)
    expect(JSON.stringify(dashboard)).not.toMatch(
      /ciphertext|fingerprint|leaseToken|synthetic private export/
    )
  })
})

describe("fake provider ledger", () => {
  it.each(Definitions.Workload.literals)(
    "idempotently accepts %s without real provider calls",
    async (workload) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const provider = yield* FakeProvider
          const job = (yield* jobs())[0]!
          const input = {
            ...job,
            sandbox: job.payload.sandbox,
            workload,
            behavior: "success" as const,
            semanticProjection: new Uint8Array([1])
          }
          yield* Effect.all([provider.execute(input), provider.execute(input)], {
            concurrency: 2
          })
          expect(yield* provider.inspect(input)).toEqual({
            source: "mock",
            accepted: true,
            invocations: 2,
            effects: 1
          })
          const conflict = yield* Effect.flip(
            provider.execute({ ...input, semanticProjection: new Uint8Array([2]) })
          )
          expect(conflict._tag).toBe("PayloadConflict")
          expect((yield* provider.inspect(input))?.effects).toBe(1)
        }).pipe(Effect.provide(Provider.layer))
      )
    }
  )

  it("confirms rejection before retry and records acceptance before response loss/recovery", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* FakeProvider
        const job = (yield* jobs())[0]!
        const input = {
          sandbox: job.payload.sandbox,
          producer: job.producer,
          workload: job.workload,
          behavior: "retry-then-success" as const,
          semanticProjection: new Uint8Array([1])
        }
        expect((yield* Effect.flip(provider.execute(input)))._tag).toBe("RetryRejected")
        expect((yield* provider.inspect(input))?.effects).toBe(0)
        yield* provider.execute(input)
        expect((yield* provider.inspect(input))?.effects).toBe(1)
        const lost = {
          ...input,
          producer: Definitions.Producer.identity({
            slot: input.producer.slot,
            operationId: "lost"
          }),
          behavior: "accepted-response-lost" as const
        }
        const failure = yield* Effect.flip(provider.execute(lost))
        expect(Handlers.toJobFailure(failure)._tag).toBe("OutcomeUnknown")
        expect(
          unwrap(Lifecycle.finalizationFromFailure(Handlers.toJobFailure(failure)))
        ).toBeNull()
        expect((yield* provider.inspect(lost))?.accepted).toBe(true)
        yield* provider.execute(lost)
        expect(yield* provider.inspect(lost)).toEqual({
          source: "mock",
          accepted: true,
          invocations: 2,
          effects: 1
        })
        expect(
          yield* provider.inspect({
            ...lost,
            sandbox: { ...lost.sandbox, generation: 2 }
          })
        ).toBeUndefined()
      }).pipe(Effect.provide(Provider.layer))
    )
  })

  it("runs independent identities concurrently, caps storage, and rejects overflow before effects", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* FakeProvider
        const job = (yield* jobs())[0]!
        const inputs = Array.from({ length: 100 }, (_, index) => ({
          sandbox: job.payload.sandbox,
          producer: Definitions.Producer.identity({
            slot: job.producer.slot,
            operationId: `independent-${index}`
          }),
          workload: job.workload,
          behavior: "success" as const,
          semanticProjection: new Uint8Array([index])
        }))
        yield* Effect.all(inputs.map(provider.execute), { concurrency: 10 })
        expect((yield* provider.inspect(inputs[99]!))?.effects).toBe(1)
        const overflow = {
          ...inputs[0]!,
          producer: Definitions.Producer.identity({
            slot: job.producer.slot,
            operationId: "overflow"
          })
        }
        expect((yield* Effect.flip(provider.execute(overflow)))._tag).toBe("LedgerFull")
        expect(yield* provider.inspect(overflow)).toBeUndefined()
      }).pipe(Effect.provide(Provider.layer))
    )
  })
})

describe("encrypted consumer payload and installed handlers", () => {
  it.each(["defect", "interrupt"] as const)(
    "preserves mixed provider rejection plus %s instead of inferring a safe retry",
    async (kind) => {
      const mixed = Cause.combine(
        Cause.fail(new RetryRejected()),
        kind === "defect" ? Cause.die("synthetic-defect") : Cause.interrupt()
      )
      const providerLayer = Layer.succeed(
        FakeProvider,
        FakeProvider.of({
          execute: () => Effect.failCause(mixed),
          inspect: () => Effect.succeed(undefined)
        })
      )
      const payload = (await Effect.runPromise(jobs()))[0]!.payload
      const producer = Definitions.Producer.identity({
        operationId: "mixed",
        slot: "welcome-email"
      })
      const result = await Effect.runPromiseExit(
        Handlers.execute("welcome-email")({
          payload,
          context: {
            jobId,
            catalog: Definitions.WelcomeEmail.catalog,
            producer,
            attemptNumber: 1
          }
        }).pipe(Effect.provide(providerLayer))
      )
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        expect(result.cause.reasons).toHaveLength(2)
        expect(Cause.hasFails(result.cause)).toBe(true)
        expect(Cause.hasDies(result.cause)).toBe(kind === "defect")
        expect(Cause.hasInterrupts(result.cause)).toBe(kind === "interrupt")
      }
    }
  )
  it("rejects a private document under fresh keys and mismatched tenant before provider acceptance", async () => {
    const payload = await Effect.runPromise(
      Effect.map(jobs(), (planned) => Plan.exportPayload(planned[3]!.payload))
    )
    const artifact = await Effect.runPromise(
      Codec.encodeJobPayload(Definitions.ExportPayload, payload).pipe(
        Effect.provide(PrivateDocument.keysLayer)
      )
    )
    const failure = await Effect.runPromise(
      Effect.flip(Codec.decodeJobPayload(Definitions.ExportPayload, artifact)).pipe(
        Effect.provide(PrivateDocument.keysLayer)
      )
    )
    expect(failure._tag).toBe("JobPayloadCodecError")
    await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* FakeProvider
        const producer = Definitions.Producer.identity({
          operationId: "wrong-tenant",
          slot: "private-data-export"
        })
        const result = yield* Effect.flip(
          Handlers.executeExport({
            payload: { ...payload, tenant: "demo-tenant-a" },
            context: {
              jobId,
              catalog: Definitions.PrivateDataExport.catalog,
              producer,
              attemptNumber: 1
            }
          })
        )
        expect(result._tag).toBe("Isolate")
        expect(
          yield* provider.inspect({ sandbox: payload.sandbox, producer })
        ).toBeUndefined()
      }).pipe(Effect.provide(Layer.merge(Provider.layer, PrivateDocument.keysLayer)))
    )
  })

  it.each(["retry-then-success", "accepted-response-lost"] as const)(
    "executes %s through installed handlers and actual lifecycle plans",
    async (behavior) => {
      const dependencies = Layer.mergeAll(
        Provider.layer,
        PrivateDocument.keysLayer,
        Registry.layer
      )
      await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* Registry.JobRegistry
          const provider = yield* FakeProvider
          const job = (yield* jobs())[0]!
          const payload = { ...job.payload, behavior }
          const encoded = yield* Codec.encodeJobPayload(Definitions.Payload, payload)
          const handler = registry.find(Definitions.WelcomeEmail.catalog)!
          const context = {
            jobId,
            catalog: Definitions.WelcomeEmail.catalog,
            producer: job.producer,
            attemptNumber: 1
          }
          const active = unwrap(Lifecycle.claim(initial(), "a", 1000, 1))
          const failure = yield* Effect.flip(handler.execute(encoded, context))
          expect(failure._tag).toBe(
            behavior === "retry-then-success" ? "Retry" : "OutcomeUnknown"
          )
          const finalization = unwrap(Lifecycle.finalizationFromFailure(failure))
          const waiting =
            finalization === null
              ? unwrap(Lifecycle.recoverExpired(active, active.leaseExpiresAt!))
              : unwrap(
                  Lifecycle.finalize(
                    active,
                    unwrap(Lifecycle.ownershipOf(active)),
                    finalization,
                    1001
                  )
                )
          const resumedAt =
            finalization === null ? active.leaseExpiresAt! : waiting.availableAt
          const resumed = unwrap(Lifecycle.claim(waiting, "b", resumedAt, 1))
          expect(Lifecycle.attemptNumber(resumed)).toBe(finalization === null ? 1 : 2)
          yield* handler.execute(encoded, {
            ...context,
            attemptNumber: Lifecycle.attemptNumber(resumed)
          })
          const completed = unwrap(
            Lifecycle.finalize(
              resumed,
              unwrap(Lifecycle.ownershipOf(resumed)),
              Lifecycle.JobFinalizations.Complete(),
              resumedAt + 1
            )
          )
          expect(completed.state).toBe("Completed")
          expect(
            (yield* provider.inspect({
              sandbox: payload.sandbox,
              producer: job.producer
            }))?.effects
          ).toBe(1)
        }).pipe(
          Effect.provide(Handlers.layerNoDeps.pipe(Layer.provideMerge(dependencies)))
        )
      )
    }
  )

  it("encrypts typed private data with stable semantic equality and detects tampering", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const payload = Plan.exportPayload((yield* jobs())[3]!.payload)
        const one = yield* Codec.encodeJobPayload(Definitions.ExportPayload, payload)
        const two = yield* Codec.encodeJobPayload(Definitions.ExportPayload, payload)
        expect(one.payloadBytes).not.toEqual(two.payloadBytes)
        expect(one.semanticProjectionBytes).toEqual(two.semanticProjectionBytes)
        expect(new TextDecoder().decode(one.payloadBytes)).not.toContain(
          payload.document.note
        )
        expect(new TextDecoder().decode(one.semanticProjectionBytes)).not.toContain(
          payload.document.note
        )
        expect(yield* Codec.decodeJobPayload(Definitions.ExportPayload, one)).toEqual(
          payload
        )
        const changed = yield* Codec.encodeJobPayload(Definitions.ExportPayload, {
          ...payload,
          document: { ...payload.document, note: "changed synthetic document" }
        })
        expect(changed.semanticProjectionBytes).not.toEqual(one.semanticProjectionBytes)
        const wire = JSON.parse(new TextDecoder().decode(one.payloadBytes))
        wire.document.ciphertext[0] ^= 1
        const tampered = {
          ...one,
          payloadBytes: new TextEncoder().encode(JSON.stringify(wire))
        }
        const failure = yield* Effect.flip(
          Codec.decodeJobPayload(Definitions.ExportPayload, tampered)
        )
        expect(failure._tag).toBe("JobPayloadCodecError")
        expect(JSON.stringify(failure)).not.toContain(payload.document.note)
      }).pipe(Effect.provide(PrivateDocument.keysLayer))
    )
  })

  it("captures actual prepared bytes through enqueue and propagates changed-payload conflicts", async () => {
    // Public producer port mock, not a PG transaction or atomicity qualification.
    const stored = new Map<string, PreparedJob>()
    const enqueueLayer = Layer.succeed(
      JobEnqueue,
      JobEnqueue.of({
        enqueue: (prepare) =>
          Effect.flatMap(prepare, (prepared) =>
            Effect.suspend<EnqueueResult, JobIntegrityConflict, never>(() => {
              const id = JSON.stringify(prepared.producer)
              const previous = stored.get(id)
              if (previous) {
                if (
                  JSON.stringify(Array.from(previous.encoded.semanticProjectionBytes)) !==
                  JSON.stringify(Array.from(prepared.encoded.semanticProjectionBytes))
                ) {
                  return Effect.fail(new JobIntegrityConflict())
                }
                return Effect.succeed(EnqueueResults.AlreadyPresent({ jobId }))
              }
              stored.set(id, prepared)
              return Effect.succeed(EnqueueResults.Inserted({ jobId }))
            })
          ),
        enqueueStandalone: () =>
          Effect.fail(
            new JobBackendError({
              reason: "unqualified-backend",
              commitKnowledge: "NotCommitted"
            })
          )
      })
    )
    await Effect.runPromise(
      Effect.gen(function* () {
        const planned = (yield* jobs())[3]!
        expect((yield* Plan.enqueue(planned))._tag).toBe("Inserted")
        expect((yield* Plan.enqueue(planned))._tag).toBe("AlreadyPresent")
        expect(
          (yield* Effect.flip(
            Plan.enqueue({
              ...planned,
              payload: { ...planned.payload, order: "demo-order-a" }
            })
          ))._tag
        ).toBe("JobIntegrityConflict")
        const prepared = [...stored.values()][0]!
        expect(prepared.catalog).toEqual(Definitions.SyntheticDocumentExport.catalog)
        expect(
          yield* Codec.decodeJobPayload(
            Definitions.SyntheticExportPayload,
            prepared.encoded
          )
        ).toEqual(Plan.exportPayload(planned.payload))
        const bytes = prepared.encoded.payloadBytes
        expect(new TextDecoder().decode(bytes)).not.toContain("synthetic private export")
      }).pipe(Effect.provide(enqueueLayer))
    )
  })

  it("installs all six handlers through the public registry and maps known terminal/invariant outcomes", async () => {
    const dependencies = Layer.mergeAll(
      Provider.layer,
      PrivateDocument.keysLayer,
      Registry.layer
    )
    const installed = Handlers.layerNoDeps.pipe(Layer.provideMerge(dependencies))
    await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* Registry.JobRegistry
        const planned = yield* jobs()
        for (let index = 0; index < Definitions.definitions.length; index++) {
          const definition = Definitions.definitions[index]!
          const job = planned[index % planned.length]!
          const encoded =
            definition === Definitions.SyntheticDocumentExport
              ? yield* Codec.encodeJobPayload(Definitions.SyntheticExportPayload, {
                  ...job.payload,
                  document: {
                    subject: job.payload.actor,
                    tenant: job.payload.tenant,
                    note: "Synthetic fixture"
                  }
                })
              : definition === Definitions.PrivateDataExport
                ? yield* Codec.encodeJobPayload(
                    Definitions.ExportPayload,
                    Plan.exportPayload(job.payload)
                  )
                : yield* Codec.encodeJobPayload(Definitions.Payload, job.payload)
          yield* registry.find(definition.catalog)!.execute(encoded, {
            jobId,
            catalog: definition.catalog,
            producer:
              definition === Definitions.SyntheticDocumentExport
                ? Definitions.Producer.identity({
                    slot: job.producer.slot,
                    operationId: "synthetic-document-fixture"
                  })
                : job.producer,
            attemptNumber: 1
          })
        }
        for (const [behavior, expected] of [
          ["dead", "Dead"],
          ["isolated", "Isolate"]
        ] as const) {
          const job = planned[0]!
          const encoded = yield* Codec.encodeJobPayload(Definitions.Payload, {
            ...job.payload,
            behavior
          })
          const failure = yield* Effect.flip(
            registry.find(Definitions.WelcomeEmail.catalog)!.execute(encoded, {
              jobId,
              catalog: Definitions.WelcomeEmail.catalog,
              producer: Definitions.Producer.identity({
                slot: job.producer.slot,
                operationId: behavior
              }),
              attemptNumber: 1
            })
          )
          expect(failure._tag).toBe(expected)
          const finalization = unwrap(Lifecycle.finalizationFromFailure(failure))!
          const active = unwrap(Lifecycle.claim(initial(), "a", 1000, 1))
          expect(
            unwrap(
              Lifecycle.finalize(
                active,
                unwrap(Lifecycle.ownershipOf(active)),
                finalization,
                1001
              )
            ).state
          ).toBe(expected === "Dead" ? "Dead" : "Isolated")
        }
      }).pipe(Effect.provide(installed))
    )
  })
})
