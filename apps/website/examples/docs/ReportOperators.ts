import { Effect } from "effect"
import { JobOperators } from "effect-jobs/JobOperators"
import type {
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

export const redriveReport = (
  authority: CommandAuthority<JobRedriveResult>,
  request: JobRedriveRequest
) =>
  runCommand(
    authority,
    Effect.gen(function* () {
      const { GenerateReport } = yield* ReportDefinitions
      const operators = yield* JobOperators
      return yield* operators.redrive(GenerateReport, request)
    })
  )

export const correctedRedriveReport = (
  authority: CommandAuthority<JobRedriveResult>,
  request: JobRedriveRequest,
  replacement: ReportPayload
) =>
  runCommand(
    authority,
    Effect.gen(function* () {
      const { GenerateReport } = yield* ReportDefinitions
      const operators = yield* JobOperators
      return yield* operators.correctedRedrive(GenerateReport, {
        ...request,
        payload: replacement
      })
    })
  )
// #endregion actions
