import * as stylex from "@stylexjs/stylex"
import { colors, spacing, radii, typography } from "../../../ui/Theme.stylex.js"

export const styles = stylex.create({
  panel: {
    padding: spacing.lg,
    minWidth: 0,
    overflowWrap: "anywhere",
    display: "grid",
    gap: spacing.md
  },
  badges: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  label: {
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.pill,
    padding: "4px 8px",
    color: colors.muted,
    fontSize: typography.secondary
  }
})
