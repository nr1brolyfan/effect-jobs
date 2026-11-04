import { Data } from "effect"

export type DrainResult = Data.TaggedEnum<{
  Idle: { readonly claimed: number; readonly recovered: number }
  MoreWork: { readonly claimed: number; readonly recovered: number }
  Backoff: {
    readonly phase: "claim" | "recovery" | "reconciliation"
    readonly claimed: number
  }
}>
export const DrainResult = Data.taggedEnum<DrainResult>()
