import * as stylex from "@stylexjs/stylex"
import { colors, spacing, typography } from "../../../ui/Theme.stylex.js"

export const styles = stylex.create({
  page: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: typography.body,
    lineHeight: 1.5,
    padding: { default: spacing.xl, "@media (max-width: 600px)": spacing.md },
    minWidth: 0,
    maxWidth: "1280px",
    marginInline: "auto",
    boxSizing: "border-box"
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg
  },
  title: { margin: 0, fontSize: typography.title, lineHeight: 1.2 },
  identity: {
    fontFamily: typography.monoFamily,
    fontSize: typography.secondary,
    color: colors.muted,
    overflowWrap: "anywhere",
    marginTop: spacing.sm,
    marginBottom: 0
  },
  layout: { display: "grid", gap: spacing.lg, alignItems: "start", minWidth: 0 },
  sections: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(2, minmax(0, 1fr))",
      "@media (max-width: 800px)": "minmax(0, 1fr)"
    },
    alignItems: "start",
    gap: spacing.lg,
    minWidth: 0
  },
  slots: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(2, minmax(0, 1fr))",
      "@media (max-width: 1000px)": "minmax(0, 1fr)"
    },
    gap: spacing.lg,
    minWidth: 0,
    alignItems: "start",
    gridColumn: "1 / -1"
  },
  payloadOnly: { gridTemplateColumns: "minmax(0, 1fr)" },
  metadata: { minWidth: 0 }
})
