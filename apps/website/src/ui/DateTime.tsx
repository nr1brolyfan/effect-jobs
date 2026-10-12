import * as stylex from "@stylexjs/stylex"
import { useId } from "react"
import { formatDateTime } from "./DateTimeFormat.js"
import * as Popover from "./Popover.js"
import { styles } from "./DateTime.stylex.js"

export interface DateTimeProps {
  readonly value: number | null | undefined
  readonly seconds?: boolean
  readonly label?: string
}

export function DateTime({ value, seconds = true, label = "Timestamp" }: DateTimeProps) {
  const headingId = useId()
  const formatted = formatDateTime(value, { seconds })
  if (!formatted) {
    return (
      <span {...stylex.props(styles.absent)}>
        {value === null || value === undefined ? "Not recorded" : "Invalid timestamp"}
      </span>
    )
  }
  return (
    <Popover.Root>
      <Popover.Trigger
        variant="timestamp"
        {...stylex.props(styles.trigger)}
        type="button"
        aria-label={`${label}: ${formatted.compact} (${formatted.timeZone}). Show exact local and UTC time`}
      >
        <time dateTime={formatted.iso}>{formatted.compact}</time>
        <span {...stylex.props(styles.hint)} aria-hidden="true">
          local
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8}>
          <Popover.Popup aria-labelledby={headingId}>
            <div {...stylex.props(styles.details)}>
              <h3 {...stylex.props(styles.heading)} id={headingId}>
                {label}
              </h3>
              <dl {...stylex.props(styles.list)}>
                <dt {...stylex.props(styles.term)}>Local · {formatted.timeZone}</dt>
                <dd {...stylex.props(styles.value)}>
                  <time dateTime={formatted.iso}>{formatted.local}</time>
                </dd>
                <dt {...stylex.props(styles.term)}>UTC</dt>
                <dd {...stylex.props(styles.value)}>
                  <time dateTime={formatted.iso}>{formatted.utc}</time>
                </dd>
                <dt {...stylex.props(styles.term)}>ISO 8601 · UTC</dt>
                <dd {...stylex.props(styles.iso)}>{formatted.iso}</dd>
              </dl>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
