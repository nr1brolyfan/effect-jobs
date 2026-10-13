import * as stylex from "@stylexjs/stylex"
import { colors, spacing, typography } from "../../../ui/Theme.stylex.js"

export const styles = stylex.create({
  page: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: typography.body,
    lineHeight: 1.6,
    padding: { default: spacing.xl, "@media (max-width: 600px)": spacing.md },
    minWidth: 0
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md
  },
  identity: { fontFamily: typography.monoFamily, overflowWrap: "anywhere" },
  layout: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 2fr) minmax(240px, 1fr)",
      "@media (max-width: 900px)": "minmax(0, 1fr)"
    },
    gap: spacing.lg,
    alignItems: "start"
  },
  sections: { display: "grid", gap: spacing.lg, minWidth: 0 },
  metadata: { padding: spacing.lg, minWidth: 0, overflowWrap: "anywhere" },
  facts: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: spacing.xs,
    margin: 0
  }
})
