/* oxlint-disable effecttsgo/unstable-api-usage -- Owner-selected Effect 4.0.5 Atom/React API. */
import * as stylex from "@stylexjs/stylex"
import { styles } from "./LandingStyles.js"
import { RegistryProvider, useAtom } from "@effect/atom-react"
import * as Atom from "effect/reactivity/Atom"
import { createElement, useEffect, useRef, useState } from "react"
import { registerPlaybackHost } from "../illustrations/PlaybackHost.js"
import { useVisibility } from "../illustrations/Playback.js"
import { frames, explanations, stateOf } from "./Storyboard.js"

registerPlaybackHost("ej-job-system")
interface Props {
  readonly enqueueSource: string
  readonly handlerSource: string
}
const reports = ["Monthly revenue", "Usage summary", "Invoice export", "Audit archive"]
const playbackAtom = Atom.make({ frame: 0, selected: 0, playing: false })
const escapeSource = (source: string) =>
  source.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

function Simulation(props: Props) {
  const root = useRef<HTMLElement>(null)
  const [playback, setPlayback] = useAtom(playbackAtom)
  const environment = useVisibility(
    root,
    () => setPlayback({ frame: 0, selected: 0, playing: false }),
    () => setPlayback((current) => ({ ...current, playing: false }))
  )
  const [announcement, setAnnouncement] = useState("")
  const { frame, selected } = playback
  const values: ReadonlyArray<string> = frames[frame]!
  const state = stateOf(values[selected]!)
  const region =
    state === "Pending" || state === "Awaiting request" ? "enqueue" : "handler"
  const update = (next: typeof playback) => {
    setPlayback(next)
    setAnnouncement(
      `${reports[next.selected]}: ${stateOf(frames[next.frame]![next.selected]!)}. Step ${next.frame + 1} of ${frames.length}.`
    )
  }
  const select = (index: number) =>
    update({ ...playback, selected: index, playing: false })
  const workerLabel = (worker: number) => {
    const job = values.findIndex((value) => value === `Active:${worker}`)
    return job < 0 ? "ready" : `report 0${job + 1}`
  }
  const detail = (index: number) => {
    const value = values[index]!
    switch (stateOf(value)) {
      case "Active":
        return `Worker ${Number(value.split(":")[1]) + 1} · attempt ${index === 1 && frame >= 9 ? 2 : 1}`
      case "RetryScheduled":
        return "Confirmed failure · waiting for stored delay"
      case "Completed":
        return "Finalization confirmed"
      case "Pending":
        return "Committed · waiting for a worker"
      case "Awaiting request":
        return "No job enqueued yet"
    }
  }
  // Observation and one bounded timeout are browser FFI, owned by this React effect.
  const initialized = useRef(false)
  useEffect(() => {
    if (!environment.ready || initialized.current) {
      return
    }
    initialized.current = true
    setPlayback((current) => ({ ...current, playing: !environment.reduced }))
  }, [environment.ready, environment.reduced, setPlayback])
  const running = playback.playing && environment.visible && !environment.reduced
  useEffect(() => {
    if (!running || frame === frames.length - 1) {
      return
    }
    const timer = setTimeout(
      () =>
        setPlayback((current) => ({
          ...current,
          frame: current.frame + 1,
          playing: current.frame + 1 < frames.length - 1
        })),
      2200
    )
    return () => clearTimeout(timer)
  }, [running, frame, setPlayback])
  return createElement(
    "ej-job-system",
    {
      ref: root,
      className: ["system", stylex.props(styles.element).className].join(" "),
      "aria-label": "Illustrated report jobs lifecycle",
      "data-playing": String(running)
    },
    <>
      <div
        className={["system-heading", stylex.props(styles.systemHeading).className]
          .filter(Boolean)
          .join(" ")}
      >
        <div>
          <span
            className={["tiny-mark", stylex.props(styles.tinyMark).className]
              .filter(Boolean)
              .join(" ")}
            aria-hidden="true"
          ></span>
          <strong {...stylex.props(styles.systemHeading2)}>reports</strong>
          <span
            className={["system-subtitle", stylex.props(styles.systemSubtitle).className]
              .filter(Boolean)
              .join(" ")}
          >
            {" "}
            / execution map
          </span>
        </div>
        <span
          className={["simulation", stylex.props(styles.simulation).className]
            .filter(Boolean)
            .join(" ")}
        >
          DETERMINISTIC ILLUSTRATION
        </span>
      </div>
      <div
        className={["system-body", stylex.props(styles.systemBody).className]
          .filter(Boolean)
          .join(" ")}
      >
        <div
          className={["flow-header", stylex.props(styles.flowHeader).className]
            .filter(Boolean)
            .join(" ")}
          aria-hidden="true"
        >
          <span>01 / REQUESTS</span>
          <span>02 / DURABLE QUEUE</span>
          <span>03 / WORKERS × 2</span>
          <span>04 / RESULT</span>
        </div>
        <div
          className={["flow-map", stylex.props(styles.flowMap).className]
            .filter(Boolean)
            .join(" ")}
          aria-hidden="true"
        >
          <div
            className={["request-node", stylex.props(styles.resultNode).className]
              .filter(Boolean)
              .join(" ")}
          >
            API
            <br />
            <small {...stylex.props(styles.flowMap2)}>report requests</small>
          </div>
          <div
            className={[
              "wire",
              stylex.props(running && styles.packet, styles.wire).className
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span {...stylex.props(styles.wire2)}>→</span>
          </div>
          <div
            className={["queue-node", stylex.props(styles.resultNode2).className]
              .filter(Boolean)
              .join(" ")}
          >
            <span>PostgreSQL</span>
            <small {...stylex.props(styles.flowMap2)}>reports queue</small>
            <div
              className={["queue-lines", stylex.props(styles.queueLines).className]
                .filter(Boolean)
                .join(" ")}
            >
              <i {...stylex.props(styles.queueLines2)}></i>
              <i {...stylex.props(styles.queueLines2)}></i>
              <i {...stylex.props(styles.queueLines2)}></i>
              <i {...stylex.props(styles.queueLines2)}></i>
            </div>
          </div>
          <div
            className={[
              "wire",
              stylex.props(running && styles.packet, styles.wire3).className
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span {...stylex.props(styles.wire2)}>→</span>
          </div>
          <div
            className={["worker-pair", stylex.props(styles.workerPair).className]
              .filter(Boolean)
              .join(" ")}
          >
            <div
              {...stylex.props(styles.resultNode3)}
              data-worker="0"
              data-busy={values.includes("Active:0")}
            >
              W1{" "}
              <span
                {...stylex.props(
                  styles.workerPair2,
                  values.includes("Active:0") && styles.workerPairSelected,
                  running && values.includes("Active:0") && styles.workerPulse
                )}
              >
                {workerLabel(0)}
              </span>
            </div>
            <div
              {...stylex.props(styles.resultNode3)}
              data-worker="1"
              data-busy={values.includes("Active:1")}
            >
              W2{" "}
              <span
                {...stylex.props(
                  styles.workerPair2,
                  values.includes("Active:1") && styles.workerPairSelected,
                  running && values.includes("Active:1") && styles.workerPulse
                )}
              >
                {workerLabel(1)}
              </span>
            </div>
          </div>
          <div
            className={[
              "wire",
              stylex.props(running && styles.packet, styles.wire).className
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span {...stylex.props(styles.wire2)}>→</span>
          </div>
          <div
            className={["result-node", stylex.props(styles.resultNode4).className]
              .filter(Boolean)
              .join(" ")}
          >
            ✓<small {...stylex.props(styles.flowMap2)}>Completed</small>
          </div>
          <div
            className={["retry-wire", stylex.props(styles.retryWire).className]
              .filter(Boolean)
              .join(" ")}
          >
            ↶{" "}
            <span {...stylex.props(styles.retryWire2)}>
              RetryScheduled · wait until available
            </span>
          </div>
        </div>
        <div
          className={["job-and-code", stylex.props(styles.jobAndCode).className]
            .filter(Boolean)
            .join(" ")}
        >
          <div
            className={["jobs", stylex.props(styles.jobs).className]
              .filter(Boolean)
              .join(" ")}
          >
            <div
              className={["panel-label", stylex.props(styles.panelLabel).className]
                .filter(Boolean)
                .join(" ")}
            >
              <span>SELECT A REPORT</span>
              <span data-capacity>
                {values.filter((value) => stateOf(value) === "Active").length} / 2 active
              </span>
            </div>
            {reports.map((report, i) => (
              <button
                type="button"
                className={[
                  "job",
                  stylex.props(
                    styles.element2,
                    (selected === i) === true && styles.jobSelected
                  ).className
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-job={i}
                aria-pressed={selected === i}
                disabled={!environment.ready}
                key={report}
                onClick={() => select(i)}
              >
                <>
                  <span
                    className={["job-number", stylex.props(styles.jobNumber).className]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    0{i + 1}
                  </span>
                  <span
                    className={["job-title", stylex.props(styles.jobTitle).className]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {report}
                    <small {...stylex.props(styles.jobTitle2)} data-detail>
                      {detail(i)}
                    </small>
                  </span>
                  <span
                    className={[
                      "state",
                      stylex.props(
                        styles.state,
                        stateOf(values[i]!) === "Active" && styles.elementActiveSelected,
                        stateOf(values[i]!) === "Completed" &&
                          styles.elementCompletedSelected,
                        stateOf(values[i]!) === "RetryScheduled" &&
                          styles.elementRetryScheduledSelected
                      ).className
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-state={stateOf(values[i]!)}
                  >
                    {stateOf(values[i]!)}
                  </span>
                </>
              </button>
            ))}
          </div>
          <div
            className={["code-panel", stylex.props(styles.codePanel).className]
              .filter(Boolean)
              .join(" ")}
          >
            <div
              className={["panel-label", stylex.props(styles.panelLabel2).className]
                .filter(Boolean)
                .join(" ")}
            >
              <span data-code-title>
                0{selected + 1} / {reports[selected]}
              </span>
              <span>PARTIAL · ReportWorkflow.ts</span>
            </div>
            <pre
              {...stylex.props(styles.element3)}
              tabIndex={0}
              aria-label={`Partial ${region} source for the selected report`}
            >
              <code {...stylex.props(styles.element4)} data-code>
                {region === "enqueue" ? props.enqueueSource : props.handlerSource}
              </code>
            </pre>
            <p {...stylex.props(styles.codePanel2)} data-explanation>
              {explanations[state]}
            </p>
            <a {...stylex.props(styles.element5)} href="/docs/start/tutorial">
              Build the checked report workflow →
            </a>
          </div>
        </div>
        <div
          className={["playback", stylex.props(styles.playback).className]
            .filter(Boolean)
            .join(" ")}
          hidden={!environment.ready}
        >
          <div
            className={[
              "playback-buttons",
              stylex.props(styles.playbackButtons).className
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <button
              {...stylex.props(styles.element6)}
              type="button"
              data-toggle
              onClick={() => update({ ...playback, playing: !playback.playing })}
              disabled={environment.reduced || frame === frames.length - 1}
            >
              {playback.playing ? "Pause" : "Play"}
            </button>
            <button
              {...stylex.props(styles.element6)}
              type="button"
              data-next
              onClick={() =>
                update({
                  ...playback,
                  frame: Math.min(frame + 1, frames.length - 1),
                  playing: false
                })
              }
              disabled={frame === frames.length - 1}
            >
              Next step <span aria-hidden="true">→</span>
            </button>
            <button
              {...stylex.props(styles.element6)}
              type="button"
              data-restart
              onClick={() => update({ ...playback, frame: 0, playing: false })}
            >
              Restart
            </button>
          </div>
          <span data-step>
            Step {frame + 1} / {frames.length}
          </span>
        </div>
        <p
          className={["sr-only", stylex.props(styles.srOnly).className]
            .filter(Boolean)
            .join(" ")}
          data-announcement
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </p>
      </div>
      <template
        data-source="enqueue"
        dangerouslySetInnerHTML={{
          __html: `<code>${escapeSource(props.enqueueSource)}</code>`
        }}
      />
      <template
        data-source="handler"
        dangerouslySetInnerHTML={{
          __html: `<code>${escapeSource(props.handlerSource)}</code>`
        }}
      />
      <div
        className={["system-footnote", stylex.props(styles.systemFootnote).className]
          .filter(Boolean)
          .join(" ")}
      >
        <span {...stylex.props(styles.systemFootnote2)}>●</span> Four synthetic jobs. Two
        worker slots. Select a report to inspect its current operation.
      </div>
      <p
        className={["no-script", stylex.props(styles.noScript).className]
          .filter(Boolean)
          .join(" ")}
      >
        Pending → Active → Completed. A confirmed retry waits in RetryScheduled until due,
        then can be claimed as Active again.
      </p>
    </>
  )
}
export default function System(props: Props) {
  return (
    <RegistryProvider>
      <Simulation {...props} />
    </RegistryProvider>
  )
}
