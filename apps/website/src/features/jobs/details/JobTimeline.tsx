import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import * as stylex from "@stylexjs/stylex"
import { Panel, Badge } from "../../../ui/Primitives.js"
import { PropertyGrid, Absent, DetailTime, DetailHelp } from "./PropertyGrid.js"
import { styles as propertyStyles } from "./PropertyGrid.stylex.js"
import { styles } from "./JobTimeline.stylex.js"

export function JobTimeline({ detail }: { readonly detail: JobDetail }) {
  return (
    <Panel aria-label="Retained evidence" {...stylex.props(styles.panel)}>
      <h2 {...stylex.props(propertyStyles.heading)}>Evidence</h2>
      <PropertyGrid
        items={[
          {
            label: "Provider invocations",
            value: detail.provider?.invocations ?? (
              <Absent reason="Provider evidence unavailable" />
            )
          },
          {
            label: "Provider accepted",
            value: detail.provider ? (
              detail.provider.accepted ? (
                "Yes"
              ) : (
                "No"
              )
            ) : (
              <Absent reason="Provider evidence unavailable" />
            )
          },
          {
            label: "Handler result",
            value: <Absent reason="Handler result is not stored" />
          }
        ]}
      />
      {detail.history.items.length === 0 && (
        <span {...stylex.props(styles.empty)}>No retained facts</span>
      )}
      {/* Preserve each server-ordered resolution fact: the DTO has no audit key. */}
      <ol {...stylex.props(styles.list)}>
        {detail.history.items.map((item, index) => {
          switch (item._tag) {
            case "Snapshot":
              return (
                <li
                  key={`snapshot:${item.job.jobId}:${item.job.lifecycleVersion}`}
                  {...stylex.props(styles.fact)}
                >
                  <div {...stylex.props(styles.factHeader)}>
                    <strong>Snapshot</strong>
                    <Badge state={item.job.state} />
                  </div>
                  <PropertyGrid
                    items={[
                      {
                        label: "Observed",
                        value: (
                          <DetailTime value={item.observedAt} label="Snapshot observed" />
                        )
                      }
                    ]}
                  />
                </li>
              )
            case "Operator":
              return (
                <li
                  key={`operator:${item.requestId}:${item.action}`}
                  {...stylex.props(styles.fact)}
                >
                  <strong>Operator · {item.action}</strong>
                  <PropertyGrid
                    items={[
                      { label: "Source", value: item.sourceJobId, mono: true },
                      {
                        label: "Successor",
                        value: item.resultJobId ?? <Absent reason="No successor" />,
                        mono: true
                      },
                      { label: "Request", value: item.requestId, mono: true },
                      {
                        label: "Committed",
                        value: (
                          <DetailTime
                            value={item.observedAt}
                            label="Operator action committed"
                          />
                        )
                      }
                    ]}
                  />
                </li>
              )
            case "Resolution":
              return (
                <li key={`resolution-position:${index}`} {...stylex.props(styles.fact)}>
                  <strong>
                    Resolution ·{" "}
                    {item.state === "InProgress" ? "In progress" : item.state}
                  </strong>
                  <PropertyGrid
                    items={[
                      { label: "Kind", value: item.kind },
                      { label: "Root job", value: item.rootJobId, mono: true },
                      {
                        label: "Reason",
                        value: item.reason ?? <Absent reason="No reason retained" />
                      },
                      {
                        label: "Recorded",
                        value: (
                          <DetailTime
                            value={item.observedAt}
                            label="Resolution recorded"
                          />
                        )
                      }
                    ]}
                  />
                </li>
              )
          }
        })}
      </ol>
      <DetailHelp summary="Evidence coverage">
        Only retained snapshots, committed receipts and resolution audit facts are shown;
        a snapshot is not a historical transition. Full attempt start/end history and
        handler results are not stored. Provider counts are synthetic PostgreSQL evidence,
        without invocation timestamps; they do not prove real provider effects.
      </DetailHelp>
      {detail.history.nextCursor !== null && (
        <span {...stylex.props(styles.empty)}>More retained facts available</span>
      )}
    </Panel>
  )
}
