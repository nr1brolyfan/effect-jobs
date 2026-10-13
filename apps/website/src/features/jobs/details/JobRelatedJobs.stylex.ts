import * as stylex from "@stylexjs/stylex"
import { colors, spacing } from "../../../ui/Theme.stylex.js"

export const styles = stylex.create({
  panel: { padding: spacing.lg, minWidth: 0, overflowWrap: "anywhere" },
  list: { listStyle: "none", padding: 0, margin: 0 },
  item: {
    display: "flex",
    flexWrap: "wrap",
    gap: spacing.sm,
    alignItems: "center",
    paddingBlock: spacing.md,
    borderBottom: `1px solid ${colors.border}`
  }
})
