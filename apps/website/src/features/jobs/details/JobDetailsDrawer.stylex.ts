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
    width: "min(100%, 680px)",
    boxSizing: "border-box",
    overflowY: "auto",
    overscrollBehavior: "contain",
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: typography.body,
    padding: { default: spacing.lg, "@media (max-width: 480px)": spacing.md },
    borderLeftWidth: "1px",
    borderLeftStyle: "solid",
    borderLeftColor: colors.border,
    zIndex: 51,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: "2px",
    outlineColor: colors.focus,
    overflowWrap: "anywhere"
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md
  },
  title: { margin: 0, fontSize: "20px", lineHeight: 1.3 },
  identity: {
    fontFamily: typography.monoFamily,
    fontSize: typography.secondary,
    color: colors.muted,
    overflowWrap: "anywhere",
    marginTop: spacing.sm,
    marginBottom: spacing.lg
  },
  content: { display: "grid", gap: spacing.lg, minWidth: 0 }
})
