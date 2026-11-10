// Adapted from shadcn-cssinjs (MIT); see Primitives.LICENSE.
import * as stylex from "@stylexjs/stylex"
import { colors, radii, shadows, spacing, typography } from "./Theme.stylex.js"

export const styles = stylex.create({
  positioner: { isolation: "isolate", zIndex: 50, maxWidth: "100vw" },
  popup: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    width: "max-content",
    maxWidth: "min(360px, calc(100vw - 24px))",
    maxHeight: "var(--available-height)",
    overflowY: "auto",
    overflowWrap: "anywhere",
    padding: spacing.md,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.text,
    boxShadow: shadows.panel,
    fontFamily: typography.fontFamily,
    fontSize: typography.body,
    lineHeight: 1.5,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 2,
    outlineColor: colors.focus,
    outlineOffset: 3
  }
})
