import { ArrowRight } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { LabNode, LabPlayback, LabSlider } from "./LabUI.js"
import { drainTrace, initialLimits, jobLabel, type Limits } from "./WorkerDrainTrace.js"
import "./WorkerDrainVisual.css"

const fields = [
  { name: "concurrency", label: "Concurrency", max: 8 },
  { name: "maxJobs", label: "Max jobs per drain", max: 16 },
  { name: "recovery", label: "Recovery limit", max: 8 },
  { name: "workers", label: "Workers", max: 3 }
] as const

export default function WorkerDrainVisual() {
  const [limits, setLimits] = useState(initialLimits)
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const { frames, peak, durationSeconds, jobsPerMinute } = useMemo(
    () => drainTrace(limits),
    [limits]
  )
  const current = frames[step] ?? frames[0]!
  const last = frames.length - 1
  const ended = step === last

  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(true)
  }, [])

  useEffect(() => {
    if (!playing || ended) return
    const timer = window.setTimeout(() => setStep(step + 1), step <= 2 ? 850 : 500)
    return () => window.clearTimeout(timer)
  }, [ended, playing, step, frames])

  const change = (name: keyof Limits, value: number) => {
    setLimits((previous) => ({ ...previous, [name]: value }))
    setStep(name === "recovery" || name === "workers" ? 1 : 3)
    setPlaying(!window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  }

  return (
    <figure className="wd" aria-label="Simulated PostgreSQL worker drain">
      <div className="wd-settings" role="group" aria-label="Drain settings">
        {fields.map(({ name, label, max }) => (
          <LabSlider
            key={name}
            label={label}
            max={max}
            value={limits[name]}
            onChange={(value) => change(name, value)}
          />
        ))}
      </div>

      <div className="wd-stage" data-workers={limits.workers}>
        <LabNode
          title="PostgreSQL"
          icon="database"
          label="PostgreSQL queue"
          className="wd-db"
          meta={<code>jobs</code>}
        >
          <dl>
            <div>
              <dt>Ready</dt>
              <dd>{current.pending}</dd>
            </div>
            <div>
              <dt>Active</dt>
              <dd data-tone="violet">{current.active}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd data-tone="green">{current.completed}</dd>
            </div>
            <div>
              <dt>Expired leases</dt>
              <dd data-tone="amber">{current.expired}</dd>
            </div>
            <div>
              <dt>Recovered this run</dt>
              <dd>{current.recovered}</dd>
            </div>
          </dl>
        </LabNode>

        <div className="wd-workers">
          {current.workers.map((worker, index) => {
            const running = worker.slots.filter((job) => job?.phase === "run").length
            const finished =
              (worker.started === limits.maxJobs || ended) &&
              worker.slots.every((job) => job === null)
            return (
              <div key={index} className="wd-worker-row">
                <div className="wd-link" aria-hidden="true">
                  <div className="wd-wire" />
                  {worker.packets.map((packet, position) => (
                    <div
                      className="wd-flight"
                      key={`${step}-${packet.kind}-${packet.text}`}
                      data-direction={
                        packet.kind === "claim" || packet.kind === "recovered"
                          ? "out"
                          : "back"
                      }
                      data-kind={packet.kind}
                      style={{
                        top: `calc(var(--wd-junction) + ${(position - (worker.packets.length - 1) / 2) * 24}px)`
                      }}
                    >
                      <span>{packet.text}</span>
                      {packet.kind === "claim" && (
                        <small>
                          {packet.ordinal}/{limits.maxJobs}
                        </small>
                      )}
                      <ArrowRight />
                    </div>
                  ))}
                </div>
                <LabNode
                  title={`Worker ${index + 1}`}
                  icon="worker"
                  className="wd-worker"
                  active={running > 0}
                  meta={<span>{finished ? "Drain finished" : `${running} running`}</span>}
                >
                  <div className="wd-worker-body">
                    <div className="wd-slots" aria-label="Execution slots">
                      {worker.slots.map((job, slot) => (
                        <span
                          key={slot}
                          data-phase={job?.phase ?? "free"}
                          title={
                            job
                              ? `${jobLabel(job.id)} · ${job.phase === "claim" ? "Claimed" : job.phase === "run" ? "Running" : "Finalizing"}`
                              : "Free permit"
                          }
                        >
                          {job ? jobLabel(job.id) : "·"}
                        </span>
                      ))}
                    </div>
                    <dl>
                      <div>
                        <dt>Started this drain</dt>
                        <dd>
                          {worker.started}
                          <span> / {limits.maxJobs}</span>
                        </dd>
                      </div>
                      <div>
                        <dt>Recovered this drain</dt>
                        <dd>
                          {worker.recovered}
                          <span> / {limits.recovery}</span>
                        </dd>
                      </div>
                    </dl>
                  </div>
                </LabNode>
              </div>
            )
          })}
        </div>
      </div>

      <div className="wd-legend" aria-label="Packet legend">
        <span data-tone="amber">
          <i /> Recovery request / result
        </span>
        <span data-tone="violet">
          <i /> Claimed job
        </span>
        <span data-tone="green">
          <i /> Finalize job
        </span>
      </div>

      <div className="wd-stats" role="group" aria-label="Simulated drain statistics">
        <div>
          <strong>{Math.round(jobsPerMinute)}</strong>
          <span>
            jobs/min <small>· simulated</small>
          </span>
        </div>
        <div>
          <strong>{durationSeconds.toFixed(1)} s</strong>
          <span>drain time</span>
        </div>
        <div>
          <strong>{peak}</strong>
          <span>peak running</span>
        </div>
      </div>

      <figcaption className="wd-footer">
        <div>
          <div className="wd-status" aria-live={playing && !ended ? "off" : "polite"}>
            {ended
              ? `Drain complete · ${current.completed} completed`
              : step === 0
                ? "Ready to drain"
                : step === 1
                  ? "Recovering expired leases"
                  : step === 2
                    ? `${current.recovered} recovered · claims next`
                    : `${current.running} running · ${current.completed} completed`}
          </div>
          <div className="wd-plan">
            {ended
              ? current.pending > 0
                ? `${current.pending} ready for the next drain`
                : "No ready jobs left"
              : `This drain: up to ${limits.maxJobs * limits.workers} starts across ${limits.workers} ${limits.workers === 1 ? "worker" : "workers"}`}
          </div>
        </div>
        <LabPlayback
          playing={playing}
          ended={ended}
          onToggle={() => {
            if (ended) setStep(0)
            setPlaying(ended || !playing)
          }}
          onNext={() => {
            setPlaying(false)
            setStep(step + 1)
          }}
          onReset={() => {
            setPlaying(false)
            setStep(0)
          }}
        />
      </figcaption>
    </figure>
  )
}
