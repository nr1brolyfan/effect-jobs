// Adapted from shadcn-cssinjs (MIT); see Primitives.LICENSE.
import * as stylex from "@stylexjs/stylex"
import { colors, typography } from "./Theme.stylex.js"

export const styles = stylex.create({
  root: { display: "flex", flexWrap: "wrap", maxWidth: "100%", minWidth: 0 },
  list: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    listStyleType: "none",
    padding: 0,
    margin: 0,
    maxWidth: "100%"
  },
  ellipsis: {
    display: "inline-flex",
    justifyContent: "center",
    minWidth: 36,
    color: colors.muted,
    fontSize: typography.body
  },
  previous: { display: "inline-flex", transform: "rotate(180deg)" }
})
