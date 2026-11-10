import * as stylex from "@stylexjs/stylex"
import { styles, layout } from "./Dashboard.stylex.js"

// Semantic class names remain stable for browser qualification; all styling is compiled.
const classStyles = {
  "jobs-app": layout.app,
  sidebar: layout.sidebar,
  brand: layout.brand,
  "brand-mark": layout.brandMark,
  "workspace-switcher": layout.workspace,
  "workspace-avatar": layout.avatar,
  "sidebar-navigation": layout.nav,
  "sidebar-item": layout.navButton,
  active: layout.navActive,
  "sidebar-profile": layout.profile,
  "profile-avatar": layout.avatar,
  "dashboard-main": layout.main,
  topbar: layout.topbar,
  breadcrumb: layout.breadcrumb,
  "environment-badge": layout.environment,
  "dashboard-canvas": layout.canvas,
  "page-header": layout.header,
  eyebrow: layout.eyebrow,
  "header-actions": layout.actions,
  "jobs-overview": layout.overview,
  "stats-grid": layout.stats,
  "stat-card": layout.stat,
  "stat-label": layout.statLabel,
  "stat-value": layout.statValue,
  "stat-note": layout.statNote,
  "jobs-layout": layout.jobsLayout,
  "has-detail": layout.withDetail,
  "jobs-panel": layout.panel,
  "panel-heading": layout.panelHeading,
  "state-tabs": layout.tabs,
  "state-tab": layout.tab,
  "active-tab": layout.tabActive,
  "table-scroll": layout.scroll,
  "jobs-table": layout.table,
  "job-identity": layout.identity,
  "job-icon": layout.jobIcon,
  "job-name": layout.jobName,
  "job-id": layout.jobId,
  "queue-cell": layout.cell,
  "updated-cell": layout.cell,
  "failure-cell": layout.cell,
  selected: styles.selected,
  pagination: layout.pagination,
  "empty-state": layout.empty,
  "detail-panel": layout.detail,
  "detail-heading": layout.detailHeading,
  "scenario-panel": layout.scenario,
  "scenario-summary-title": layout.summaryTitle,
  "scenario-body": layout.scenarioBody,
  "session-bar": layout.session,
  "sandbox-scope": layout.scope,
  muted: styles.muted
} satisfies Record<string, stylex.StyleXStyles>
export const classes = (names: string) => {
  const props = stylex.props(
    names.endsWith("-cell") && layout.td,
    ...names.split(" ").map((name) => classStyles[name as keyof typeof classStyles])
  )
  return { ...props, className: [names, props.className].filter(Boolean).join(" ") }
}
