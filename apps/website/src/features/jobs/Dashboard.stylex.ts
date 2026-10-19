import * as stylex from "@stylexjs/stylex"
import { colors, spacing, radii, typography, shadows } from "../../ui/Theme.stylex.js"

export const styles = stylex.create({
  detailActions: { display: "grid", gap: spacing.lg, minWidth: 0, alignContent: "start" },
  app: {
    backgroundColor: colors.canvas,
    color: colors.text,
    fontFamily: typography.fontFamily,
    minHeight: "100vh"
  },
  detail: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderColor: colors.border,
    borderWidth: 1,
    borderStyle: "solid",
    padding: spacing.lg,
    minWidth: 0
  },
  selected: { backgroundColor: colors.raised },
  muted: { color: colors.muted },
  clock: {
    display: "block",
    color: colors.retryScheduled,
    marginTop: spacing.xs,
    fontSize: typography.small
  },
  controls: { display: "flex", gap: spacing.sm, flexWrap: "wrap" },
  details: { overflowWrap: "anywhere" },
  retry: { fontSize: typography.secondary },
  notice: { color: colors.muted, fontSize: typography.small }
})

export const layout = stylex.create({
  app: {
    fontSize: typography.body,
    lineHeight: 1.5,
    minHeight: "100vh",
    backgroundColor: colors.canvas,
    color: colors.text,
    fontFamily: typography.fontFamily
  },
  paragraph: { margin: 0, maxWidth: "72ch" },
  resultsLabel: {
    color: colors.muted,
    fontSize: typography.secondary,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap"
  },
  heading: { margin: 0, fontSize: typography.body, fontWeight: 550 },
  title: {
    margin: 0,
    fontSize: typography.title,
    lineHeight: 1.25,
    fontWeight: 550,
    letterSpacing: "-0.025em"
  },
  sidebar: {
    position: "fixed",
    top: 0,
    bottom: 0,
    left: 0,
    width: {
      default: "232px",
      "@media (max-width: 900px)": "72px",
      "@media (max-width: 600px)": "54px"
    },
    zIndex: 10,
    display: "flex",
    flexDirection: "column",
    backgroundColor: colors.sidebar,
    borderRight: `1px solid ${colors.border}`,
    padding: {
      default: "26px 16px 16px",
      "@media (max-width: 900px)": "22px 9px 14px",
      "@media (max-width: 600px)": "18px 5px 12px"
    }
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: "11px",
    padding: { default: "0 10px 26px", "@media (max-width: 900px)": "0 0 24px" }
  },
  brandMark: {
    width: "32px",
    height: "32px",
    display: "grid",
    placeItems: "center",
    borderRadius: radii.lg,
    color: colors.accent,
    backgroundColor: colors.raised
  },
  desktop: { display: { default: "block", "@media (max-width: 900px)": "none" } },
  sublabel: { display: "block", color: colors.muted, fontSize: typography.small },
  workspace: {
    display: { default: "flex", "@media (max-width: 900px)": "none" },
    gap: "10px",
    alignItems: "center",
    padding: "10px",
    border: `1px solid ${colors.border}`,
    borderRadius: radii.md,
    backgroundColor: colors.surface
  },
  avatar: {
    width: "28px",
    height: "28px",
    borderRadius: radii.md,
    backgroundColor: colors.raised,
    color: colors.text,
    display: "grid",
    placeItems: "center",
    fontSize: typography.secondary,
    fontWeight: 600,
    flexShrink: 0
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: "5px",
    paddingTop: { default: "30px", "@media (max-width: 900px)": "4px" }
  },
  navLabel: {
    margin: 0,
    display: { default: "block", "@media (max-width: 900px)": "none" },
    color: colors.muted,
    letterSpacing: "1.3px",
    fontSize: typography.small,
    padding: "0 12px 10px"
  },
  navButton: {
    justifyContent: { default: "flex-start", "@media (max-width: 900px)": "center" },
    minHeight: "44px",
    padding: "9px 12px",
    borderColor: "transparent",
    backgroundColor: "transparent",
    borderRadius: radii.md,
    gap: { default: typography.body, "@media (max-width: 900px)": 0 },
    color: colors.muted,
    fontSize: { default: typography.body, "@media (max-width: 900px)": 0 },
    width: { default: "auto", "@media (max-width: 900px)": "44px" },
    overflow: "hidden"
  },
  navActive: {
    color: colors.accent,
    backgroundColor: colors.raised,
    borderColor: colors.border,
    boxShadow: `inset 3px 0 ${colors.accent}`
  },
  sidebarNote: {
    margin: "auto 6px 24px",
    paddingTop: "20px",
    color: colors.muted,
    display: { default: "block", "@media (max-width: 900px)": "none" }
  },
  profile: {
    marginTop: "auto",
    paddingTop: "18px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    borderTop: `1px solid ${colors.border}`
  },
  main: {
    minWidth: 0,
    marginLeft: {
      default: "232px",
      "@media (max-width: 900px)": "72px",
      "@media (max-width: 600px)": "54px"
    }
  },
  topbar: {
    height: { default: "64px", "@media (max-width: 600px)": "48px" },
    borderBottom: `1px solid ${colors.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: { default: "0 36px", "@media (max-width: 600px)": "0 14px" }
  },
  breadcrumb: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    color: colors.muted,
    fontSize: typography.secondary
  },
  environment: {
    fontSize: typography.small,
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.raised,
    color: colors.accent,
    borderRadius: radii.sm,
    padding: "4px 8px",
    display: { default: "inline-flex", "@media (max-width: 600px)": "none" }
  },
  canvas: {
    maxWidth: "1680px",
    margin: "0 auto",
    padding: {
      default: "34px 36px 24px",
      "@media (max-width: 900px)": "28px 24px",
      "@media (max-width: 600px)": "24px 14px 18px"
    }
  },
  header: {
    alignSelf: "stretch",
    display: "flex",
    justifyContent: "space-between",
    gap: "24px",
    alignItems: "flex-start",
    marginBottom: "30px",
    flexDirection: { default: "row", "@media (max-width: 600px)": "column" }
  },
  eyebrow: {
    margin: "0 0 9px",
    color: colors.muted,
    fontSize: typography.small,
    letterSpacing: "1.5px",
    fontWeight: 600
  },
  subtitle: { margin: "9px 0 0", color: colors.muted, fontSize: typography.small },
  actions: { display: "flex", gap: spacing.sm, flexShrink: 0, flexWrap: "wrap" },
  overview: {
    display: "grid",
    gridTemplateColumns: {
      default: "1fr 1.15fr",
      "@media (max-width: 1200px)": "minmax(0, 1fr)"
    },
    gap: "16px",
    marginBottom: "24px"
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: { default: "14px", "@media (max-width: 600px)": "8px" }
  },
  stat: {
    backgroundColor: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.lg,
    padding: { default: "15px 18px", "@media (max-width: 600px)": "13px 11px" },
    minWidth: 0
  },
  statLabel: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    color: colors.muted,
    fontSize: typography.secondary
  },
  statValue: {
    display: "block",
    fontSize: "30px",
    lineHeight: 1.2,
    marginTop: "8px",
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums"
  },
  statNote: { margin: "8px 0 0", color: colors.muted, fontSize: typography.small },
  jobsLayout: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: "20px",
    alignItems: "start"
  },
  withDetail: {
    gridTemplateColumns: {
      default: "minmax(0, 1fr) 360px",
      "@media (max-width: 1200px)": "minmax(0, 1fr)"
    }
  },
  panel: {
    minWidth: 0,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    overflow: "hidden"
  },
  panelHeading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "19px 20px 14px"
  },
  tabs: {
    display: "flex",
    overflowX: "auto",
    gap: "3px",
    borderBottom: `1px solid ${colors.border}`,
    padding: "0 17px"
  },
  tab: {
    flexShrink: 0,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    color: colors.muted,
    fontSize: typography.secondary,
    padding: "10px 10px 11px",
    minHeight: "44px",
    borderBottom: "2px solid transparent"
  },
  tabActive: { color: colors.accent, borderBottomColor: colors.accent },
  scroll: { width: "100%", overflowX: "auto" },
  table: {
    fontVariantNumeric: "tabular-nums",
    width: "100%",
    borderCollapse: "collapse",
    textAlign: "left",
    fontSize: typography.body,
    whiteSpace: "nowrap"
  },
  th: {
    color: colors.muted,
    fontSize: typography.small,
    fontWeight: 500,
    backgroundColor: colors.raised,
    borderBlock: `1px solid ${colors.border}`,
    height: "37px",
    padding: "8px 14px"
  },
  td: { padding: "13px 14px", borderBottom: `1px solid ${colors.border}` },
  row: { backgroundColor: { default: "transparent", ":hover": colors.raised } },
  identity: { display: "flex", alignItems: "center", gap: "11px" },
  jobIcon: {
    width: "31px",
    height: "31px",
    border: `1px solid ${colors.border}`,
    borderRadius: radii.md,
    backgroundColor: colors.raised,
    color: colors.accent,
    display: "grid",
    placeItems: "center",
    flexShrink: 0
  },
  jobName: {
    display: "block",
    fontSize: typography.secondary,
    fontWeight: 550,
    color: colors.text,
    textTransform: "capitalize"
  },
  jobId: {
    display: "block",
    cursor: "pointer",
    padding: "5px 0",
    minHeight: "32px",
    "@media (pointer: coarse)": { minHeight: "44px" },
    borderWidth: 0,
    backgroundColor: "transparent",
    borderRadius: radii.sm,
    maxWidth: "155px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "left",
    color: colors.muted,
    fontSize: typography.small,
    fontWeight: 400,
    fontFamily: typography.monoFamily,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.focus}` },
    outlineOffset: "4px"
  },
  cell: { color: colors.muted, fontSize: typography.body },
  pagination: {
    padding: { default: "20px", "@media (max-width: 600px)": "16px 12px" },
    borderTop: `1px solid ${colors.border}`,
    display: "flex",
    alignItems: "center",
    gap: "16px 24px",
    flexWrap: "wrap"
  },
  pageSize: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginLeft: { default: "auto", "@media (max-width: 600px)": 0 },
    flexShrink: 0
  },
  pageSizeLabel: {
    color: colors.muted,
    fontSize: typography.small,
    whiteSpace: "nowrap"
  },
  pageSizeSelect: {
    minHeight: "44px",
    padding: "8px 12px",
    border: `1px solid ${colors.border}`,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: typography.body,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.focus}` },
    outlineOffset: "3px"
  },
  empty: {
    minHeight: "200px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "9px",
    padding: "30px",
    textAlign: "center"
  },
  detail: {
    minWidth: 0,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.lg,
    padding: spacing.lg,
    position: { default: "sticky", "@media (max-width: 1200px)": "fixed" },
    top: { default: "20px", "@media (max-width: 1200px)": "80px" },
    right: { default: "auto", "@media (max-width: 1200px)": "20px" },
    width: { default: "auto", "@media (max-width: 1200px)": "360px" },
    maxWidth: "calc(100vw - 40px)",
    zIndex: 20,
    maxHeight: "calc(100vh - 100px)",
    overflowY: "auto",
    boxShadow: shadows.panel
  },
  detailHeading: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "12px"
  },
  dt: { marginTop: "15px", color: colors.muted, fontSize: typography.small },
  dd: {
    margin: "4px 0 0",
    color: colors.text,
    fontSize: typography.secondary,
    overflowWrap: "anywhere"
  },
  link: {
    color: colors.accent,
    fontSize: typography.secondary,
    textUnderlineOffset: "4px",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.focus}` },
    outlineOffset: "4px"
  },
  scenario: {
    border: `1px solid ${colors.border}`,
    borderRadius: radii.md,
    marginTop: "20px",
    backgroundColor: colors.surface
  },
  summary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    listStyle: "none",
    padding: "17px 20px",
    cursor: "pointer",
    gap: "14px",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.focus}` },
    outlineOffset: "4px"
  },
  summaryTitle: { display: "flex", alignItems: "center", gap: "11px", flexWrap: "wrap" },
  scenarioBody: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
    alignItems: "end",
    padding: spacing.lg
  },
  session: {
    display: "flex",
    gap: "10px 24px",
    justifyContent: "space-between",
    flexWrap: "wrap",
    fontSize: typography.small,
    color: colors.muted,
    padding: "17px 1px 22px"
  },
  scope: { overflowWrap: "anywhere", margin: 0 },
  footer: {
    borderTop: `1px solid ${colors.border}`,
    paddingTop: "15px",
    display: "flex",
    gap: "15px",
    justifyContent: "space-between",
    color: colors.muted,
    fontSize: typography.small
  }
})
