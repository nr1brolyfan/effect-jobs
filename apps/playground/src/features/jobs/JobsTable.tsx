/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned atom-react 4.0.5 is the supported Effect Atom subscription API. */
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef
} from "@tanstack/react-table"
import { useMemo } from "react"
import type { JobSummary } from "@effect-jobs/playground-contracts/Jobs"
import { DateTime } from "../../ui/DateTime.js"
import { Badge, Icon } from "../../ui/Primitives.js"
import { jobIcon, jobName } from "./Design.js"
import { useAtomValue } from "@effect/atom-react"
import * as stylex from "@stylexjs/stylex"
import type { Runtime } from "./Runtime.js"
import { classes } from "./DashboardClasses.js"
import { styles, layout } from "./Dashboard.stylex.js"
export const JobsTable = (props: {
  readonly runtime: Runtime
  readonly data: ReadonlyArray<JobSummary>
}) => {
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- Pinned atom-react 4.0.5 has no stable subscription hook; preserve the shared Atom registry and cleanup.
  const selected = useAtomValue(props.runtime.atoms.selected)
  const columns = useMemo<ColumnDef<JobSummary>[]>(
    () => [
      {
        id: "job",
        header: "Job",
        cell: (cell) => {
          return (
            <div {...classes("job-identity")}>
              <span {...classes("job-icon")}>
                <JobCatalogIcon name={cell.row.original.catalog.name} />
              </span>
              <div>
                <strong
                  {...classes("job-name")}
                  title={`${cell.row.original.catalog.name} v${cell.row.original.catalog.version}`}
                >
                  {jobName(cell.row.original.catalog.name)}
                </strong>
                <button
                  type="button"
                  {...classes("job-id")}
                  title={cell.row.original.jobId}
                  data-job-id={cell.row.original.jobId}
                  aria-pressed={selected === cell.row.original.jobId}
                  onClick={() => {
                    void props.runtime.run(props.runtime.select(cell.row.original.jobId))
                  }}
                >
                  {cell.row.original.jobId}
                </button>
              </div>
            </div>
          )
        }
      },
      { id: "queue", header: "Queue", accessorFn: (job) => job.catalog.queue },
      {
        id: "status",
        header: "Status",
        cell: (cell) => {
          return <Badge state={cell.row.original.state} />
        }
      },
      {
        id: "attempts",
        header: "Attempts",
        cell: (cell) => {
          return (
            <span title="Finalized attempts, not all handler invocations">
              {String(cell.row.original.finalizedAttempts).padStart(2, "0")}
            </span>
          )
        }
      },
      {
        id: "updated",
        header: "Updated",
        cell: (cell) => {
          return <DateTime value={cell.row.original.updatedAt} label="Updated" />
        }
      },
      {
        id: "terminal",
        header: "Terminal",
        cell: (cell) => {
          return (
            <DateTime value={cell.row.original.completedAt} label="Terminal timestamp" />
          )
        }
      },
      {
        id: "failure",
        header: "Failure code",
        accessorFn: (job) => job.lastFailureCode ?? "—"
      }
    ],
    [props.runtime, selected]
  )
  const rows = useMemo(() => [...props.data], [props.data])
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (job) => job.jobId,
    manualPagination: true,
    manualFiltering: true
  })
  return (
    <>
      <div {...classes("table-scroll")}>
        <table {...classes("jobs-table")} aria-label="Background jobs">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id} {...stylex.props(layout.th)} scope="col">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody {...classes("job-list")}>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                {...stylex.props(layout.row, selected === row.id && styles.selected)}
                className={[
                  selected === row.id ? "selected" : "",
                  stylex.props(layout.row, selected === row.id && styles.selected)
                    .className
                ].join(" ")}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} {...classes(`${cell.column.id}-cell`)}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {props.data.length === 0 && (
        <div {...classes("empty-state")}>
          <Icon name="jobs" />
          <strong>{"No jobs match on this page"}</strong>
        </div>
      )}
    </>
  )
}

const JobCatalogIcon = (props: { readonly name: string }) => {
  const Component = jobIcon(props.name)
  return <Component size={18} strokeWidth={1.5} aria-hidden="true" focusable="false" />
}
