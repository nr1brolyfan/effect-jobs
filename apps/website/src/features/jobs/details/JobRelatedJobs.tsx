import type { JobDetail } from "@effect-jobs/playground-contracts/Jobs"
import type { JobId } from "effect-jobs/JobId"
import * as stylex from "@stylexjs/stylex"
import { Badge, Button, Panel } from "../../../ui/Primitives.js"
import { styles } from "./JobRelatedJobs.stylex.js"

export function JobRelatedJobs({
  detail,
  onRelated
}: {
  readonly detail: JobDetail
  readonly onRelated: (jobId: JobId) => void
}) {
  return (
    <Panel aria-label="Related jobs" {...stylex.props(styles.panel)}>
      <h2>Related jobs</h2>
      {detail.related.items.length === 0 && <p>No related jobs retained.</p>}
      <ul {...stylex.props(styles.list)}>
        {detail.related.items.map((item) => (
          <li key={item.jobId} {...stylex.props(styles.item)}>
            {item.state === null ? (
              <span>
                <code>{item.jobId}</code> · Job no longer retained
              </span>
            ) : (
              <>
                <Button
                  onClick={() => onRelated(item.jobId)}
                  aria-label={`Open related job ${item.jobId}`}
                >
                  {item.jobId}
                </Button>
                <Badge state={item.state} />
              </>
            )}
            {item.kind && (
              <span>
                {item.kind === "CorrectedRedrive" ? "Corrected redrive" : "Plain redrive"}
              </span>
            )}
            {item.kind !== null && !item.sourceAvailable && (
              <span>Source no longer retained; only related evidence is available.</span>
            )}
          </li>
        ))}
      </ul>
      {detail.related.nextCursor !== null && (
        <p>More related evidence is available beyond this bounded page.</p>
      )}
    </Panel>
  )
}
