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
  empty: { color: colors.muted, fontSize: typography.secondary },
  jobLink: {
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    textAlign: "left",
    minWidth: 0,
    maxWidth: "100%",
    fontFamily: typography.monoFamily,
    fontSize: typography.secondary
  },
  list: { listStyle: "none", padding: 0, margin: 0 },
  item: {
    display: "flex",
    flexWrap: "wrap",
    gap: spacing.sm,
    alignItems: "center",
    paddingBlock: spacing.md,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: colors.border
  }
})
