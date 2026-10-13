import { Context } from "effect"

// Only application configuration supplies this reference; HTTP inputs never do.
export const LocalPrivate = Context.Reference<boolean>("playground/LocalPrivate", {
  defaultValue: () => false
})
// These are representation boundaries, not local lifetime admission quotas.
export const retainedMaximum = (local: boolean) => (local ? Number.MAX_SAFE_INTEGER : 100)
export const admissionMaximum = (local: boolean) =>
  local ? Number.MAX_SAFE_INTEGER : 200
