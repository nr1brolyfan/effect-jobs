/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned atom-react 4.0.5 is the supported Effect Atom subscription API. */
import * as stylex from "@stylexjs/stylex"
import type { ReactNode, RefObject } from "react"
import { Button, Icon } from "../../ui/Primitives.js"
import type { IconName } from "../../ui/Primitives.js"
import { classes } from "./DashboardClasses.js"
import { layout } from "./Dashboard.stylex.js"
const navigation: ReadonlyArray<readonly [string, IconName]> = [
  ["Overview", "grid"],
  ["Background Jobs", "jobs"],
  ["Activity", "activity"],
  ["Integrations", "layers"],
  ["Settings", "settings"]
]

export const DashboardLayout = (props: {
  readonly demo: boolean
  readonly children: ReactNode
  readonly scenariosPanel: RefObject<HTMLDetailsElement | null>
  readonly scenarioControl: RefObject<HTMLSelectElement | null>
}) => (
  <div {...classes("jobs-app")}>
    <aside {...classes("sidebar")} aria-label="Workspace navigation">
      <div {...classes("brand")}>
        <span {...classes("brand-mark")}>
          <Icon name="layers" />
        </span>
        <div {...stylex.props(layout.desktop)}>
          <strong>effect-jobs</strong>
          <span {...stylex.props(layout.sublabel)}>Developer console</span>
        </div>
      </div>
      <Button
        variant="ghost"
        {...classes("workspace-switcher")}
        aria-label="Playground workspace"
      >
        <span {...classes("workspace-avatar")}>P</span>
        <span {...stylex.props(layout.controlText)}>
          <strong>Playground</strong>
          <span {...stylex.props(layout.sublabel)}>Personal workspace</span>
        </span>
        <Icon name="down" />
      </Button>
      <nav {...classes("sidebar-navigation")} aria-label="Main navigation">
        <p {...stylex.props(layout.navLabel)}>WORKSPACE</p>
        {navigation.map(([label, icon]) => (
          <Button
            key={label}
            {...classes(`sidebar-item${label === "Background Jobs" ? " active" : ""}`)}
            disabled={label !== "Background Jobs"}
            aria-current={label === "Background Jobs" ? "page" : undefined}
            title={
              label === "Background Jobs" ? undefined : "Not available in this playground"
            }
          >
            <Icon name={icon} />
            {label}
          </Button>
        ))}
      </nav>
      <Button
        variant="ghost"
        {...classes("sidebar-profile")}
        aria-label={
          props.demo
            ? "Demo viewer · Public · read only"
            : "Demo admin · Isolated sandbox"
        }
      >
        <span {...classes("profile-avatar")}>DA</span>
        <span {...stylex.props(layout.desktop, layout.controlText)}>
          <strong>{props.demo ? "Demo viewer" : "Demo admin"}</strong>
          <span {...stylex.props(layout.sublabel)}>
            {props.demo ? "Public · read only" : "Isolated sandbox"}
          </span>
        </span>
        <span {...stylex.props(layout.desktop)}>
          <Icon name="down" />
        </span>
      </Button>
    </aside>
    <div {...classes("dashboard-main")}>
      <div {...classes("topbar")}>
        <nav {...classes("breadcrumb")} aria-label="Breadcrumb">
          <Button variant="ghost" {...stylex.props(layout.breadcrumbButton)}>
            <Icon name="grid" />
            Workspace
          </Button>
          <Icon name="chevron" />
          <Button
            variant="ghost"
            {...stylex.props(layout.breadcrumbButton)}
            aria-current="page"
          >
            Background Jobs
          </Button>
        </nav>
        <span {...classes("environment-badge")}>Local playground</span>
      </div>
      <div {...classes("dashboard-canvas")}>
        <header {...classes("page-header")}>
          <div>
            <h1 {...stylex.props(layout.title)}>Background Jobs</h1>
          </div>
          <div {...classes("header-actions")}>
            {!props.demo && (
              <Button
                variant="primary"
                onClick={() => {
                  if (props.scenariosPanel.current) {
                    props.scenariosPanel.current.open = true
                    props.scenariosPanel.current.scrollIntoView({
                      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                        ? "instant"
                        : "smooth",
                      block: "center"
                    })
                    props.scenarioControl.current?.focus({ preventScroll: true })
                  }
                }}
              >
                <Icon name="plus" />
                Create jobs
              </Button>
            )}
          </div>
        </header>
        {props.children}
      </div>
    </div>
  </div>
)
