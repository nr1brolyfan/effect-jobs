import * as stylex from "@stylexjs/stylex"
import { colors, spacing, radii, typography, shadows } from "../../ui/Theme.stylex.js"

export const styles = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgb(0 0 0 / 55%)",
    zIndex: 50
  },
  popup: {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "min(480px, calc(100vw - 24px))",
    maxHeight: "calc(100dvh - 24px)",
    boxSizing: "border-box",
    overflowY: "auto",
    overscrollBehavior: "contain",
    padding: spacing.lg,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: typography.body,
    boxShadow: shadows.panel,
    zIndex: 51,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.focus}` }
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md
  },
  title: { margin: 0, fontSize: "20px", lineHeight: 1.3 },
  description: { color: colors.muted, marginBlock: spacing.md },
  content: { display: "grid", gap: spacing.md, minWidth: 0 },
  notice: {
    color: colors.muted,
    margin: 0,
    overflowWrap: "anywhere",
    fontSize: typography.secondary
  },
  reset: { borderTop: `1px solid ${colors.border}`, paddingTop: spacing.md },
  summary: {
    cursor: "pointer",
    paddingBlock: spacing.sm,
    color: colors.muted,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.focus}` }
  }
})
