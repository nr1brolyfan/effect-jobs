// @effect-diagnostics unstableApiUsage:off
import { Cause, Effect } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"

// Effect 4.1's failing native cleanup upgrades body failures to defects. Retain
// only the exact body prefix captured in this execution; extra cleanup reasons
// remain intact. The native client still owns begin/commit/rollback and release.
export const withTransaction = <A, E, R>(
  client: Pick<SqlClient, "withTransaction">,
  body: Effect.Effect<A, E, R>
) =>
  Effect.suspend(() => {
    let bodyCause: Cause.Cause<E> | undefined
    return client
      .withTransaction(
        body.pipe(
          Effect.tapCause((cause) =>
            Effect.sync(() => {
              bodyCause = cause
            })
          )
        )
      )
      .pipe(
        Effect.catchCause((cause) => {
          const original = bodyCause
          if (
            original === undefined ||
            original.reasons.length > cause.reasons.length ||
            !original.reasons.every((reason, index) => {
              const current = cause.reasons[index]
              return (
                current === reason ||
                (Cause.isFailReason(reason) &&
                  current !== undefined &&
                  Cause.isDieReason(current) &&
                  current.defect === reason.error)
              )
            })
          ) {
            return Effect.failCause(cause)
          }
          return Effect.failCause(
            Cause.fromReasons([
              ...original.reasons,
              ...cause.reasons.slice(original.reasons.length)
            ])
          )
        })
      )
  })
