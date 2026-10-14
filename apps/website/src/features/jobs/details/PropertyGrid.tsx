import type { ReactNode } from "react"
import * as stylex from "@stylexjs/stylex"
import { DateTime } from "../../../ui/DateTime.js"
import { styles } from "./PropertyGrid.stylex.js"

export interface Property {
  readonly label: string
  readonly value: ReactNode
  readonly mono?: boolean
}

export function PropertyGrid({ items }: { readonly items: readonly Property[] }) {
  return (
    <dl {...stylex.props(styles.grid)}>
      {items.map(({ label, value, mono }) => (
        <div key={label} {...stylex.props(styles.row)}>
          <dt {...stylex.props(styles.term)}>{label}</dt>
          <dd {...stylex.props(styles.value, mono && styles.mono)}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Absent({ reason = "Not recorded" }: { readonly reason?: string }) {
  return (
    <span {...stylex.props(styles.absent)} aria-label={reason} title={reason}>
      —
    </span>
  )
}

export function DetailTime({
  value,
  label
}: {
  readonly value: number | null | undefined
  readonly label: string
}) {
  return value == null ? (
    <Absent reason={`${label} not recorded`} />
  ) : (
    <DateTime value={value} label={label} />
  )
}

export function DetailHelp({
  summary = "About these facts",
  children
}: {
  readonly summary?: string
  readonly children: ReactNode
}) {
  return (
    <details {...stylex.props(styles.help)}>
      <summary {...stylex.props(styles.summary)}>{summary}</summary>
      <p {...stylex.props(styles.explanation)}>{children}</p>
    </details>
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
