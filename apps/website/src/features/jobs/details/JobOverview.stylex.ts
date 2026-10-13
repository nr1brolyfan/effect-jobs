import * as stylex from "@stylexjs/stylex"
import { colors, spacing, radii } from "../../../ui/Theme.stylex.js"

export const styles = stylex.create({
  panel: { padding: spacing.lg, minWidth: 0, overflowWrap: "anywhere" },
  badges: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: spacing.md },
  label: {
    border: `1px solid ${colors.border}`,
    borderRadius: radii.pill,
    padding: "4px 8px",
    color: colors.text
  },
  counters: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) auto",
      "@media (max-width: 480px)": "minmax(0, 1fr)"
    },
    gap: spacing.sm,
    margin: 0
  },
  note: { color: colors.muted, lineHeight: 1.6 }
})
