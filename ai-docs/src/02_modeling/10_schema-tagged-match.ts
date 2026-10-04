/**
 * @title Schema, tagged values, and Match
 */
import { Data, Match, Option, Result, Schema } from "effect"
import { AuthenticationDecision, UserId } from "../fixtures/Auth.js"

export type Admission = Data.TaggedEnum<{
  Anonymous: {}
  Inactive: {}
  Authenticated: { readonly userId: UserId }
}>

export const Admission = Data.taggedEnum<Admission>()

export const admit = (candidate: Option.Option<UserId>): Admission =>
  Option.match(candidate, {
    onNone: Admission.Anonymous,
    onSome: (userId) => Admission.Authenticated({ userId })
  })

export const authorize = (decision: AuthenticationDecision): Admission =>
  Match.value(decision).pipe(
    Match.when({ _tag: "Allow" }, ({ userId }) => Admission.Authenticated({ userId })),
    Match.when({ _tag: "Reject" }, () => Admission.Anonymous()),
    Match.exhaustive
  )

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"))
export type SessionId = typeof SessionId.Type

export const SessionSnapshot = Schema.Struct({
  id: SessionId,
  userId: UserId,
  status: Schema.Literals(["active", "revoked"])
})
export type SessionSnapshot = typeof SessionSnapshot.Type

export const decodeSessionSnapshot = Schema.decodeUnknownEffect(SessionSnapshot, {
  onExcessProperty: "error"
})

declare const decodedUserId: Result.Result<UserId, string>

export const decision = Result.match(decodedUserId, {
  onFailure: () => AuthenticationDecision.Reject(),
  onSuccess: (userId) => AuthenticationDecision.Allow({ userId })
})

/*
// Avoid manually fabricating tagged values and weakening their inferred type.
return { _tag: "Authenticated", userId } as const

// Avoid hand-written unknown shape probing when Schema owns the boundary.
if (typeof input === "object" && input !== null && "userId" in input) {
  // ...
}
*/
