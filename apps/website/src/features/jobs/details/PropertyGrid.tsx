import type { ReactNode } from "react"
import * as stylex from "@stylexjs/stylex"
import { DateTime } from "../../../ui/DateTime.js"
import { styles } from "./PropertyGrid.stylex.js"

export interface Property {
  readonly label: string
  readonly value: ReactNode
  readonly mono?: boolean
}

export function PropertyGrid(props: { readonly items: readonly Property[] }) {
  return (
    <dl {...stylex.props(styles.grid)}>
      {props.items.map((item) => {
        return (
          <div key={item.label} {...stylex.props(styles.row)}>
            <dt {...stylex.props(styles.term)}>{item.label}</dt>
            <dd {...stylex.props(styles.value, item.mono && styles.mono)}>
              {item.value}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

export function Absent(inputProps: { readonly reason?: string }) {
  const { reason = "Not recorded" } = inputProps

  return (
    <span {...stylex.props(styles.absent)} aria-label={reason} title={reason}>
      —
    </span>
  )
}

export function DetailTime(inputProps: {
  readonly value: number | null | undefined
  readonly label: string
}) {
  return inputProps.value == null ? (
    <Absent reason={`${inputProps.label} not recorded`} />
  ) : (
    <DateTime value={inputProps.value} label={inputProps.label} />
  )
}

export function formatDuration(millis: number): string {
  const units = [
    [86_400_000, "days"],
    [3_600_000, "h"],
    [60_000, "min"],
    [1_000, "s"]
  ] as const
  for (const [scale, unit] of units) {
    if (millis >= scale && millis % scale === 0) {
      return `${millis / scale} ${unit}`
    }
  }
  return millis >= 1_000 ? `${millis / 1_000} s` : `${millis} ms`
}
