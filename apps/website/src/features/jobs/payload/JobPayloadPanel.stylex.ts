import * as stylex from "@stylexjs/stylex"
import { colors, spacing, radii, typography } from "../../../ui/Theme.stylex.js"

export const styles = stylex.create({
  panel: { minWidth: 0, display: "grid", gap: spacing.md },
  heading: { fontSize: "16px", margin: 0 },
  note: { color: colors.muted, lineHeight: 1.5, margin: 0 },
  actions: { display: "flex", gap: spacing.sm, flexWrap: "wrap" },
  code: {
    backgroundColor: colors.canvas,
    color: colors.text,
    border: `1px solid ${colors.border}`,
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
  form: { display: "grid", gap: spacing.md },
  plaintext: { userSelect: "none" }
})
