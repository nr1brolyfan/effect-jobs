import { Cause, Context, Effect, Exit, Schema } from "effect"
import { afterEach, expect, test, vi } from "vitest"
import * as Jobs from "../../../src/PostgreSqlJobs.js"
import * as Operators from "../../../src/internal/postgresql/Operators.js"
import {
  PostgreSqlApplication,
  PostgreSqlFailure,
  PostgreSqlInvalidHandle
} from "../../../src/PostgreSqlTransaction.js"
import type {
  ApplicationAdapter,
  PostgreSqlError
} from "../../../src/PostgreSqlTransaction.js"
import {
  JobOperatorExpected,
  JobOperatorRejected,
  JobOperators
} from "../../../src/JobOperators.js"
import type { JobOperatorsService } from "../../../src/JobOperators.js"
import type { JobBackendError } from "../../../src/JobEnqueue.js"
import type {
  JobOperatorTransition,
  JobRedriveResult
} from "../../../src/JobOperators.js"
import { JobIntegrityConflict, JobPayloadCodecError } from "../../../src/JobContract.js"
import { defaultPolicy } from "../../../src/JobPolicy.js"

const expected = Schema.decodeSync(JobOperatorExpected)({
  jobId: "source",
  state: "Dead",
  lifecycleVersion: 4
})
const definition = {
  catalog: { queue: "billing", name: "invoice", version: 1 },
  payload: Schema.Struct({ value: Schema.String })
}
const request = {
  expected,
  producer: { operation: "manual", operationId: "new", slot: "replacement" }
}
const adapter: ApplicationAdapter = {
  ambient: Effect.succeed({ query: () => Effect.die("unexpected query") }),
  validate: () => Effect.die("unexpected validate"),
  withTransaction: (body) => body({}),
  ownedTransaction: () => Effect.die("unexpected owned transaction")
}
const options = { operationResponseBudgetMillis: 100 }
const invoke = (
  service: JobOperatorsService<JobBackendError>,
  method: Method
): Effect.Effect<
  JobOperatorTransition | JobRedriveResult,
  JobBackendError | JobOperatorRejected | JobPayloadCodecError | JobIntegrityConflict
> =>
  method === "correctedRedrive"
    ? service.correctedRedrive(definition, { ...request, payload: { value: "fixed" } })
    : method === "redrive"
      ? service.redrive(definition, request)
      : service[method](expected)
const paths = ["layerNoDeps", "withTransaction"] as const
const methods = ["retryNow", "cancel", "redrive", "correctedRedrive"] as const
type Method = (typeof methods)[number]
type OperatorError = PostgreSqlError | JobOperatorRejected
const Diagnostic = Context.Reference<string>("test/operator-diagnostic", {
  defaultValue: () => "absent"
})
const failure = new PostgreSqlFailure({ commitKnowledge: "Unknown" })
const rejected = new JobOperatorRejected({ reason: "not-eligible" })
const defect = new Error("synthetic finalizer defect")
const cases: ReadonlyArray<readonly [string, Cause.Cause<OperatorError>]> = [
  ["unknown PostgreSQL failure", Cause.fail(failure)],
  [
    "not-committed PostgreSQL failure",
    Cause.fail(new PostgreSqlFailure({ commitKnowledge: "NotCommitted" }))
  ],
  ...(
    [
      "active-transaction",
      "inactive-handle",
      "foreign-source",
      "unqualified-handle"
    ] as const
  ).map(
    (reason) => [reason, Cause.fail(new PostgreSqlInvalidHandle({ reason }))] as const
  ),
  ["rejection", Cause.fail(rejected)],
  [
    "mixed multiple reasons",
    Cause.fromReasons<OperatorError>([
      Cause.makeFailReason(failure),
      Cause.makeDieReason(defect),
      Cause.makeFailReason(rejected),
      Cause.makeFailReason(new PostgreSqlInvalidHandle({ reason: "inactive-handle" })),
      Cause.makeInterruptReason(321)
    ])
  ],
  ["pure defect", Cause.die(defect)],
  ["pure interruption", Cause.interrupt(321)]
]

// Inject the raw operator result only; exercise the real public composition and
// translation. The original encrypted-decoder probe covers the unmocked backend.
const run = async (
  path: (typeof paths)[number],
  method: Method,
  service: JobOperatorsService<PostgreSqlError>
) => {
  vi.spyOn(Operators, "makeOperators").mockReturnValue(service)
  const operation = Effect.flatMap(JobOperators, (operators) => invoke(operators, method))
  const program =
    path === "layerNoDeps"
      ? operation.pipe(Effect.provide(Jobs.layerNoDeps(options)))
      : Effect.flatMap(Jobs.make(options), (backend) =>
          backend.withTransaction(() => operation)
        )
  return Effect.runPromiseExit(
    program.pipe(Effect.provideService(PostgreSqlApplication, adapter))
  )
}
const serviceFor = (
  cause: Cause.Cause<OperatorError>
): JobOperatorsService<PostgreSqlError> => ({
  retryNow: () => Effect.failCause(cause),
  cancel: () => Effect.failCause(cause),
  correctedRedrive: () => Effect.failCause(cause),
  redrive: () => Effect.failCause(cause)
})
afterEach(() => vi.restoreAllMocks())
for (const path of paths) {
  for (const method of methods) {
    test.each(cases)(`${path} ${method} preserves %s`, async (_name, original) => {
      const annotated = Cause.annotate(original, Context.make(Diagnostic, "retained"))
      const exit = await run(path, method, serviceFor(annotated))
      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) {
        return
      }
      expect(exit.cause.reasons.map((reason) => reason._tag)).toEqual(
        annotated.reasons.map((reason) => reason._tag)
      )
      for (const [index, reason] of exit.cause.reasons.entries()) {
        const before = annotated.reasons[index]!
        expect(Context.get(Cause.reasonAnnotations(reason), Diagnostic)).toBe("retained")
        if (reason._tag === "Fail" && before._tag === "Fail") {
          const error = before.error
          if (error instanceof PostgreSqlFailure) {
            expect(reason.error).toMatchObject({
              _tag: "JobBackendError",
              reason: "storage-failure",
              commitKnowledge: error.commitKnowledge
            })
          } else if (error instanceof PostgreSqlInvalidHandle) {
            expect(reason.error).toMatchObject({
              _tag: "JobBackendError",
              commitKnowledge: "NotCommitted",
              reason:
                error.reason === "active-transaction"
                  ? "active-transaction"
                  : error.reason === "inactive-handle"
                    ? "transaction-required"
                    : "unqualified-backend"
            })
          } else {
            expect(reason.error).toBe(error)
          }
        } else if (reason._tag === "Die" && before._tag === "Die") {
          expect(reason.defect).toBe(before.defect)
        } else if (reason._tag === "Interrupt" && before._tag === "Interrupt") {
          expect(reason.fiberId).toBe(before.fiberId)
        }
      }
    })
    test(`${path} ${method} preserves success`, async () => {
      const transition = {
        jobId: expected.jobId,
        beforeState: expected.state,
        beforeVersion: 4,
        after: {
          jobId: expected.jobId,
          state: "Cancelled" as const,
          lifecycleVersion: 5,
          policy: defaultPolicy,
          availableAt: 100,
          updatedAt: 200,
          attemptsMade: 0,
          stalledCount: 0,
          leaseToken: null,
          leaseExpiresAt: null,
          completedAt: 200,
          lastFailureCode: null
        }
      }
      const redrive = {
        source: expected,
        jobId: expected.jobId,
        inserted: true,
        dbNow: 200,
        lineage: {
          originalSourceJobId: expected.jobId,
          sourceJobId: expected.jobId,
          kind: "Redrive" as const
        }
      }
      const exit = await run(path, method, {
        retryNow: () => Effect.succeed(transition),
        cancel: () => Effect.succeed(transition),
        correctedRedrive: () => Effect.succeed(redrive),
        redrive: () => Effect.succeed(redrive)
      })
      expect(exit).toEqual(
        Exit.succeed(
          method === "redrive" || method === "correctedRedrive" ? redrive : transition
        )
      )
    })
  }
  test.each([
    new JobPayloadCodecError({ reason: "invalid-schema" }),
    new JobIntegrityConflict()
  ])(
    `${path} redrive preserves typed domain failures and companion reasons`,
    async (error) => {
      const service = serviceFor(Cause.fail(rejected))
      const lone = await run(path, "redrive", {
        ...service,
        redrive: () => Effect.fail(error)
      })
      expect(Exit.isFailure(lone)).toBe(true)
      if (Exit.isFailure(lone)) {
        expect(lone.cause.reasons).toHaveLength(1)
        expect(lone.cause.reasons[0]).toMatchObject({ _tag: "Fail", error })
      }
      const original = Cause.fromReasons<JobIntegrityConflict | JobPayloadCodecError>([
        Cause.makeFailReason(error),
        Cause.makeDieReason(defect),
        Cause.makeInterruptReason(321)
      ])
      const exit = await run(path, "redrive", {
        ...service,
        redrive: () => Effect.failCause(original)
      })
      expect(Exit.isFailure(exit)).toBe(true)
      if (!Exit.isFailure(exit)) {
        return
      }
      expect(exit.cause.reasons.map((reason) => reason._tag)).toEqual([
        "Fail",
        "Die",
        "Interrupt"
      ])
      expect(exit.cause.reasons[0]).toMatchObject({ error })
    }
  )
}
