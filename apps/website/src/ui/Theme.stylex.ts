import * as stylex from "@stylexjs/stylex"
import type { JobSummary } from "@effect-jobs/playground-contracts/Jobs"

export const stateOrder = [
  "Completed",
  "Active",
  "Pending",
  "RetryScheduled",
  "Dead",
  "Isolated"
] as const

// The literals also feed SVG fills. Keep this as the single state palette.
export const stateColors = {
  Completed: "#c7e89f",
  Active: "#8ebed6",
  Pending: "#8e9b83",
  RetryScheduled: "#dfbd77",
  Dead: "#da9999",
  Isolated: "#b7a0d5"
} as const satisfies Record<JobSummary["state"], string>

export const stateLabels = {
  Completed: "Completed",
  Active: "Active",
  Pending: "Pending",
  RetryScheduled: "Retry scheduled",
  Dead: "Dead",
  Isolated: "Isolated"
} as const satisfies Record<JobSummary["state"], string>

export const colors = stylex.defineVars({
  canvas: "#101510",
  sidebar: "#0c100d",
  surface: "#171c16",
  raised: "#222a1f",
  text: "#e5eddf",
  muted: "#a5b29c",
  border: "#374431",
  accent: "#d1efab",
  accentText: "#202b15",
  focus: "#d1efab",
  completed: stateColors.Completed,
  active: stateColors.Active,
  pending: stateColors.Pending,
  retryScheduled: stateColors.RetryScheduled,
  dead: stateColors.Dead,
  isolated: stateColors.Isolated
})

export const spacing = stylex.defineVars({
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "20px",
  xl: "28px",
  xxl: "36px"
})

export const radii = stylex.defineVars({
  sm: "4px",
  md: "7px",
  lg: "10px",
  pill: "999px"
})

export const typography = stylex.defineVars({
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  monoFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  small: "12px",
  secondary: "13px",
  body: "14px",
  title: "28px"
})

export const shadows = stylex.defineVars({
  panel: "0 12px 32px rgb(0 0 0 / 12%)"
})

export const motion = stylex.defineVars({
  fast: "120ms"
})
