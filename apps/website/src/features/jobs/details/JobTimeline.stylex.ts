import * as stylex from "@stylexjs/stylex"
import { colors, spacing, typography } from "../../../ui/Theme.stylex.js"

export const styles = stylex.create({
  panel: {
    padding: spacing.lg,
    minWidth: 0,
    overflowWrap: "anywhere",
    display: "grid",
    gap: spacing.md
  },
  list: { padding: 0, margin: 0, listStyle: "none", display: "grid", gap: spacing.md },
  fact: {
    paddingTop: spacing.md,
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: colors.border,
    display: "grid",
    gap: spacing.md,
    minWidth: 0
  },
  factHeader: {
    display: "flex",
    flexWrap: "wrap",
    gap: spacing.md,
    alignItems: "center"
  },
  empty: { color: colors.muted, fontSize: typography.secondary }
})
