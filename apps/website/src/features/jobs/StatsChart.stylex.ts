import * as stylex from "@stylexjs/stylex"
import { colors, radii, shadows, spacing, typography } from "../../ui/Theme.stylex.js"

export const styles = stylex.create({
  panel: {
    minWidth: 0,
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.lg,
    boxShadow: shadows.panel,
    padding: { default: spacing.lg, "@media (max-width: 600px)": spacing.md },
    fontFamily: typography.fontFamily
  },
  heading: {
    margin: 0,
    marginBottom: spacing.md,
    fontSize: typography.body,
    fontWeight: 600
  },
  message: {
    margin: 0,
    marginBottom: spacing.md,
    color: colors.muted,
    fontSize: typography.small
  },
  body: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 220px) minmax(0, 1fr)",
      "@media (max-width: 600px)": "minmax(0, 1fr)"
    },
    alignItems: "center",
    gap: spacing.lg,
    minWidth: 0
  },
  graphic: {
    position: "relative",
    width: "100%",
    maxWidth: 220,
    minWidth: 0,
    aspectRatio: "1 / 1",
    justifySelf: "center"
  },
  plot: {
    position: "absolute",
    inset: 0,
    minWidth: 0
  },
  emptyRing: {
    position: "absolute",
    inset: "3%",
    borderWidth: 20,
    borderStyle: "solid",
    borderColor: colors.raised,
    borderRadius: "50%",
    boxSizing: "border-box"
  },
  center: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    pointerEvents: "none",
    textAlign: "center"
  },
  total: {
    maxWidth: "66%",
    overflowWrap: "anywhere",
    fontSize: 24,
    lineHeight: 1.1,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums"
  },
  totalLabel: {
    color: colors.muted,
    fontSize: typography.small
  },
  legend: {
    display: "grid",
    gap: spacing.sm,
    listStyleType: "none",
    margin: 0,
    padding: 0,
    minWidth: 0,
    fontSize: typography.small
  },
  row: {
    display: "grid",
    gridTemplateColumns: "8px minmax(0, 1fr) auto 4ch",
    alignItems: "center",
    gap: spacing.sm
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill
  },
  stateLabel: {
    minWidth: 0,
    overflowWrap: "anywhere"
  },
  count: {
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums"
  },
  percent: {
    color: colors.muted,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums"
  },
  tooltip: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    padding: spacing.sm,
    backgroundColor: colors.raised,
    color: colors.text,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.sm,
    boxShadow: shadows.panel,
    fontFamily: typography.fontFamily,
    fontSize: typography.small,
    pointerEvents: "none"
  }
})

export const stateDots = stylex.create({
  Completed: { backgroundColor: colors.completed },
  Active: { backgroundColor: colors.active },
  Pending: { backgroundColor: colors.pending },
  RetryScheduled: { backgroundColor: colors.retryScheduled },
  Dead: { backgroundColor: colors.dead },
  Isolated: { backgroundColor: colors.isolated }
})
