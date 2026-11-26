import { Clock3 } from "lucide-react"
import { useState, type CSSProperties } from "react"
import { LabNode, LabSlider } from "./LabUI.js"
import "./LeaseBudgetVisual.css"

const initial = { attempt: 2000, lease: 3000, reserve: 700, elapsed: 100 }
const fields = [
  { name: "attempt", label: "Attempt timeout", min: 500, max: 4000 },
  { name: "lease", label: "Lease duration", min: 500, max: 6000 },
  { name: "reserve", label: "Response budget", min: 100, max: 2000 },
  { name: "elapsed", label: "Elapsed since claim", min: 0, max: 3000 }
] as const
const ms = (value: number) => `${value} ms`

export default function LeaseBudgetVisual() {
  const [values, setValues] = useState(initial)
  const { attempt, lease, reserve, elapsed } = values
  const remaining = lease - elapsed
  const headroom = remaining - attempt - reserve
  const compatible = lease - attempt >= reserve
  const usable = compatible && headroom >= 0
  const scale = Math.max(lease, elapsed + attempt + reserve)
  const width = (duration: number) => `${(duration / scale) * 100}%`
  const decision = !compatible
    ? "Policy incompatible"
    : remaining <= 0
      ? "Lease expired"
      : !usable
        ? "Claim has too little time left"
        : headroom === 0
          ? "Usable at the minimum"
          : "Claim usable"

  return (
    <figure className="wd lb" aria-label="Claim lease and response budget simulator">
      <div className="wd-settings" role="group" aria-label="Timing settings">
        {fields.map(({ name, label, min, max }) => (
          <LabSlider
            key={name}
            label={label}
            min={min}
            max={max}
            step={100}
            value={values[name]}
            format={ms}
            onChange={(value) =>
              setValues((previous) => ({ ...previous, [name]: value }))
            }
          />
        ))}
      </div>
      <div className="lb-nodes">
        <LabNode title="PostgreSQL" icon="database" label="PostgreSQL lease">
          <dl>
            <div>
              <dt>Lease expires at</dt>
              <dd>{ms(lease)}</dd>
            </div>
            <div>
              <dt>Lease left at check</dt>
              <dd>{ms(Math.max(0, remaining))}</dd>
            </div>
          </dl>
        </LabNode>
        <div className="lb-bridge" aria-hidden="true">
          <span>Claim</span>
        </div>
        <LabNode title="Worker" icon="worker" label="Worker decision">
          <dl>
            <div>
              <dt>Required time</dt>
              <dd>{ms(attempt + reserve)}</dd>
            </div>
            <div>
              <dt>Handler admission</dt>
              <dd data-tone={usable ? "green" : "amber"}>
                {usable ? "Can start" : "Don't start"}
              </dd>
            </div>
          </dl>
        </LabNode>
      </div>
      <div
        className="lb-timeline"
        aria-hidden="true"
        style={{ "--lb-expiry": width(lease) } as CSSProperties}
      >
        <div className="lb-axis">
          <span>Claim · 0 ms</span>
          <span>{ms(scale)}</span>
        </div>
        <div className="lb-lanes">
          <div className="lb-lane">
            <span className="lb-lease" style={{ width: width(lease) }} />
          </div>
          <div className="lb-lane">
            <span className="lb-elapsed" style={{ width: width(elapsed) }} />
            <span className="lb-attempt" style={{ width: width(attempt) }} />
            <span className="lb-response" style={{ width: width(reserve) }} />
          </div>
        </div>
        <div className="wd-legend">
          <span>
            <i className="lb-lease" /> Lease
          </span>
          <span>
            <i className="lb-elapsed" /> Elapsed
          </span>
          <span>
            <i className="lb-attempt" /> Attempt
          </span>
          <span>
            <i className="lb-response" /> Response budget
          </span>
        </div>
      </div>
      <figcaption className="wd-footer">
        <div role="status">
          <div className="wd-status" data-tone={usable ? "green" : "amber"}>
            {decision}
          </div>
          <div className="wd-plan">
            {!compatible
              ? "The policy is too tight even with no elapsed time."
              : remaining <= 0
                ? "The expired lease no longer grants ownership."
                : headroom < 0
                  ? `Missing ${ms(-headroom)} of the required reserve.`
                  : `${ms(headroom)} extra after the attempt and response budget.`}
          </div>
        </div>
        <div className="lb-clock">
          <Clock3 aria-hidden="true" /> Check at {ms(elapsed)}
        </div>
      </figcaption>
    </figure>
  )
}
