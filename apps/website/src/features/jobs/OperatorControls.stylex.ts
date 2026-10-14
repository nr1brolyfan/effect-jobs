import * as stylex from "@stylexjs/stylex"
import { colors, spacing, radii, typography } from "../../ui/Theme.stylex.js"

export const styles = stylex.create({
  panel: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: { default: spacing.lg, "@media (max-width: 600px)": spacing.md },
    backgroundColor: colors.surface,
    minWidth: 0
  },
  actions: { display: "flex", flexWrap: "wrap", gap: spacing.sm },
  explanation: { color: colors.muted, fontSize: "12px", lineHeight: 1.5 },
  dialog: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.lg,
    maxWidth: "480px",
    width: "calc(100% - 48px)",
    boxSizing: "border-box",
    fontFamily: typography.fontFamily,
    fontSize: typography.body
  },
  heading: { fontSize: "18px", marginTop: 0 },
  warning: { lineHeight: 1.5 }
})
