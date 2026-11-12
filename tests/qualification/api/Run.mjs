/** Current packed public types plus real local encrypted-service runtime. */
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { publicModules } from "../../../scripts/SourceExports.mjs"
const root = resolve(import.meta.dirname, "../../..")
const archive = resolve(process.env.EFFECT_JOBS_ARCHIVE)
const work = mkdtempSync(join(tmpdir(), "effect-jobs-public-api-"))
const run = (name, command, args) => {
  const result = spawnSync(command, args, {
    cwd: work,
    timeout: 60000,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  })
  writeFileSync(join(work, `${name}.log`), (result.stdout ?? "") + (result.stderr ?? ""))
  assert.equal(result.status, 0, `${name} failed; retained log ${work}`)
}
writeFileSync(
  join(work, "package.json"),
  JSON.stringify(
    {
      private: true,
      type: "module",
      dependencies: {
        "effect-jobs": `file:${archive}`,
        effect: "4.1.0",
        "drizzle-orm": process.env.DRIZZLE_ORM_VERSION ?? "1.0.0-rc.5",
        typescript: "7.0.2",
        "@types/node": "26.4.1"
      }
    },
    null,
    2
  ) + "\n"
)
run("install", "npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"])
const sourceToPublic = new Map(
  publicModules(JSON.parse(readFileSync(join(root, "package.json"), "utf8"))).map(
    (module) => [
      module.source.replace(/\.ts$/, ".js"),
      module.subpath === "." ? "effect-jobs" : `effect-jobs/${module.name}`
    ]
  )
)
const publicImports = (code) =>
  code.replace(/"(?:\.\.\/)+(src\/[^"\n]+\.js)"/g, (_match, source) => {
    const specifier = sourceToPublic.get(source)
    assert(specifier, `Not a public source import: ${source}`)
    return JSON.stringify(specifier)
  })
writeFileSync(
  join(work, "EncryptedFixture.mts"),
  publicImports(readFileSync(join(root, "tests/core/codec/EncryptedFixture.ts"), "utf8"))
)
writeFileSync(
  join(work, "ProducerBindings.mts"),
  publicImports(readFileSync(join(root, "tests/types/producer-bindings.ts"), "utf8"))
)
const types = publicImports(
  readFileSync(join(root, "tests/types/api-refinements.ts"), "utf8")
).replace('"../core/codec/EncryptedFixture.js"', '"./EncryptedFixture.mjs"')
writeFileSync(join(work, "Types.mts"), types)
for (const [source, target] of [
  ["catalog", "CatalogTypes"],
  ["catalog-group-selection", "GroupSelectionTypes"],
  ["groups", "BuilderTypes"],
  ["schedule", "ScheduleTypes"],
  ["worker", "WorkerTypes"],
  ["group-worker", "GroupWorkerTypes"],
  ["producer-binding", "ProducerTypes"],
  ["definitions", "DefinitionTypes"],
  ["persistence-names", "PersistenceNames"]
]) {
  writeFileSync(
    join(work, target + ".mts"),
    publicImports(readFileSync(join(root, "tests/types/" + source + ".ts"), "utf8"))
  )
}
writeFileSync(
  join(work, "Retry.mts"),
  publicImports(readFileSync(join(root, "tests/types/retry-policy.ts"), "utf8"))
)
writeFileSync(
  join(work, "Operators.mts"),
  publicImports(readFileSync(join(root, "tests/types/operators.ts"), "utf8"))
)
writeFileSync(
  join(work, "Repairs.mts"),
  publicImports(readFileSync(join(root, "tests/types/repair-operators.ts"), "utf8"))
)
// Keep full strict upstream declaration checking for the non-Drizzle new API.
const nonDrizzle = types
  .slice(0, types.indexOf("makeJobTables({"))
  .replace(/^import .*from "drizzle-orm(?:\/pg-core)?"\n/gm, "")
  .replace(/^import \{ makeJobTables \}.*\n/gm, "")
writeFileSync(join(work, "Strict.mts"), nonDrizzle)
writeFileSync(
  join(work, "Runtime.mts"),
  `import * as JobApi from "effect-jobs/JobApi"
import * as JobApiBuilder from "effect-jobs/JobApiBuilder"

import assert from "node:assert/strict"
import { Cause, Duration, Effect, Exit, Layer, Result, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as Queue from "effect-jobs/JobQueue"
import * as Policy from "effect-jobs/JobPolicy"
import * as Retry from "effect-jobs/JobRetryPolicy"
import * as Codes from "effect-jobs/FailureCode"
import { JobFailures } from "effect-jobs/JobFailure"
import { JobEnqueue, JobPersistenceError } from "effect-jobs/JobEnqueue"
import * as EnqueueModule from "effect-jobs/JobEnqueue"
import * as JobsModule from "effect-jobs/PostgreSqlJobs"
import { EnqueueResult, type PreparedJob } from "effect-jobs/JobContract"
import { JobOperators, JobOperatorExpected } from "effect-jobs/JobOperators"
import { JobId } from "effect-jobs/JobId"
import * as Group from "effect-jobs/JobGroup"
import * as Producer from "effect-jobs/JobProducer"
import * as Storage from "effect-jobs/JobStorage"
import * as Worker from "effect-jobs/JobWorker"
import * as Store from "effect-jobs/JobStore"
import * as Schedule from "effect-jobs/JobSchedule"
import * as Polling from "effect-jobs/JobPolling"
import { encodeJobPayload, decodeJobPayload } from "effect-jobs/JobPayloadCodec"
import { DocumentKeys, EncryptedDocument, keys, keysLayer } from "./EncryptedFixture.mjs"
for (const name of ["JobRegistry", "JobConsumer", "JobPlan", "JobWorkerRuntime", "PollingJobWorker"]) {
  await assert.rejects(import("effect-jobs/" + name), {
    code: process.versions.bun ? "ERR_MODULE_NOT_FOUND" : "ERR_PACKAGE_PATH_NOT_EXPORTED"
  })
}
assert.equal("JobBackendError" in EnqueueModule, false)
assert.equal("Backend" in JobsModule, false)
assert.equal(new JobPersistenceError({ reason: "unqualified-storage", commitKnowledge: "NotCommitted" })._tag, "JobPersistenceError")
assert.equal(typeof JobOperators.of, "function")
assert(Schema.is(JobOperatorExpected)({ jobId: "fixture", state: "Pending", lifecycleVersion: 0 }))
const code = Codes.define({ boundary: "a".repeat(128) }).boundary
assert.equal(JobFailures.Retry({ code }).code.length, 128)
assert(Result.isFailure(Codes.parse("a".repeat(129))))
assert(Object.isFrozen(Policy.defaultPolicy.retrySchedule))
const retry = Retry.exponential(Duration.seconds(1)).pipe(Retry.capped(Duration.minutes(1)), Retry.jittered(), Retry.maxFinalizedAttempts(5))
const retryPolicy = await Effect.runPromise(Policy.make({ retry }))
assert.equal(retryPolicy.maxFinalizedAttempts, 5)
assert.equal(retryPolicy.retrySchedule._tag, "BackoffV1")
assert.equal(retryPolicy.retrySchedule.jitter, "ProportionalV1")
assert.deepEqual(Schema.decodeUnknownSync(Policy.PersistedJobPolicy)(JSON.parse(JSON.stringify(Schema.encodeSync(Policy.PersistedJobPolicy)(retryPolicy)))) , retryPolicy)
const invalidRetry = Retry.exponential(Duration.seconds(1), { factor: 0 })
const invalidExit = await Effect.runPromiseExit(Policy.make({ retry: invalidRetry }))
assert(Exit.isFailure(invalidExit))
assert.equal(invalidExit.cause.reasons.length, 1)
const invalidReason = invalidExit.cause.reasons[0]!
assert(Cause.isFailReason(invalidReason))
assert(invalidReason.error instanceof Policy.JobPolicyConfigurationError)
assert.equal(invalidReason.error.field, "retry.factor")
for (const removed of [{ retryDelay: Duration.seconds(5) }, { maxAttempts: 3 }]) {
  const exit = await Effect.runPromiseExit(Policy.make(removed as unknown as Policy.JobPolicyOptions))
  assert(Exit.isFailure(exit))
  assert.equal(exit.cause.reasons.length, 1)
  const reason = exit.cause.reasons[0]!
  assert(Cause.isFailReason(reason))
  assert(reason.error instanceof Policy.JobPolicyConfigurationError)
  assert.equal(reason.error.field, "options")
}
const queue = Queue.make("billing")
const definition = Effect.runSync(Job.make({ name: "receipt", payload: Schema.Struct({ invoiceId: Schema.String, document: EncryptedDocument }) }))
const producer = Effect.runSync(Producer.make("billing.issue").pipe(Producer.withSlot("receipt", definition, { queue })))
assert.equal(Object.keys(Effect.runSync(Producer.make("empty.operation")).slots).length, 0)
assert.equal(producer.operation, "billing.issue")
assert.throws(() => Effect.runSync(Producer.make({ operation: "removed", slots: {} } as never)), { _tag: "JobDeclarationError" })
const dynamicSlot: string = "receipt"
assert.throws(() => Effect.runSync(Effect.succeed(producer).pipe(Producer.withSlot(dynamicSlot, definition, { queue }))), { _tag: "JobDeclarationError" })
assert.equal("replaceSlot" in Producer, false)
assert.equal("build" in producer, false)
const catalog = { queue: queue.name, name: definition.name, version: definition.version }
assert.equal(definition.version, 1)
const input = { operationId: "id", slot: "receipt" as const,
  payload: { invoiceId: "public", document: { recipient: "PRIVATE fixture", total: 12n } } }
const prepared: PreparedJob[] = []
const enqueueService = JobEnqueue.of({ enqueue: (prepare) => prepare.pipe(Effect.map((value) => {
  prepared.push(value); return EnqueueResult.Inserted({ jobId: Schema.decodeSync(JobId)("fixture-job") })
})), enqueueStandalone: () => Effect.die("fake enqueueService does not qualify transactions") })
for (const active of ["one", "one", "two"]) await Effect.runPromise(producer.enqueue(input).pipe(Effect.provideService(JobEnqueue, enqueueService), Effect.provide(keysLayer(keys(active)))))
assert.notDeepEqual(prepared[0]!.encoded.payloadBytes, prepared[1]!.encoded.payloadBytes)
assert.deepEqual(prepared[0]!.encoded.semanticProjectionBytes, prepared[1]!.encoded.semanticProjectionBytes)
assert.deepEqual(prepared[0]!.encoded.semanticProjectionBytes, prepared[2]!.encoded.semanticProjectionBytes)
assert(!new TextDecoder().decode(prepared[0]!.encoded.payloadBytes).includes("PRIVATE"))
assert.deepEqual(await Effect.runPromise(decodeJobPayload(definition.payload, prepared[0]!.encoded).pipe(Effect.provide(keysLayer(keys("two"))))), input.payload)
const priority = Queue.make("billing-priority")
const selectable = Effect.runSync(Producer.make(producer.operation).pipe(Producer.withSlot("receipt", definition, { queues: [queue, priority] })))
const overridePolicy = { ...Policy.defaultPolicy, maxFinalizedAttempts: 7 }
await Effect.runPromise(selectable.enqueue({ ...input, queue: priority.name, policy: overridePolicy }).pipe(Effect.provideService(JobEnqueue, enqueueService), Effect.provide(keysLayer(keys()))))
assert.equal(prepared[3]!.catalog.queue, priority.name)
assert.equal(prepared[3]!.policy.maxFinalizedAttempts, 7)
assert.equal(prepared[3]!.producer.slot, input.slot)
assert.equal(producer.slots.receipt.queue.name, queue.name)
for (const invalid of [{ queue: queue.name }, { queue: undefined }, { queue }, { queue: { name: "INVALID/queue" } }, { policy: { ...overridePolicy, maxFinalizedAttempts: 0 } }]) {
  const result = await Effect.runPromiseExit(producer.enqueue({ ...input, ...invalid } as never).pipe(Effect.provideService(JobEnqueue, enqueueService), Effect.provide(keysLayer(keys()))))
  assert(Exit.isFailure(result))
  assert.equal(result.cause.reasons[0]!._tag, "Fail")
}
assert.equal(prepared.length, 4)
let calls = 0
const group = Group.make("installed-receipts", { receipt: definition })
const handler = JobApiBuilder.group(JobApi.make(group.name).pipe(JobApi.addGroup(group)), group.name, (_handlers) => _handlers.handle("receipt", (input) => Effect.sync(() => { assert.equal(input.payload.document.total, 12n); calls++ }))).pipe(Layer.provide(keysLayer(keys())))
await Effect.runPromise(Effect.gen(function* () {
   const handlers = yield* group.handlers
   const context = { jobId: yield* Schema.decodeEffect(JobId)("fixture-job"), catalog, producer: prepared[0]!.producer, nextFinalizationNumber: 1 }
   yield* handlers.receipt(prepared[0]!.encoded, context)
  const bad = { ...prepared[0]!.encoded, payloadBytes: new TextEncoder().encode("{}") }
   yield* Effect.flip(handlers.receipt(bad, context))
}).pipe(Effect.provide(handler)))
assert.equal(calls, 1)
let claims = 0
const storageLayer = Storage.layer({ operationResponseBudgetMillis: 100, store: {
  claim: () => Effect.sync(() => { claims++; return Store.ClaimResult.Empty() }),
  reconcileClaim: () => Effect.succeed(Store.ClaimReconciliation.Unknown()),
  release: () => Effect.succeed(Store.FinalizationResult.Unknown()),
  finalize: () => Effect.succeed(Store.FinalizationResult.Unknown()),
  reconcileFinalization: () => Effect.succeed(Store.FinalizationReconciliation.Unknown()),
  recoverExpired: () => Effect.succeed(0)
} })
const workerLayer = Worker.layer(JobApi.make(group.name).pipe(JobApi.addGroup(group)), { queues: [{ queue }] }).pipe(Layer.provide(Layer.mergeAll(handler, storageLayer)))
assert.equal(claims, 0)
assert.deepEqual(await Effect.runPromise(Worker.drain(queue).pipe(Effect.provide(workerLayer))), { _tag: "Idle", claimed: 0, recovered: 0 })
assert.equal(claims, 1)
await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  yield* Layer.build(Polling.layer([queue], { maxJobs: 1, shutdownGraceMillis: 0 }).pipe(Layer.provide(workerLayer)))
  yield* Effect.yieldNow
})))
assert.equal(claims, 2)
const scheduleLayer = Schedule.layer({ read: (request) => Effect.sync(() => {
  assert.equal(request.queue, queue.name)
  assert.deepEqual(request.supportedCatalog, [catalog])
  assert.equal(request.limit, 100)
  return { observedAt: 1000, nextAvailableAt: 1200, nextRecoveryAt: null, saturated: false }
}) })
assert.deepEqual(await Effect.runPromise(Schedule.observe(group, queue).pipe(Effect.provide(scheduleLayer))), { observedAt: 1000, nextAvailableAt: 1200, nextRecoveryAt: null, saturated: false })
const missing = await Effect.runPromiseExit(Effect.void.pipe(Effect.provide(keysLayer({ ...keys(), active: "missing" }))))
assert.equal(missing._tag, "Failure")
console.log("Installed new API literals/brands/defaults, local AES-GCM/HMAC service rotation and handler boundary PASS")
`
)
const compilerOptions = {
  target: "ES2022",
  module: "NodeNext",
  moduleResolution: "NodeNext",
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  skipLibCheck: true,
  types: ["node"],
  outDir: "compiled"
}
writeFileSync(
  join(work, "tsconfig.json"),
  JSON.stringify({ compilerOptions, include: ["*.mts"] }, null, 2) + "\n"
)
writeFileSync(
  join(work, "tsconfig.strict.json"),
  JSON.stringify(
    {
      compilerOptions: { ...compilerOptions, skipLibCheck: false, noEmit: true },
      include: [
        "Strict.mts",
        "Retry.mts",
        "EncryptedFixture.mts",
        "Runtime.mts",
        "Operators.mts",
        "Repairs.mts",
        "CatalogTypes.mts",
        "GroupSelectionTypes.mts",
        "BuilderTypes.mts",
        "WorkerTypes.mts",
        "GroupWorkerTypes.mts",
        "ScheduleTypes.mts",
        "ProducerTypes.mts",
        "DefinitionTypes.mts"
      ]
    },
    null,
    2
  ) + "\n"
)
run("public-types", "node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"])
run("strict-core", "node", [
  "node_modules/typescript/bin/tsc",
  "-p",
  "tsconfig.strict.json"
])
// Negative controls compile the exact maintained fixture with expect-error lines
// stripped. Each graph must reject removed APIs and invalid/incomplete builders.
const catalogNegative = readFileSync(join(work, "CatalogTypes.mts"), "utf8").replace(
  /^.*@ts-expect-error.*\n/gm,
  ""
)
writeFileSync(join(work, "CatalogNegative.mts"), catalogNegative)
writeFileSync(
  join(work, "tsconfig.negative.json"),
  JSON.stringify({
    compilerOptions: { ...compilerOptions, noEmit: true },
    include: ["CatalogNegative.mts"]
  })
)
const negative = spawnSync(
  "node",
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.negative.json"],
  { cwd: work, timeout: 60000, encoding: "utf8" }
)
writeFileSync(
  join(work, "catalog-negative.log"),
  (negative.stdout ?? "") + (negative.stderr ?? "")
)
assert.equal(negative.status, 1)
const negativeDiagnostics = [
  ...(negative.stdout ?? "").matchAll(
    /^CatalogNegative\.mts\(\d+,\d+\): error TS(\d+):/gm
  )
]
assert.equal(negativeDiagnostics.length, 9)
assert(
  negativeDiagnostics.every((entry) =>
    ["2322", "2339", "2739", "2345"].includes(entry[1])
  )
)
for (const proof of ["toLayer", "JobApi", "Complete", "missing"]) {
  assert((negative.stdout ?? "").includes(proof), `Missing negative diagnostic ${proof}`)
}
// Preserve the original catalog negatives above. These additional controls prove
// that inferred/explicit unions, unresolved generics and broad strings cannot
// turn one installation into simultaneous output of every possible service.
writeFileSync(
  join(work, "GroupSelectionNegative.mts"),
  readFileSync(join(work, "GroupSelectionTypes.mts"), "utf8").replace(
    /^.*@ts-expect-error.*\n/gm,
    ""
  )
)
writeFileSync(
  join(work, "tsconfig.group-selection-negative.json"),
  JSON.stringify({
    compilerOptions: { ...compilerOptions, noEmit: true, incremental: false },
    include: ["GroupSelectionNegative.mts"]
  })
)
const groupSelectionNegative = spawnSync(
  "node",
  [
    "node_modules/typescript/bin/tsc",
    "-p",
    "tsconfig.group-selection-negative.json",
    "--noEmit",
    "--incremental",
    "false"
  ],
  { cwd: work, timeout: 60000, encoding: "utf8" }
)
writeFileSync(
  join(work, "group-selection-negative.log"),
  (groupSelectionNegative.stdout ?? "") + (groupSelectionNegative.stderr ?? "")
)
assert.equal(groupSelectionNegative.status, 1)
const selectionDiagnostics = [
  ...(groupSelectionNegative.stdout ?? "").matchAll(
    /^GroupSelectionNegative\.mts\(\d+,\d+\): error TS(\d+):/gm
  )
]
assert.equal(selectionDiagnostics.length, 5)
assert(selectionDiagnostics.every((entry) => entry[1] === "2345"))
assert((groupSelectionNegative.stdout ?? "").includes("never"))
for (const runtime of ["node", "bun"]) {
  run(`${runtime}-runtime`, runtime, ["compiled/Runtime.mjs"])
}
writeFileSync(
  join(work, "receipt.json"),
  JSON.stringify(
    {
      archiveSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
      publicTypes: "PASS",
      catalogNegativeControls: "PASS rejected stripped expect-error fixture",
      groupSelectionControls:
        "PASS five stripped union/generic/broad-name rejections; literal composition preserves missing services",
      strictCoreDeclarations: "PASS skipLibCheck:false",
      drizzleDeclarations:
        "skipLibCheck:true; upstream limitation separately recorded by native runner",
      runtimes: ["node", "bun"]
    },
    null,
    2
  ) + "\n"
)
console.log(`Packed new API qualification PASS; receipts ${work}`)
