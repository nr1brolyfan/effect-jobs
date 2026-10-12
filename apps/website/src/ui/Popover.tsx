// Adapted from shadcn-cssinjs (MIT); see Primitives.LICENSE and Primitives.md.
import { Popover as BasePopover } from "@base-ui/react/popover"
import * as stylex from "@stylexjs/stylex"
import { forwardRef } from "react"
import { styles } from "./Popover.stylex.js"
import { styles as controls } from "./Primitives.stylex.js"

export const Root = BasePopover.Root
export const Portal = BasePopover.Portal
export const Title = BasePopover.Title
export const Description = BasePopover.Description
export type RootProps = BasePopover.Root.Props
export type TriggerProps = BasePopover.Trigger.Props & {
  readonly variant?: "default" | "timestamp"
}
export type PortalProps = BasePopover.Portal.Props
export type PositionerProps = BasePopover.Positioner.Props
export type PopupProps = BasePopover.Popup.Props
export type CloseProps = BasePopover.Close.Props

export const Trigger = forwardRef<HTMLButtonElement, TriggerProps>(function Trigger(
  { className, variant = "default", ...props },
  ref
) {
  return (
    <BasePopover.Trigger
      {...props}
      ref={ref}
      className={(state) =>
        [
          // Timestamp callers supply one complete StyleX result, without button defaults.
          variant === "default"
            ? stylex.props(controls.button, controls.ghost).className
            : undefined,
          typeof className === "function" ? className(state) : className
        ]
          .filter(Boolean)
          .join(" ")
      }
    />
  )
})

export const Positioner = forwardRef<HTMLDivElement, PositionerProps>(function Positioner(
  { className, sideOffset = 8, ...props },
  ref
) {
  return (
    <BasePopover.Positioner
      {...props}
      ref={ref}
      sideOffset={sideOffset}
      className={(state) =>
        [
          stylex.props(styles.positioner).className,
          typeof className === "function" ? className(state) : className
        ]
          .filter(Boolean)
          .join(" ")
      }
    />
  )
})

export const Popup = forwardRef<HTMLDivElement, PopupProps>(function Popup(
  { className, ...props },
  ref
) {
  return (
    <BasePopover.Popup
      {...props}
      ref={ref}
      className={(state) =>
        [
          stylex.props(styles.popup).className,
          typeof className === "function" ? className(state) : className
        ]
          .filter(Boolean)
          .join(" ")
      }
    />
  )
})

export const Close = forwardRef<HTMLButtonElement, CloseProps>(function Close(
  { className, ...props },
  ref
) {
  return (
    <BasePopover.Close
      {...props}
      ref={ref}
      className={(state) =>
        [
          stylex.props(controls.button, controls.secondary).className,
          typeof className === "function" ? className(state) : className
        ]
          .filter(Boolean)
          .join(" ")
      }
    />
  )
})
