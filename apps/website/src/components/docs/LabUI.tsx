// The Base UI slider follows the shadcn-cssinjs slider (MIT; see apps/playground/src/ui/Primitives.LICENSE).
import { Slider } from "@base-ui/react/slider"
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Database,
  Mail,
  Pause,
  Play,
  RotateCcw,
  Send
} from "lucide-react"
import type { ReactNode } from "react"
import "./LabUI.css"

const icons = { database: Database, worker: Bot, producer: Send, provider: Mail }
export type LabIcon = keyof typeof icons

export function LabNode({
  title,
  label,
  meta,
  icon,
  className,
  highlight,
  active,
  children
}: {
  readonly title: string
  readonly label?: string
  readonly meta?: ReactNode
  readonly icon: LabIcon
  readonly className?: string
  readonly highlight?: "amber" | "violet" | "green" | undefined
  readonly active?: boolean
  readonly children: ReactNode
}) {
  const Icon = icons[icon]
  return (
    <section
      className={className ? `wd-node ${className}` : "wd-node"}
      aria-label={label ?? title}
      data-icon={icon}
      data-highlight={highlight}
      data-active={active}
    >
      <header>
        <Icon aria-hidden="true" />
        <strong>{title}</strong>
        {meta}
      </header>
      {children}
    </section>
  )
}

export function LabSlider({
  label,
  min = 1,
  max,
  step,
  value,
  format = String,
  onChange
}: {
  readonly label: string
  readonly min?: number
  readonly max: number
  readonly step?: number
  readonly value: number
  readonly format?: (value: number) => string
  readonly onChange: (value: number) => void
}) {
  return (
    <div className="wd-setting">
      <div className="wd-setting-title" aria-hidden="true">
        <span>{label}</span>
        <b>{format(value)}</b>
      </div>
      <Slider.Root
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onValueChange={onChange}
      >
        <Slider.Control className="wd-control">
          <Slider.Track className="wd-track">
            <Slider.Indicator className="wd-fill" />
          </Slider.Track>
          <Slider.Thumb
            className="wd-thumb"
            getAriaLabel={() => label}
            getAriaValueText={(_, current) => format(current)}
          />
        </Slider.Control>
      </Slider.Root>
    </div>
  )
}

export function LabPlayback({
  playing,
  ended,
  atStart,
  onToggle,
  onNext,
  onPrevious,
  onReset
}: {
  readonly playing: boolean
  readonly ended: boolean
  readonly atStart?: boolean
  readonly onToggle: () => void
  readonly onNext: () => void
  readonly onPrevious?: () => void
  readonly onReset: () => void
}) {
  const active = playing && !ended
  return (
    <div className="wd-actions" role="group" aria-label="Playback">
      {onPrevious && (
        <button
          type="button"
          disabled={atStart}
          aria-label="Previous event"
          onClick={onPrevious}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
      )}
      <button type="button" className="wd-primary" onClick={onToggle}>
        {active ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        {ended ? "Replay" : active ? "Pause" : "Play"}
      </button>
      <button type="button" disabled={ended} onClick={onNext}>
        Step <ArrowRight aria-hidden="true" />
      </button>
      <button type="button" aria-label="Reset playback" onClick={onReset}>
        <RotateCcw aria-hidden="true" />
      </button>
    </div>
  )
}
