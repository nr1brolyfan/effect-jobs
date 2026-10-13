import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import * as stylex from "@stylexjs/stylex"
import { Panel, Badge } from "../../../ui/Primitives.js"
import { DateTime } from "../../../ui/DateTime.js"
import { styles } from "./JobTimeline.stylex.js"

export function JobTimeline({ detail }: { readonly detail: JobDetail }) {
  return (
    <Panel aria-label="Retained evidence" {...stylex.props(styles.panel)}>
      <h2>Retained evidence</h2>
      <p>
        Full attempt start/end history is unavailable. Only retained snapshots, committed
        receipts and resolution audit facts appear here.
      </p>
      {detail.provider ? (
        <p>
          Synthetic PostgreSQL provider ledger: {detail.provider.invocations} invocations;
          accepted: {detail.provider.accepted ? "yes" : "no"}. Invocation timestamps are
          not recorded. This is synthetic evidence, not proof of real provider effects.
        </p>
      ) : (
        <p>Provider evidence unavailable.</p>
      )}
      <p>Handler result unavailable: not stored.</p>
      {detail.history.items.length === 0 && <p>No retained timeline facts.</p>}
      {/* Resolution DTO has no audit key. Preserve every server-ordered fact;
          positional rendering neither deduplicates nor invents an event identity. */}
      <ol {...stylex.props(styles.list)}>
        {detail.history.items.map((item, index) => {
          switch (item._tag) {
            case "Snapshot":
              return (
                <li
                  key={`snapshot:${item.job.jobId}:${item.job.lifecycleVersion}`}
                  {...stylex.props(styles.fact)}
                >
                  <strong>Current snapshot</strong> <Badge state={item.job.state} />
                  <p>
                    Observed <DateTime value={item.observedAt} />. This is not a
                    historical transition.
                  </p>
                </li>
              )
            case "Operator":
              return (
                <li
                  key={`operator:${item.requestId}:${item.action}`}
                  {...stylex.props(styles.fact)}
                >
                  <strong>Committed operator action: {item.action}</strong>
                  <p>
                    Source <code>{item.sourceJobId}</code>; result{" "}
                    {item.resultJobId === null ? (
                      "No successor"
                    ) : (
                      <code>{item.resultJobId}</code>
                    )}
                    .
                  </p>
                  <p>
                    Request <code>{item.requestId}</code> ·{" "}
                    <DateTime value={item.observedAt} />
                  </p>
                </li>
              )
            case "Resolution":
              return (
                <li key={`resolution-position:${index}`} {...stylex.props(styles.fact)}>
                  <strong>
                    Recorded resolution:{" "}
                    {item.state === "InProgress" ? "In progress" : item.state}
                  </strong>
                  <p>
                    {item.kind} · root <code>{item.rootJobId}</code>
                  </p>
                  <p>{item.reason ?? "No reason retained"}</p>
                  <DateTime value={item.observedAt} />
                </li>
              )
          }
        })}
      </ol>
      {detail.history.nextCursor !== null && (
        <p>
          More retained facts are available. This view shows the current bounded page.
        </p>
      )}
    </Panel>
  )
}
