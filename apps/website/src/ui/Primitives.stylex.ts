import * as stylex from "@stylexjs/stylex"
import { colors, motion, radii, shadows, spacing, typography } from "./Theme.stylex.js"

export const styles = stylex.create({
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    gap: spacing.sm,
    minHeight: { default: 36, "@media (pointer: coarse)": 44 },
    maxWidth: "100%",
    paddingBlock: spacing.sm,
    paddingInline: spacing.md,
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: radii.md,
    fontFamily: typography.fontFamily,
    fontSize: typography.body,
    fontWeight: 550,
    lineHeight: 1.5,
    textAlign: "center",
    overflowWrap: "anywhere",
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    transitionProperty: "background-color, border-color, color",
    transitionDuration: {
      default: motion.fast,
      "@media (prefers-reduced-motion: reduce)": "0s"
    },
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 2,
    outlineColor: colors.focus,
    outlineOffset: 3
  },
  secondary: {
    backgroundColor: { default: colors.raised, ":hover:enabled": colors.surface },
    borderColor: { default: colors.border, ":hover:enabled": colors.muted },
    color: { default: colors.text, ":disabled": colors.muted }
  },
  primary: {
    backgroundColor: {
      default: colors.accent,
      ":hover:enabled": colors.completed,
      ":disabled": colors.raised
    },
    borderColor: { default: colors.accent, ":disabled": colors.border },
    color: { default: colors.accentText, ":disabled": colors.muted }
  },
  ghost: {
    backgroundColor: { default: "transparent", ":hover:enabled": colors.raised },
    borderColor: "transparent",
    color: { default: colors.text, ":disabled": colors.muted }
  },
  panel: {
    minWidth: 0,
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: { default: spacing.lg, "@media (max-width: 600px)": spacing.md },
    boxShadow: shadows.panel,
    fontFamily: typography.fontFamily,
    fontSize: typography.body,
    lineHeight: 1.5,
    overflowWrap: "anywhere"
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: spacing.xs,
    maxWidth: "100%",
    paddingBlock: 3,
    paddingInline: 7,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.sm,
    fontFamily: typography.fontFamily,
    fontSize: typography.small,
    fontWeight: 500,
    lineHeight: 1.5
  },
  Completed: { color: colors.completed },
  Active: { color: colors.active },
  Pending: { color: colors.pending },
  RetryScheduled: { color: colors.retryScheduled },
  Dead: { color: colors.dead },
  Isolated: { color: colors.isolated },
  dot: {
    width: 5,
    height: 5,
    flexShrink: 0,
    borderRadius: radii.pill,
    backgroundColor: "currentColor"
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    minWidth: 0,
    maxWidth: "100%",
    fontFamily: typography.fontFamily,
    fontSize: typography.small,
    lineHeight: 1.5
  },
  label: { color: colors.muted, overflowWrap: "anywhere" },
  control: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    minHeight: { default: 36, "@media (pointer: coarse)": 44 },
    paddingBlock: spacing.sm,
    paddingInline: spacing.md,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.canvas,
    color: { default: colors.text, ":disabled": colors.muted },
    fontFamily: typography.fontFamily,
    fontSize: { default: typography.body, "@media (pointer: coarse)": "16px" },
    lineHeight: 1.5,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 2,
    outlineColor: colors.focus,
    outlineOffset: 3,
    "::placeholder": { color: colors.muted }
  },
  checkbox: {
    width: 20,
    height: 20,
    minHeight: 20,
    padding: 0,
    accentColor: colors.accent
  },
  tabsList: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.canvas,
    maxWidth: "100%"
  },
  tabsVertical: { flexDirection: "column", alignItems: "stretch" },
  tab: {
    backgroundColor: { default: "transparent", ":hover:enabled": colors.raised },
    borderColor: "transparent",
    color: { default: colors.muted, ":disabled": colors.muted }
  },
  tabActive: {
    backgroundColor: colors.raised,
    borderColor: colors.border,
    color: colors.text
  },
  tabDisabled: {
    cursor: "not-allowed",
    backgroundColor: "transparent",
    color: colors.muted
  },
  tabCount: {
    fontSize: typography.small,
    fontVariantNumeric: "tabular-nums",
    color: colors.muted
  },
  tabsPanel: {
    minWidth: 0,
    fontSize: typography.body,
    lineHeight: 1.5,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 2,
    outlineColor: colors.focus,
    outlineOffset: 3
  },
  icon: { display: "inline-block", flexShrink: 0, verticalAlign: "middle" }
})
