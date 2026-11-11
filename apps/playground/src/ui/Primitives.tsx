import {
  LayoutGrid,
  BriefcaseBusiness,
  Activity,
  Layers,
  Settings,
  ChevronRight,
  ChevronDown,
  Search,
  RefreshCw,
  Plus,
  Check,
  Clock,
  TriangleAlert,
  ArrowRight,
  BookOpen,
  ShieldCheck,
  X,
  ListFilter,
  Code,
  Mail,
  Image,
  Webhook,
  Upload,
  Terminal,
  Globe
} from "lucide-react"
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

// Named imports keep standard graphics in Lucide and preserve existing sizing.
const icons = {
  grid: LayoutGrid,
  jobs: BriefcaseBusiness,
  activity: Activity,
  layers: Layers,
  settings: Settings,
  chevron: ChevronRight,
  down: ChevronDown,
  search: Search,
  refresh: RefreshCw,
  plus: Plus,
  check: Check,
  clock: Clock,
  alert: TriangleAlert,
  arrow: ArrowRight,
  book: BookOpen,
  shield: ShieldCheck,
  close: X,
  filter: ListFilter,
  code: Code,
  mail: Mail,
  image: Image,
  webhook: Webhook,
  upload: Upload,
  terminal: Terminal,
  globe: Globe
} as const
export type IconName = keyof typeof icons
export function Icon(inputProps: { readonly name: IconName; readonly size?: number }) {
  const Component = icons[inputProps.name]
  return (
    <Component
      {...stylex.props(styles.icon)}
      size={inputProps.size ?? 18}
      strokeWidth={1.5}
      aria-hidden="true"
      focusable="false"
    />
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
