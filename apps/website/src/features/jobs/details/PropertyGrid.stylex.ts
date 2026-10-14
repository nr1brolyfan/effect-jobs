import * as stylex from "@stylexjs/stylex"
import { colors, spacing, typography } from "../../../ui/Theme.stylex.js"

export const styles = stylex.create({
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: spacing.sm,
    margin: 0,
    minWidth: 0,
    maxWidth: "620px",
    width: "100%"
  },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(100px, 36%) minmax(0, 1fr)",
    columnGap: spacing.md,
    alignItems: "baseline",
    minWidth: 0
  },
  term: {
    margin: 0,
    color: colors.muted,
    fontSize: typography.secondary,
    overflowWrap: "anywhere"
  },
  value: { margin: 0, minWidth: 0, overflowWrap: "anywhere", lineHeight: 1.5 },
  mono: { fontFamily: typography.monoFamily, fontSize: typography.secondary },
  absent: { color: colors.muted },
  panel: {
    padding: spacing.lg,
    minWidth: 0,
    overflowWrap: "anywhere",
    display: "grid",
    gap: spacing.md
  },
  heading: { margin: 0, fontSize: "16px", fontWeight: 600, lineHeight: 1.4 },
  advanced: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(2, minmax(0, 1fr))",
      "@media (max-width: 800px)": "minmax(0, 1fr)"
    },
    gap: spacing.lg,
    marginTop: spacing.lg
  },
  section: { display: "grid", gap: spacing.md, alignContent: "start", minWidth: 0 },
  sectionSummary: {
    cursor: "pointer",
    fontWeight: 600,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: "2px",
    outlineColor: colors.focus
  }
})
