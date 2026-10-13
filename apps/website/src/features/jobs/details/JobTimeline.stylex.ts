import * as stylex from "@stylexjs/stylex"
import { colors, spacing } from "../../../ui/Theme.stylex.js"

export const styles = stylex.create({
  panel: { padding: spacing.lg, minWidth: 0, overflowWrap: "anywhere" },
  list: { paddingInlineStart: spacing.lg, margin: 0 },
  fact: {
    padding: spacing.md,
    borderBottom: `1px solid ${colors.border}`,
    lineHeight: 1.6
  }
})
