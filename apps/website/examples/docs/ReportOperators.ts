import { Effect } from "effect"
import { JobOperators } from "effect-jobs/JobOperators"
import type {
  JobCorrectedRedriveRequest,
  JobOperatorExpected,
  JobOperatorTransition,
  JobRedriveRequest,
  JobRedriveResult
} from "effect-jobs/JobOperators"
import { PostgreSqlJobs } from "effect-jobs/PostgreSqlJobs"
import { ReportDefinitions, type ReportPayload } from "./ReportWorkflow.js"

// The application implements these steps on the same PgClient. The example
// starts with a new command. Resolve an existing command by its exact receipt.
interface CommandAuthority<A> {
  readonly authorizeAndAdmit: Effect.Effect<void, Error>
  readonly saveReceipt: (result: A) => Effect.Effect<void, Error>
}

// #region transaction
const runCommand = <A, E, R>(
  authority: CommandAuthority<A>,
  operate: Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const jobs = yield* PostgreSqlJobs
    return yield* jobs.withTransaction(() =>
      Effect.gen(function* () {
        yield* authority.authorizeAndAdmit
        const result = yield* operate // Provisional here.
        yield* authority.saveReceipt(result)
        return result
      })
    )
  })
// Return the result to the caller after the outer owner acknowledges COMMIT.
// #endregion transaction

// #region actions
type RedriveCommand =
  | { readonly kind: "redrive"; readonly request: JobRedriveRequest }
  | {
      readonly kind: "correctedRedrive"
      readonly request: JobCorrectedRedriveRequest<ReportPayload>
    }

interface RedriveAuthority extends CommandAuthority<JobRedriveResult> {
  readonly confirmDuplicateEffects: (
    command: RedriveCommand
  ) => Effect.Effect<boolean | undefined, Error>
}

const requireDuplicateEffectsConfirmation = (
  authority: RedriveAuthority,
  command: RedriveCommand
) =>
  Effect.gen(function* () {
    if ((yield* authority.confirmDuplicateEffects(command)) !== true) {
      return yield* Effect.fail(
        new Error("Redrive requires duplicate-effects confirmation")
      )
    }
  })

export const cancelReport = (
  authority: CommandAuthority<JobOperatorTransition>,
  expected: JobOperatorExpected
) =>
  runCommand(
    authority,
    JobOperators.use((operators) => operators.cancel(expected))
  )

export const retryReportNow = (
  authority: CommandAuthority<JobOperatorTransition>,
  expected: JobOperatorExpected
) =>
  runCommand(
    authority,
    JobOperators.use((operators) => operators.retryNow(expected))
  )

export const redriveReport = (authority: RedriveAuthority, request: JobRedriveRequest) =>
  runCommand(
    authority,
    Effect.gen(function* () {
      yield* requireDuplicateEffectsConfirmation(authority, {
        kind: "redrive",
        request
      })
      const { GenerateReport } = yield* ReportDefinitions
      const operators = yield* JobOperators
      return yield* operators.redrive(GenerateReport, request)
    })
  )

export const correctedRedriveReport = (
  authority: RedriveAuthority,
  request: JobRedriveRequest,
  replacement: ReportPayload
) =>
  runCommand(
    authority,
    Effect.gen(function* () {
      const corrected = { ...request, payload: replacement }
      yield* requireDuplicateEffectsConfirmation(authority, {
        kind: "correctedRedrive",
        request: corrected
      })
      const { GenerateReport } = yield* ReportDefinitions
      const operators = yield* JobOperators
      return yield* operators.correctedRedrive(GenerateReport, corrected)
    })
  )
// #endregion actions
