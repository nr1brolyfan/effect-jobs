import { ArrowRight } from "lucide-react"
import { useEffect, useState } from "react"
import { LabNode, LabPlayback, type LabIcon } from "./LabUI.js"
import "./DocsTrace.css"

export type TraceFrame = {
  readonly label: string
  readonly detail: string
  readonly nodes: readonly [readonly string[], readonly string[], readonly string[]]
  readonly packet?: {
    readonly from: 0 | 1 | 2
    readonly to: 0 | 1 | 2
    readonly label: string
    readonly tone?: "violet" | "amber" | "green"
  }
}
type Scenario = { readonly title: string; readonly frames: readonly TraceFrame[] }
export type Trace = {
  readonly title: string
  readonly nodes: readonly {
    readonly title: string
    readonly icon: LabIcon
    readonly fields: readonly string[]
  }[]
  readonly scenarios: readonly Scenario[]
}

export default function DocsTrace({ trace }: { readonly trace: Trace }) {
  const [selected, select] = useState(0)
  const [step, seek] = useState(0)
  const [playing, play] = useState(false)
  const { frames } = trace.scenarios[selected]!
  const frame = frames[step]!
  const last = step === frames.length - 1
  const packet = frame.packet
  const edge = packet ? Math.min(packet.from, packet.to) : -1

  useEffect(() => {
    if (!playing || last) {
      return
    }
    const next = window.setTimeout(() => seek(step + 1), 1350)
    return () => window.clearTimeout(next)
  }, [playing, last, step, selected])

  return (
    <figure className="wd dt" aria-label={trace.title}>
      {trace.scenarios.length > 1 && (
        <div className="dt-modes wd-actions" role="group" aria-label="Scenario">
          {trace.scenarios.map((scenario, index) => (
            <button
              key={scenario.title}
              type="button"
              aria-pressed={selected === index}
              onClick={() => {
                select(index)
                seek(0)
                play(false)
              }}
            >
              {scenario.title}
            </button>
          ))}
        </div>
      )}
      <div className="dt-stage">
        {trace.nodes.map((node, index) => {
          const values = frame.nodes[index]!
          return (
            <div className="dt-cell" key={node.title}>
              <LabNode
                className="dt-node"
                title={node.title}
                icon={node.icon}
                highlight={
                  packet && (packet.from === index || packet.to === index)
                    ? (packet.tone ?? "violet")
                    : undefined
                }
              >
                <dl>
                  {node.fields.map((field, i) => (
                    <div key={field}>
                      <dt>{field}</dt>
                      <dd>{values[i]}</dd>
                    </div>
                  ))}
                </dl>
              </LabNode>
              {index < trace.nodes.length - 1 && (
                <div className="dt-edge" aria-hidden="true">
                  <div className="dt-wire" />
                  {edge === index && packet && (
                    <div
                      key={`${selected}-${step}`}
                      className="dt-packet"
                      data-direction={packet.from < packet.to ? "out" : "back"}
                      data-tone={packet.tone ?? "violet"}
                    >
                      <span>{packet.label}</span>
                      <ArrowRight />
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <figcaption className="wd-footer dt-caption">
        <div className="dt-reading" aria-live={playing && !last ? "off" : "polite"}>
          <div className="wd-status">
            <span className="dt-counter">
              {step + 1}/{frames.length}
            </span>{" "}
            {frame.label}
          </div>
          <div className="wd-plan">{frame.detail}</div>
        </div>
        <LabPlayback
          playing={playing}
          ended={last}
          atStart={step === 0}
          onToggle={() => {
            if (last) {
              seek(0)
            }
            play(last || !playing)
          }}
          onNext={() => {
            play(false)
            seek(step + 1)
          }}
          onPrevious={() => {
            play(false)
            seek(step - 1)
          }}
          onReset={() => {
            seek(0)
            play(false)
          }}
        />
      </figcaption>
    </figure>
  )
}
