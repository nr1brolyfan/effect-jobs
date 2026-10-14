import * as stylex from "@stylexjs/stylex"
import { colors, spacing, radii, typography } from "../../../ui/Theme.stylex.js"

export const styles = stylex.create({
  panel: {
    minWidth: 0,
    display: "grid",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg
  },
  heading: { fontSize: "16px", margin: 0 },
  note: { color: colors.muted, lineHeight: 1.5, margin: 0 },
  actions: { display: "flex", gap: spacing.sm, flexWrap: "wrap" },
  code: {
    backgroundColor: colors.canvas,
    color: colors.text,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.md,
    fontFamily: typography.monoFamily,
    fontSize: typography.small,
    lineHeight: 1.6,
    padding: spacing.md,
    margin: 0,
    maxHeight: "360px",
    overflow: "auto",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere"
  },
  key: { color: colors.active },
  string: { color: colors.accent },
  literal: { color: colors.retryScheduled },
  viewerHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  info: { color: colors.muted, fontSize: typography.secondary },
  infoBody: { display: "grid", gap: spacing.sm, paddingTop: spacing.sm },
  form: { display: "grid", gap: spacing.sm },
  plaintext: { userSelect: "none" },
  result: {
    display: "flex",
    alignItems: "center",
    gap: spacing.md,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    margin: 0,
    color: colors.muted,
    fontSize: typography.secondary
  },
  resultValue: { margin: 0 }
})
