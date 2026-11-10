// Adapted from shadcn-cssinjs (MIT); see Primitives.LICENSE and Primitives.md.
import { Tabs as BaseTabs } from "@base-ui/react/tabs"
import * as stylex from "@stylexjs/stylex"
import {
  cloneElement,
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode
} from "react"
import type { JobSummary } from "@effect-jobs/playground-contracts/Jobs"
import type { IconName } from "../features/jobs/Design.js"
import { stateLabels } from "./Theme.stylex.js"
import { styles } from "./Primitives.stylex.js"

export type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  readonly variant?: "primary" | "secondary" | "ghost"
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(inputProps, ref) {
    const { variant = "secondary", type = "button", className, ...props } = inputProps

    const styled = stylex.props(styles.button, styles[variant])
    return (
      <button
        {...props}
        {...styled}
        className={[styled.className, className].filter(Boolean).join(" ")}
        type={type}
        ref={ref}
      />
    )
  }
)

export const Panel = forwardRef<HTMLElement, ComponentPropsWithoutRef<"section">>(
  function Panel(inputProps, ref) {
    const { className, ...props } = inputProps

    const styled = stylex.props(styles.panel)
    return (
      <section
        {...props}
        {...styled}
        className={[styled.className, className].filter(Boolean).join(" ")}
        ref={ref}
      />
    )
  }
)

export function Badge(props: {
  readonly state: JobSummary["state"]
  readonly children?: ReactNode
}) {
  return (
    <span {...stylex.props(styles.badge, styles[props.state])}>
      <span {...stylex.props(styles.dot)} aria-hidden="true" />
      <span>{stateLabels[props.state]}</span>
      {props.children}
    </span>
  )
}

export function Field(inputProps: {
  readonly label: string
  readonly children: ReactElement<{ id?: string }>
}) {
  const generatedId = useId()
  const id = inputProps.children.props.id || generatedId
  // Custom controls receive only the association; they must forward id to their
  // labelable input. Native controls get the same compiled focus/control styles.
  let control: ReactNode = cloneElement(inputProps.children, { id })
  if (
    inputProps.children.type === "input" ||
    inputProps.children.type === "select" ||
    inputProps.children.type === "textarea"
  ) {
    const native = inputProps.children as ReactElement<ComponentPropsWithoutRef<"input">>
    const styled = stylex.props(
      styles.control,
      (native.props.type === "checkbox" || native.props.type === "radio") &&
        styles.checkbox
    )
    control = cloneElement(native, {
      id,
      className: [styled.className, native.props.className].filter(Boolean).join(" "),
      style: { ...styled.style, ...native.props.style }
    })
  }
  return (
    <div {...stylex.props(styles.field)}>
      <label {...stylex.props(styles.label)} htmlFor={id}>
        {inputProps.label}
      </label>
      {control}
    </div>
  )
}

// Design's path registry is private; retain its exact paths here for pure React
// rendering (including SSR), rather than constructing DOM nodes during render.
const iconPaths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  jobs: "M8 4h8v4H8z M5 8h14v12H5z M9 12h6 M9 16h4",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  layers: "m12 3 9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5",
  settings:
    "M9 3h6l1 4 4 1v8l-4 1-1 4H9l-1-4-4-1V8l4-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  chevron: "m9 5 7 7-7 7",
  down: "m7 10 5 5 5-5",
  search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0 M15 15l5 5",
  refresh: "M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-1l2 6 M18 17a7 7 0 0 1-12 1l-2-6",
  plus: "M12 5v14 M5 12h14",
  check: "m5 12 4 4L19 6",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2",
  alert: "m12 3 10 18H2z M12 9v5 M12 17h.01",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  book: "M12 5v15 M12 5C8 2 4 3 3 4v15c4-2 6-1 9 1 3-2 5-3 9-1V4c-4-2-6-1-9 1",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z m-4 9 3 3 5-5",
  close: "m6 6 12 12 M6 18 18 6",
  filter: "M4 7h16 M7 12h10 M10 17h4",
  code: "m8 6-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18",
  mail: "M3 5h18v14H3z m0 1 9 7 9-7",
  image: "M3 3h18v18H3z m0 14 6-6 5 5 3-3 4 4 M15 7h.01",
  webhook:
    "M8 7a3 3 0 1 1 5 2 M5 15a3 3 0 1 0 5 3 M16 15a3 3 0 1 1 1 6 M10 9l-3 6 M12 8l5 7 M10 18h6",
  upload: "M12 16V3 m-5 5 5-5 5 5 M4 15v6h16v-6",
  terminal: "m5 7 5 5-5 5 M13 17h6",
  globe: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18"
} as const

export function Icon(inputProps: { readonly name: IconName; readonly size?: number }) {
  const { name, size = 18 } = inputProps

  return (
    <svg
      {...stylex.props(styles.icon)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={iconPaths[name]} />
    </svg>
  )
}

// Controlled values and onValueChange use the pinned Base UI Root contract.
export const TabsRoot = BaseTabs.Root
export type TabsRootProps = BaseTabs.Root.Props
export type TabsListProps = BaseTabs.List.Props & { readonly wrap?: boolean }
export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  function TabsList(inputProps, ref) {
    const { className, activateOnFocus = false, wrap = true, ...props } = inputProps

    return (
      <BaseTabs.List
        {...props}
        ref={ref}
        activateOnFocus={activateOnFocus}
        className={(state) =>
          [
            stylex.props(
              styles.tabsList,
              !wrap && styles.tabsNoWrap,
              state.orientation === "vertical" && styles.tabsVertical
            ).className,
            typeof className === "function" ? className(state) : className
          ]
            .filter(Boolean)
            .join(" ")
        }
      />
    )
  }
)

export type TabsTabProps = BaseTabs.Tab.Props & { readonly count?: number }
export const TabsTab = forwardRef<HTMLElement, TabsTabProps>(
  function TabsTab(inputProps, ref) {
    const { className, children, count, ...props } = inputProps

    return (
      <BaseTabs.Tab
        {...props}
        ref={ref}
        className={(state) =>
          [
            stylex.props(styles.button, styles.tab, state.active && styles.tabActive)
              .className,
            typeof className === "function" ? className(state) : className
          ]
            .filter(Boolean)
            .join(" ")
        }
      >
        {children}
        {count === undefined ? null : (
          <>
            {" "}
            <span {...stylex.props(styles.tabCount)}>{count.toLocaleString()}</span>
          </>
        )}
      </BaseTabs.Tab>
    )
  }
)

export type TabsPanelProps = BaseTabs.Panel.Props
export const TabsPanel = forwardRef<HTMLDivElement, TabsPanelProps>(
  function TabsPanel(inputProps, ref) {
    const { className, ...props } = inputProps

    return (
      <BaseTabs.Panel
        {...props}
        ref={ref}
        className={(state) =>
          [
            stylex.props(styles.tabsPanel).className,
            typeof className === "function" ? className(state) : className
          ]
            .filter(Boolean)
            .join(" ")
        }
      />
    )
  }
)
