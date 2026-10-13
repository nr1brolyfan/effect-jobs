import * as stylex from "@stylexjs/stylex"
import { colors, spacing, typography } from "../../../ui/Theme.stylex.js"

export const styles = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgb(0 0 0 / 55%)",
    zIndex: 50
  },
  drawer: {
    position: "fixed",
    top: 0,
    bottom: 0,
    right: 0,
    width: "min(100%, 620px)",
    boxSizing: "border-box",
    overflowY: "auto",
    overscrollBehavior: "contain",
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: typography.body,
    padding: spacing.lg,
    borderLeft: `1px solid ${colors.border}`,
    zIndex: 51,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.focus}` },
    overflowWrap: "anywhere"
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md
  },
  content: { display: "grid", gap: spacing.lg, minWidth: 0 }
})
