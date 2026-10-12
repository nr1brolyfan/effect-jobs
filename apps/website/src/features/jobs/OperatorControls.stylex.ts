import * as stylex from "@stylexjs/stylex"
import { colors, spacing, radii } from "../../ui/Theme.stylex.js"

export const styles = stylex.create({
  panel: {
    borderTop: `1px solid ${colors.border}`,
    marginTop: spacing.lg,
    paddingTop: spacing.md
  },
  actions: { display: "flex", flexWrap: "wrap", gap: spacing.sm },
  explanation: { color: colors.muted, fontSize: "12px", lineHeight: 1.5 },
  dialog: {
    backgroundColor: colors.surface,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.md,
    padding: spacing.lg,
    maxWidth: "480px",
    width: "calc(100% - 48px)"
  },
  heading: { fontSize: "18px", marginTop: 0 },
  warning: { lineHeight: 1.5 }
})
