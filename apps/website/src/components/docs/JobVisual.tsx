/* oxlint-disable effecttsgo/unstable-api-usage -- Owner-selected Effect 4.0.5 Atom/React API. */
import * as stylex from "@stylexjs/stylex"
import { styles } from "./VisualStyles.js"
import { RegistryProvider, useAtom } from "@effect/atom-react"
import * as Atom from "effect/reactivity/Atom"
import { createElement, useId, useRef } from "react"
import { Braces, Database, Bot, Mail, FileText, ReceiptText } from "lucide-react"
import { registerPlaybackHost } from "../illustrations/PlaybackHost.js"
import { useVisibility } from "../illustrations/Playback.js"
import { useGeometry, connectionMap } from "./VisualGeometry.js"
import {
  maximum,
  presentation,
  descriptions,
  type Variant,
  type Outcome
} from "./VisualState.js"
registerPlaybackHost("job-visual")
interface Props {
  readonly variant: Variant
}
const playbackAtom = Atom.make({ step: 0, mode: "commit" as Outcome, playing: false })
const icons = {
  api: Braces,
  database: Database,
  worker: Bot,
  email: Mail,
  invoice: FileText,
  order: ReceiptText
}
function Icon(props: { readonly name: keyof typeof icons }) {
  const Component = icons[props.name]
  return (
    <Component
      className={[
        "jv-icon",
        stylex.props(styles.icon, props.name === "database" && styles.databaseIcon)
          .className
      ].join(" ")}
      size={28}
      strokeWidth={1.5}
      aria-hidden="true"
    />
  )
}
function Illustration(props: Props) {
  const root = useRef<HTMLElement>(null)
  const [playback, setPlayback] = useAtom(playbackAtom)
  const environment = useVisibility(
    root,
    () => setPlayback({ step: 0, mode: "commit", playing: false }),
    () => setPlayback((current) => ({ ...current, playing: false }))
  )
  const isOverview = props.variant === "overview"
  const isTransaction = props.variant === "transaction"
  const isHandoff = props.variant === "handoff"
  const marker = `jv-arrow-${useId()}`
  // Render meaningful final output on the server; start interactive playback after hydration.
  const view = presentation(
    props.variant,
    environment.ready ? playback.step : maximum(props.variant),
    playback.mode
  )
  const connections = connectionMap[props.variant]
  const enabled = props.variant !== "transaction" || playback.mode !== "rollback"
  const reset = (mode: Outcome) => setPlayback({ step: 0, mode, playing: false })
  const step = () =>
    setPlayback((current) => ({
      ...current,
      step: Math.min(maximum(props.variant), current.step + 1),
      playing: false
    }))
  const toggle = () =>
    setPlayback((current) => ({
      ...current,
      step: current.step === maximum(props.variant) ? 0 : current.step,
      playing: !current.playing
    }))
  useGeometry(
    root,
    connections,
    playback.step,
    enabled,
    playback.playing && environment.visible && !environment.reduced,
    () =>
      setPlayback((current) => {
        const next = Math.min(maximum(props.variant), current.step + 1)
        return { ...current, step: next, playing: next < maximum(props.variant) }
      })
  )
  return createElement(
    "job-visual",
    {
      ref: root,
      ...stylex.props(styles.element),
      "data-job-visual": props.variant,
      "data-step": environment.ready ? String(playback.step) : "final",
      "data-playing": String(playback.playing && !environment.reduced),
      "data-outcome": playback.mode
    },
    <figure
      className={["jv", stylex.props(styles.figure).className].filter(Boolean).join(" ")}
      aria-label={descriptions[props.variant]}
    >
      {props.variant === "transaction" && (
        <div
          className={["jv-modes", stylex.props(styles.modes).className]
            .filter(Boolean)
            .join(" ")}
          role="group"
          aria-label="Transaction outcome"
          hidden={!environment.ready}
        >
          <button
            {...stylex.props(
              styles.element3,
              (playback.mode === "commit") === true && styles.modesSelected
            )}
            type="button"
            data-mode="commit"
            onClick={() => reset("commit")}
            aria-pressed={playback.mode === "commit"}
          >
            Commit
          </button>
          <button
            {...stylex.props(
              styles.element3,
              (playback.mode === "rollback") === true && styles.modesSelected
            )}
            type="button"
            data-mode="rollback"
            onClick={() => reset("rollback")}
            aria-pressed={playback.mode === "rollback"}
          >
            Roll back
          </button>
        </div>
      )}
      <div
        className={[
          `jv-stage jv-${props.variant}`,
          stylex.props(
            styles.stage,
            isOverview && styles.overviewSelected,
            isTransaction && styles.transactionSelected,
            isHandoff && styles.handoffSelected,
            isOverview && styles.overviewSelected2,
            isHandoff && styles.handoffSelected2,
            isTransaction && styles.transactionSelected2
          ).className
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <svg
          className={["jv-wires", stylex.props(styles.wires).className]
            .filter(Boolean)
            .join(" ")}
          aria-hidden="true"
        >
          <defs>
            <marker
              id={marker}
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path
                d="M0 0 7 3.5 0 7"
                fill="none"
                stroke="context-stroke"
                strokeWidth="1"
              />
            </marker>
          </defs>
          {connections.map((connection) => (
            <g key={connection.id}>
              <path
                className={["jv-wire", stylex.props(styles.wire).className]
                  .filter(Boolean)
                  .join(" ")}
                data-connection={connection.id}
                data-active={enabled && playback.step >= connection.at}
                stroke={
                  enabled && playback.step >= connection.at ? connection.color : "#646b77"
                }
                markerEnd={`url(#${marker})`}
              />
              <g className="jv-packet" data-packet={connection.id} opacity="0">
                <rect
                  {...stylex.props(styles.packet)}
                  x="-22"
                  y="-11"
                  width="44"
                  height="22"
                  rx="4"
                  fill="#131519"
                  strokeWidth="1.2"
                  stroke={connection.color}
                />
                <text {...stylex.props(styles.packet2)} fill={connection.color}>
                  {connection.label}
                </text>
              </g>
            </g>
          ))}
        </svg>
        {props.variant === "overview" && (
          <>
            <div
              className={[
                "jv-node jv-api jv-blue",
                stylex.props(
                  styles.database,
                  (view.nodes["api"] ?? false) === true && styles.nodeSelected,
                  isOverview && styles.nodeSelected2
                ).className
              ]
                .filter(Boolean)
                .join(" ")}
              data-node="api"
              data-active={view.nodes["api"] ?? false}
            >
              <Icon name="api" />
              <strong {...stylex.props(styles.element4)}>API</strong>
              <code {...stylex.props(styles.element5)}>POST /orders</code>
              <span
                className={[
                  "jv-status",
                  stylex.props(
                    styles.status,
                    ["201 Created", "Completed", "Sent", "Done"].includes(
                      view.labels["response"] ?? ""
                    ) === true && styles.checkSelected
                  ).className
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-label="response"
                data-done={["201 Created", "Completed", "Sent", "Done"].includes(
                  view.labels["response"] ?? ""
                )}
              >
                {view.labels["response"]}
              </span>
            </div>
            <div
              className={[
                "jv-database",
                stylex.props(
                  styles.database2,
                  isOverview && styles.databaseSelected,
                  isOverview && styles.databaseSelected2,
                  isOverview && styles.databaseSelected3
                ).className
              ]
                .filter(Boolean)
                .join(" ")}
              data-node="database"
              data-active={view.nodes["database"] ?? false}
            >
              <div
                className={["jv-db-title", stylex.props(styles.dbTitle).className]
                  .filter(Boolean)
                  .join(" ")}
              >
                <Icon name="database" />
                <strong {...stylex.props(styles.element4)}>PostgreSQL</strong>
              </div>
              <div
                className={["jv-table", stylex.props(styles.table).className]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span {...stylex.props(styles.table2)}>orders</span>
                <div
                  className={[
                    "jv-row",
                    stylex.props(
                      styles.row,
                      (view.nodes["order"] ?? false) === true && styles.rowSelected
                    ).className
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-node="order"
                  data-active={view.nodes["order"] ?? false}
                >
                  <span
                    {...stylex.props(styles.element6)}
                    data-label="order"
                    data-done={["201 Created", "Completed", "Sent", "Done"].includes(
                      view.labels["order"] ?? ""
                    )}
                  >
                    {view.labels["order"]}
                  </span>
                  <span
                    className={["jv-check", stylex.props(styles.check).className]
                      .filter(Boolean)
                      .join(" ")}
                    data-label="orderState"
                    data-done={["201 Created", "Completed", "Sent", "Done"].includes(
                      view.labels["orderState"] ?? ""
                    )}
                  >
                    {view.labels["orderState"]}
                  </span>
                </div>
              </div>
              <div
                className={["jv-table", stylex.props(styles.table3).className]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span {...stylex.props(styles.table2)}>jobs</span>
                <div
                  className={[
                    "jv-row jv-amber",
                    stylex.props(
                      styles.row,
                      (view.nodes["job"] ?? false) === true && styles.rowSelected
                    ).className
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-node="job"
                  data-active={view.nodes["job"] ?? false}
                >
                  <span {...stylex.props(styles.element6)}>Confirmation</span>
                  <span
                    className={[
                      "jv-status",
                      stylex.props(
                        styles.status2,
                        ["201 Created", "Completed", "Sent", "Done"].includes(
                          view.labels["jobState"] ?? ""
                        ) === true && styles.checkSelected,
                        isOverview && styles.rowSelected2
                      ).className
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-label="jobState"
                    data-done={["201 Created", "Completed", "Sent", "Done"].includes(
                      view.labels["jobState"] ?? ""
                    )}
                  >
                    {view.labels["jobState"]}
                  </span>
                </div>
              </div>
            </div>
            <div
              className={[
                "jv-node jv-worker jv-purple",
                stylex.props(
                  styles.database3,
                  (view.nodes["worker"] ?? false) === true && styles.nodeSelected,
                  isOverview && styles.nodeSelected2
                ).className
              ]
                .filter(Boolean)
                .join(" ")}
              data-node="worker"
              data-active={view.nodes["worker"] ?? false}
            >
              <Icon name="worker" />
              <strong {...stylex.props(styles.element4)}>Worker</strong>
              <span
                className={[
                  "jv-status",
                  stylex.props(
                    styles.status,
                    ["201 Created", "Completed", "Sent", "Done"].includes(
                      view.labels["workerState"] ?? ""
                    ) === true && styles.checkSelected
                  ).className
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-label="workerState"
                data-done={["201 Created", "Completed", "Sent", "Done"].includes(
                  view.labels["workerState"] ?? ""
                )}
              >
                {view.labels["workerState"]}
              </span>
            </div>
            <div
              className={[
                "jv-node jv-email jv-green",
                stylex.props(
                  styles.database4,
                  (view.nodes["email"] ?? false) === true && styles.nodeSelected,
                  isOverview && styles.nodeSelected2
                ).className
              ]
                .filter(Boolean)
                .join(" ")}
              data-node="email"
              data-active={view.nodes["email"] ?? false}
            >
              <Icon name="email" />
              <strong {...stylex.props(styles.element4)}>Email</strong>
              <span
                className={[
                  "jv-status",
                  stylex.props(
                    styles.status,
                    ["201 Created", "Completed", "Sent", "Done"].includes(
                      view.labels["emailState"] ?? ""
                    ) === true && styles.checkSelected
                  ).className
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-label="emailState"
                data-done={["201 Created", "Completed", "Sent", "Done"].includes(
                  view.labels["emailState"] ?? ""
                )}
              >
                {view.labels["emailState"]}
              </span>
            </div>
          </>
        )}
        {props.variant === "transaction" && (
          <>
            <div
              className={[
                "jv-database jv-transaction-box",
                stylex.props(
                  styles.database5,
                  isOverview && styles.databaseSelected,
                  isOverview && styles.databaseSelected2,
                  isOverview && styles.databaseSelected3
                ).className
              ]
                .filter(Boolean)
                .join(" ")}
              data-node="transaction"
              data-active={view.nodes["transaction"] ?? false}
            >
              <div
                className={["jv-db-title", stylex.props(styles.dbTitle).className]
                  .filter(Boolean)
                  .join(" ")}
              >
                <Icon name="database" />
                <strong {...stylex.props(styles.element4)}>PostgreSQL</strong>
              </div>
              <div
                className={[
                  "jv-boundary",
                  stylex.props(
                    styles.boundary,
                    view.result === "commit" && styles.boundaryCommitSelected,
                    view.result === "rollback" && styles.boundaryRollbackSelected
                  ).className
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-node="boundary"
                data-active={view.nodes["boundary"] ?? false}
                data-result={view.result}
              >
                <div
                  className={[
                    "jv-boundary-title",
                    stylex.props(styles.boundaryTitle).className
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span {...stylex.props(styles.element6)}>Transaction</span>
                  <span
                    {...stylex.props(
                      styles.element6,
                      view.result === "commit" && styles.checkSelected,
                      view.result === "rollback" && styles.boundaryTitleRollbackSelected
                    )}
                    data-label="decision"
                    data-done={["201 Created", "Completed", "Sent", "Done"].includes(
                      view.labels["decision"] ?? ""
                    )}
                  >
                    {view.labels["decision"]}
                  </span>
                </div>
                <div
                  className={[
                    "jv-row",
                    stylex.props(
                      styles.row,
                      (view.nodes["order"] ?? false) === true && styles.rowSelected,
                      view.result === "staged" &&
                        (view.nodes["order"] ?? false) === true &&
                        styles.rowStagedSelected
                    ).className
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-node="order"
                  data-active={view.nodes["order"] ?? false}
                >
                  <code {...stylex.props(styles.element5)}>orders</code>
                  <span
                    {...stylex.props(styles.element6)}
                    data-label="order"
                    data-done={["201 Created", "Completed", "Sent", "Done"].includes(
                      view.labels["order"] ?? ""
                    )}
                  >
                    {view.labels["order"]}
                  </span>
                  <span
                    className={["jv-check", stylex.props(styles.check).className]
                      .filter(Boolean)
                      .join(" ")}
                    data-label="orderState"
                    data-done={["201 Created", "Completed", "Sent", "Done"].includes(
                      view.labels["orderState"] ?? ""
                    )}
                  >
                    {view.labels["orderState"]}
                  </span>
                </div>
                <div
                  className={[
                    "jv-row jv-amber",
                    stylex.props(
                      styles.row2,
                      (view.nodes["job"] ?? false) === true && styles.rowSelected,
                      view.result === "staged" &&
                        (view.nodes["job"] ?? false) === true &&
                        styles.rowStagedSelected
                    ).className
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-node="job"
                  data-active={view.nodes["job"] ?? false}
                >
                  <code {...stylex.props(styles.element5)}>jobs</code>
                  <span
                    {...stylex.props(styles.element6)}
                    data-label="job"
                    data-done={["201 Created", "Completed", "Sent", "Done"].includes(
                      view.labels["job"] ?? ""
                    )}
                  >
                    {view.labels["job"]}
                  </span>
                  <span
                    className={["jv-check", stylex.props(styles.check).className]
                      .filter(Boolean)
                      .join(" ")}
                    data-label="jobState"
                    data-done={["201 Created", "Completed", "Sent", "Done"].includes(
                      view.labels["jobState"] ?? ""
                    )}
                  >
                    {view.labels["jobState"]}
                  </span>
                </div>
              </div>
            </div>
            <div
              className={[
                "jv-node jv-purple jv-transaction-worker",
                stylex.props(
                  styles.database6,
                  (view.nodes["worker"] ?? false) === true && styles.nodeSelected,
                  isOverview && styles.nodeSelected2
                ).className
              ]
                .filter(Boolean)
                .join(" ")}
              data-node="worker"
              data-active={view.nodes["worker"] ?? false}
            >
              <Icon name="worker" />
              <strong {...stylex.props(styles.element4)}>Worker</strong>
              <span
                className={[
                  "jv-status",
                  stylex.props(
                    styles.status,
                    ["201 Created", "Completed", "Sent", "Done"].includes(
                      view.labels["workerState"] ?? ""
                    ) === true && styles.checkSelected
                  ).className
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-label="workerState"
                data-done={["201 Created", "Completed", "Sent", "Done"].includes(
                  view.labels["workerState"] ?? ""
                )}
              >
                {view.labels["workerState"]}
              </span>
            </div>
          </>
        )}
        {props.variant === "handoff" && (
          <>
            <div
              className={[
                "jv-node jv-origin jv-blue",
                stylex.props(
                  styles.database7,
                  (view.nodes["origin"] ?? false) === true && styles.nodeSelected,
                  isOverview && styles.nodeSelected2
                ).className
              ]
                .filter(Boolean)
                .join(" ")}
              data-node="origin"
              data-active={view.nodes["origin"] ?? false}
            >
              <Icon name="order" />
              <strong {...stylex.props(styles.element4)}>Order #041</strong>
              <code {...stylex.props(styles.element5)}>order.place</code>
            </div>
            <div
              className={[
                "jv-node jv-confirmation jv-purple",
                stylex.props(
                  styles.database8,
                  (view.nodes["confirmation"] ?? false) === true && styles.nodeSelected,
                  isOverview && styles.nodeSelected2
                ).className
              ]
                .filter(Boolean)
                .join(" ")}
              data-node="confirmation"
              data-active={view.nodes["confirmation"] ?? false}
            >
              <Icon name="email" />
              <strong {...stylex.props(styles.element4)}>Confirmation</strong>
              <span
                className={[
                  "jv-status",
                  stylex.props(
                    styles.status,
                    ["201 Created", "Completed", "Sent", "Done"].includes(
                      view.labels["confirmationState"] ?? ""
                    ) === true && styles.checkSelected
                  ).className
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-label="confirmationState"
                data-done={["201 Created", "Completed", "Sent", "Done"].includes(
                  view.labels["confirmationState"] ?? ""
                )}
              >
                {view.labels["confirmationState"]}
              </span>
            </div>
            <div
              className={[
                "jv-node jv-invoice jv-amber",
                stylex.props(
                  styles.database9,
                  (view.nodes["invoice"] ?? false) === true && styles.nodeSelected,
                  isOverview && styles.nodeSelected2
                ).className
              ]
                .filter(Boolean)
                .join(" ")}
              data-node="invoice"
              data-active={view.nodes["invoice"] ?? false}
            >
              <Icon name="invoice" />
              <strong {...stylex.props(styles.element4)}>Create invoice</strong>
              <span
                className={[
                  "jv-status",
                  stylex.props(
                    styles.status,
                    ["201 Created", "Completed", "Sent", "Done"].includes(
                      view.labels["invoiceState"] ?? ""
                    ) === true && styles.checkSelected
                  ).className
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-label="invoiceState"
                data-done={["201 Created", "Completed", "Sent", "Done"].includes(
                  view.labels["invoiceState"] ?? ""
                )}
              >
                {view.labels["invoiceState"]}
              </span>
            </div>
            <div
              className={[
                "jv-node jv-delivery jv-green",
                stylex.props(
                  styles.database10,
                  (view.nodes["delivery"] ?? false) === true && styles.nodeSelected,
                  view.dim === true && styles.nodeSelected3,
                  isOverview && styles.nodeSelected2
                ).className
              ]
                .filter(Boolean)
                .join(" ")}
              data-node="delivery"
              data-active={view.nodes["delivery"] ?? false}
              data-dim={view.dim}
            >
              <Icon name="email" />
              <strong {...stylex.props(styles.element4)}>Send invoice</strong>
              <span
                className={[
                  "jv-status",
                  stylex.props(
                    styles.status,
                    ["201 Created", "Completed", "Sent", "Done"].includes(
                      view.labels["deliveryState"] ?? ""
                    ) === true && styles.checkSelected
                  ).className
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-label="deliveryState"
                data-done={["201 Created", "Completed", "Sent", "Done"].includes(
                  view.labels["deliveryState"] ?? ""
                )}
              >
                {view.labels["deliveryState"]}
              </span>
            </div>
          </>
        )}
      </div>
      <div
        className={["jv-controls", stylex.props(styles.controls).className]
          .filter(Boolean)
          .join(" ")}
        hidden={!environment.ready}
      >
        <span
          className={["jv-progress", stylex.props(styles.progress).className]
            .filter(Boolean)
            .join(" ")}
          role="status"
          aria-live="polite"
          data-label="progress"
          data-done={["201 Created", "Completed", "Sent", "Done"].includes(
            view.labels["progress"] ?? ""
          )}
        >
          {view.labels["progress"]}
        </span>
        <div
          className={["jv-buttons", stylex.props(styles.modes2).className]
            .filter(Boolean)
            .join(" ")}
        >
          <button
            type="button"
            className={["jv-step", stylex.props(styles.element7).className]
              .filter(Boolean)
              .join(" ")}
            data-action="step"
            disabled={playback.step === maximum(props.variant)}
            onClick={step}
          >
            Step{" "}
            <span {...stylex.props(styles.element6)} aria-hidden="true">
              →
            </span>
          </button>
          <button
            type="button"
            className={["jv-play", stylex.props(styles.element8).className]
              .filter(Boolean)
              .join(" ")}
            data-action="play"
            disabled={environment.reduced}
            aria-pressed={playback.playing}
            onClick={toggle}
          >
            {playback.playing
              ? "Pause"
              : playback.step === maximum(props.variant)
                ? "Replay"
                : "Play"}
          </button>
          <button
            type="button"
            className={["jv-reset", stylex.props(styles.element9).className]
              .filter(Boolean)
              .join(" ")}
            data-action="reset"
            onClick={() => reset(playback.mode)}
            aria-label="Reset illustration"
            title="Reset"
          >
            ↺
          </button>
        </div>
      </div>
      <p
        className={["jv-static", stylex.props(styles.static).className]
          .filter(Boolean)
          .join(" ")}
      >
        {props.variant === "overview"
          ? "Order + job commit → API responds → worker sends email."
          : props.variant === "transaction"
            ? "Commit saves both records. Confirmed rollback saves neither."
            : "Confirmation and invoice creation are independent. Invoice creation enqueues delivery."}
      </p>
    </figure>
  )
}
export default function JobVisual(props: Props) {
  return (
    <RegistryProvider>
      <Illustration {...props} />
    </RegistryProvider>
  )
}
