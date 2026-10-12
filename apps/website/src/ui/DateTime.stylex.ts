import * as stylex from "@stylexjs/stylex"
import { colors, radii, spacing, typography } from "./Theme.stylex.js"

export const styles = stylex.create({
  trigger: {
    display: "inline-flex",
    alignItems: "flex-start",
    justifyContent: "center",
    flexDirection: "column",
    gap: 0,
    minWidth: 0,
    maxWidth: "100%",
    minHeight: { default: 32, "@media (pointer: coarse)": 44 },
    paddingBlock: spacing.xs,
    paddingInline: 0,
    borderWidth: 0,
    borderRadius: radii.sm,
    backgroundColor: { default: "transparent", ":hover": colors.raised },
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: "14px",
    fontWeight: 400,
    overflowWrap: "anywhere",
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1.5,
    textAlign: "start",
    cursor: "pointer",
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineColor: colors.focus,
    outlineWidth: 2,
    outlineOffset: 2
  },
  hint: { color: colors.muted, fontSize: "12px" },
  absent: { color: colors.muted, fontSize: "13px", lineHeight: 1.5 },
  details: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.md,
    minWidth: 0,
    maxWidth: 360,
    fontFamily: typography.fontFamily,
    fontSize: "14px",
    lineHeight: 1.5,
    color: colors.text,
    overflowWrap: "anywhere"
  },
  heading: { margin: 0, fontSize: "14px", fontWeight: 600 },
  list: { display: "grid", gap: spacing.xs, margin: 0 },
  term: { color: colors.muted, fontSize: "13px" },
  value: { margin: 0, marginBottom: spacing.sm, fontVariantNumeric: "tabular-nums" },
  iso: {
    margin: 0,
    fontFamily: typography.monoFamily,
    fontSize: "13px",
    userSelect: "text"
  }
})
