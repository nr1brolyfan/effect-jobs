// Adapted from shadcn-cssinjs (MIT); see Primitives.LICENSE and Primitives.md.
import * as stylex from "@stylexjs/stylex"
import { Fragment } from "react"
import { Button, Icon } from "./Primitives.js"
import { styles } from "./Pagination.stylex.js"

export interface PaginationProps {
  readonly current: number
  readonly pages: ReadonlyArray<number>
  readonly hasPrevious: boolean
  readonly hasNext: boolean
  readonly disabled?: boolean
  readonly busy?: boolean
  readonly onPage: (page: number) => void
  readonly onFirst: () => void
  readonly onPrevious: () => void
  readonly onNext: () => void
}

export function Pagination({
  current,
  pages,
  hasPrevious,
  hasNext,
  disabled = false,
  busy = false,
  onPage,
  onFirst,
  onPrevious,
  onNext
}: PaginationProps) {
  const known = [...new Set(pages)].sort((a, b) => a - b)
  const index = known.indexOf(current)
  // Omit only entries that actually exist in known cursor history. Numeric gaps
  // alone never imply that unknown pages can be reached.
  const visible = known.flatMap((page, i) =>
    i === 0 || i === known.length - 1 || Math.abs(i - index) <= 1
      ? [{ page, index: i }]
      : []
  )
  return (
    <nav {...stylex.props(styles.root)} aria-label="Pagination" aria-busy={busy}>
      <ul {...stylex.props(styles.list)}>
        <li>
          <Button
            disabled={disabled || !hasPrevious || !known.includes(1)}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy && !disabled) {
                onFirst()
              }
            }}
            aria-label="First page"
          >
            First
          </Button>
        </li>
        <li>
          <Button
            disabled={disabled || !hasPrevious}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy && !disabled) {
                onPrevious()
              }
            }}
            aria-label="Previous page"
          >
            <span {...stylex.props(styles.previous)}>
              <Icon name="chevron" size={16} />
            </span>
            Previous
          </Button>
        </li>
        {visible.map(({ page, index: i }, v) => (
          <Fragment key={page}>
            {v > 0 && i > visible[v - 1]!.index + 1 ? (
              <li>
                <span {...stylex.props(styles.ellipsis)} aria-label="More pages">
                  …
                </span>
              </li>
            ) : null}
            <li>
              <Button
                variant={page === current ? "primary" : "ghost"}
                disabled={disabled}
                aria-disabled={busy || undefined}
                aria-current={page === current ? "page" : undefined}
                aria-label={`Page ${page}`}
                onClick={() => {
                  if (!busy && !disabled) {
                    onPage(page)
                  }
                }}
              >
                {page}
              </Button>
            </li>
          </Fragment>
        ))}
        <li>
          <Button
            disabled={disabled || !hasNext}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy && !disabled) {
                onNext()
              }
            }}
            aria-label="Next page"
          >
            Next
            <Icon name="chevron" size={16} />
          </Button>
        </li>
      </ul>
    </nav>
  )
}
