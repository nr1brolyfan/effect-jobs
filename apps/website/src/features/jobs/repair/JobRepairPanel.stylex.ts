import * as stylex from "@stylexjs/stylex"
import { colors, spacing, radii, typography } from "../../../ui/Theme.stylex.js"
export const styles = stylex.create({
  panel: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: { default: spacing.lg, "@media (max-width: 600px)": spacing.md },
    minWidth: 0,
    overflowWrap: "anywhere"
  },
  actions: { display: "flex", flexWrap: "wrap", gap: spacing.sm },
  backdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    // Confirmation is also portaled from the quick-details drawer (50/51).
    zIndex: 60
  },
  popup: {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%,-50%)",
    width: "min(640px,calc(100vw - 32px))",
    maxHeight: "calc(100dvh - 32px)",
    overflowY: "auto",
    padding: spacing.lg,
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.md,
    boxSizing: "border-box",
    fontFamily: typography.fontFamily,
    fontSize: typography.body,
    zIndex: 61
  },
  form: { display: "grid", gap: spacing.md },
  editor: {
    fontFamily: "monospace",
    minHeight: "180px",
    maxWidth: "100%",
    resize: "vertical"
  },
  explanation: { color: colors.muted, fontSize: "13px", lineHeight: 1.5 },
  changes: {
    maxHeight: "140px",
    overflowY: "auto",
    fontFamily: "monospace",
    fontSize: "12px"
  },
  heading: { fontSize: "16px", marginTop: 0, marginBottom: spacing.md },
  error: { color: colors.dead, fontSize: "13px" }
})
