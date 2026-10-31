/** Current packed public types plus real local encrypted-service runtime. */
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
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
const publicImports = (code) =>
  code.replace(/"(?:\.\.\/)+src\/([^"/]+)\.js"/g, '"effect-jobs/$1"')
writeFileSync(
  join(work, "EncryptedFixture.mts"),
  publicImports(readFileSync(join(root, "tests/core/codec/EncryptedFixture.ts"), "utf8"))
)
const types = publicImports(
  readFileSync(join(root, "tests/types/api-refinements.ts"), "utf8")
).replace('"../core/codec/EncryptedFixture.js"', '"./EncryptedFixture.mjs"')
writeFileSync(join(work, "Types.mts"), types)
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
  `
import assert from "node:assert/strict"
import { Cause, Duration, Effect, Exit, Layer, Result, Schema } from "effect"
import * as Job from "effect-jobs/Job"
import * as Queue from "effect-jobs/JobQueue"
import * as Policy from "effect-jobs/JobPolicy"
import * as Retry from "effect-jobs/JobRetryPolicy"
import * as Codes from "effect-jobs/FailureCode"
import { JobFailures } from "effect-jobs/JobFailure"
import { JobEnqueue } from "effect-jobs/JobEnqueue"
import { EnqueueResults, type PreparedJob } from "effect-jobs/JobContract"
import { JobOperators, JobOperatorExpected } from "effect-jobs/JobOperators"
import { JobId } from "effect-jobs/JobId"
import * as Registry from "effect-jobs/JobRegistry"
import { encodeJobPayload, decodeJobPayload } from "effect-jobs/JobPayloadCodec"
import { DocumentKeys, EncryptedDocument, keys, keysLayer } from "./EncryptedFixture.mjs"
assert.equal(typeof JobOperators.of, "function")
assert(Schema.is(JobOperatorExpected)({ jobId: "fixture", state: "Pending", lifecycleVersion: 0 }))
const code = Codes.define({ boundary: "a".repeat(128) }).boundary
assert.equal(JobFailures.Retry({ code }).code.length, 128)
assert(Result.isFailure(Codes.parse("a".repeat(129))))
assert(Object.isFrozen(Policy.defaultPolicy.retrySchedule))
const retry = Retry.exponential(Duration.seconds(1)).pipe(Retry.capped(Duration.minutes(1)), Retry.jittered(), Retry.maxAttempts(5))
const retryPolicy = await Effect.runPromise(Policy.make({ retry }))
assert.equal(retryPolicy.maxAttempts, 5)
assert.equal(retryPolicy.retrySchedule._tag, "BackoffV1")
assert.equal(retryPolicy.retrySchedule.jitter, "ProportionalV1")
assert.deepEqual(Schema.decodeUnknownSync(Policy.PersistedJobPolicy)(JSON.parse(JSON.stringify(retryPolicy))), retryPolicy)
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
const definition = Job.make({ queue: Queue.make("billing"), kind: "receipt", payload: Schema.Struct({ invoiceId: Schema.String, document: EncryptedDocument }) })
assert.equal(definition.version, 1)
const input = { producer: { operation: "billing.issue", operationId: "id", slot: "receipt" }, policy: Policy.defaultPolicy,
  payload: { invoiceId: "public", document: { recipient: "PRIVATE fixture", total: 12n } } }
const prepared: PreparedJob[] = []
const backend = JobEnqueue.of({ enqueue: (prepare) => prepare.pipe(Effect.map((value) => {
  prepared.push(value); return EnqueueResults.Inserted({ jobId: Schema.decodeSync(JobId)("fixture-job") })
})), enqueueStandalone: () => Effect.die("fake backend does not qualify transactions") })
for (const active of ["one", "one", "two"]) await Effect.runPromise(definition.enqueue(input).pipe(Effect.provideService(JobEnqueue, backend), Effect.provide(keysLayer(keys(active)))))
assert.notDeepEqual(prepared[0]!.encoded.payloadBytes, prepared[1]!.encoded.payloadBytes)
assert.deepEqual(prepared[0]!.encoded.semanticProjectionBytes, prepared[1]!.encoded.semanticProjectionBytes)
assert.deepEqual(prepared[0]!.encoded.semanticProjectionBytes, prepared[2]!.encoded.semanticProjectionBytes)
assert(!new TextDecoder().decode(prepared[0]!.encoded.payloadBytes).includes("PRIVATE"))
assert.deepEqual(await Effect.runPromise(decodeJobPayload(definition.payload, prepared[0]!.encoded).pipe(Effect.provide(keysLayer(keys("two"))))), input.payload)
let calls = 0
const reg = Registry.layer
const handler = definition.handlerLayer(({ payload }) => Effect.sync(() => { assert.equal(payload.document.total, 12n); calls++ }), decodeJobPayload).pipe(Layer.provide(keysLayer(keys())), Layer.provide(reg))
await Effect.runPromise(Effect.gen(function* () {
  const registry = yield* Registry.JobRegistry
  const context = { jobId: yield* Schema.decodeEffect(JobId)("fixture-job"), catalog: definition.catalog, producer: input.producer, attemptNumber: 1 }
  yield* registry.find(definition.catalog)!.execute(prepared[0]!.encoded, context)
  const bad = { ...prepared[0]!.encoded, payloadBytes: new TextEncoder().encode("{}") }
  yield* Effect.flip(registry.find(definition.catalog)!.execute(bad, context))
}).pipe(Effect.provide(Layer.merge(reg, handler))))
assert.equal(calls, 1)
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
        "Repairs.mts"
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
for (const runtime of ["node", "bun"]) {
  run(`${runtime}-runtime`, runtime, ["compiled/Runtime.mjs"])
}
writeFileSync(
  join(work, "receipt.json"),
  JSON.stringify(
    {
      archiveSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
      publicTypes: "PASS",
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
