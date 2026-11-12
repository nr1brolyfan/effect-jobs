import { Effect } from "effect"
import { type InvalidOperationId, validateOperationId } from "../../src/JobIdentity.js"
const validation = validateOperationId("request")
const exact: Effect.Effect<void, InvalidOperationId> = validation
type Assert<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
export type Error = Assert<Equal<Effect.Error<typeof validation>, InvalidOperationId>>
export type Services = Assert<Equal<Effect.Services<typeof validation>, never>>
// @ts-expect-error Operation validation remains lazy and typed.
export const eager: void = validation
void exact
