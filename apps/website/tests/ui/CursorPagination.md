# Authoritative reads and cursor history

`Atoms.make` owns a registry per mounted dashboard. Default `pageSize` is 20;
`setPageSize(20 | 50)` changes the server limit without changing the read API.
`Runtime.make` exposes these operations through its existing state spread;
UI callbacks use `runtime.run(runtime.previous)`, `runtime.run(runtime.goTo(n))`
and `runtime.run(runtime.setPageSize(n))`. Existing first/next/filter remain.

## Display contract for integration

- Render all counts and the chart from `state.stats`, the latest validated global
  API stats for this sandbox authority. Counts are independent of filters and
  page size; never infer page counts from them.
- `state.page` is the retained displayed snapshot. A filter/page/size change
  leaves it present until a validated replacement arrives. `state.pageNumber`,
  `filters`, `cursor` and `pageSize` describe the **requested** query.
- `displayedQuery` identifies the successful snapshot by sandbox/generation,
  filters, page number and size. `resultsCurrent` compares it with the request.
  While `loading`, announce “Loading results; previous results remain visible”
  in a table-local status region and set table `aria-busy`. After failed
  replacement, `!resultsCurrent` still requires a visible/accessible previous
  results notice and retry. Never label retained rows as the requested results.
  Same-query refreshes also need the loading announcement even when
  `resultsCurrent` is true. `error`/`connection === "stale"` mark failed refreshes.
- `loading` and `reading()` describe **only the latest request**, not every older
  unsettled HTTP call. Old calls remain bounded and scope-owned; their completion,
  failure, revocation error or defect cannot change current rows, stats, history,
  loading or errors. Clearing loading does not mean that all old network I/O ended.
- Keep the UI mounted; disable pagination while loading, preserve focus and
  scroll, and avoid rebuilding the chart/header from an empty page. Atoms alone
  do not demonstrate DOM/focus/scroll stability; integration must verify it.

## Numbered navigation semantics

The server sorts job IDs ascending using PostgreSQL `COLLATE "C"`, returning a
signed opaque cursor scoped to sandbox/generation and filters. Pages here are
**cursor-history positions**, not offsets or globally counted filtered pages.
`pagination.pages` is the set of known reachable positions, including the next
neighbor discovered by the successful snapshot's `nextCursor`. At page 1 this is
initially `[1]`, then `[1, 2]` only if the server actually returns a next cursor.
Further positions are discovered lazily. `goTo(n)` ignores unknown, noninteger,
negative and zero positions; it never fetches the entire dataset to resolve them.
`current`, `hasPrevious` and `hasNext` describe the requested history position.

First, previous, next and any visited numbered position use their actual stored
cursor. Filters and page size reset history to `[1]`; retain selection across
ordinary filters/pages as before. Generation/identity invalidation revokes rows,
stats, detail, selection, pending receipts, display markers and cursor history.
The requested page resets to 1 while filters and chosen page size are retained.
Private identity rotation is rejected; public demo rotation remains explicit.

Each successful reconciliation validates its next anchor. An unchanged anchor
preserves known descendants. A changed anchor prunes the descendants and learns
only the new next neighbor; `null` prunes all later positions. Invalid cursors
remain explicit errors until the user retries or chooses first, never a silent
jump or offset fallback. On a failed replacement the old snapshot's `nextCursor`
is **not** used to extend the requested query's history.

Live inserts before an anchor are seen when returning to first. Inserts/deletes
or state changes between reads may change page contents and cardinalities. A
history position is not a stable ordinal rank, fixed dataset snapshot or promise
of no overlap after earlier page boundaries change. The authoritative global
stats reconcile on every accepted read. No arbitrary page count or last-page
control is justified by this API.

## Privacy and WebSocket authority

Describe/list expiry, stale generation, not-found authority, mismatched identity
and generation regressions clear all retained data. Detail expiry/stale-generation
also revoke the dashboard; detail not-found only clears that detail. A validated
new generation clears old data **before** its replacement list begins. Reset
acknowledgment still revokes immediately even if the next describe fails.

Runtime listens for the existing WebSocket admission close code `4003`: it clears
private authority immediately, fences in-flight reads, then performs HTTP recovery.
The listener is bound to its connection Scope and identity and removed on disposal
or generation replacement. Local live expiry also revokes before recovery. Ordinary
transient disconnects retain snapshots and reconcile; WS payloads never fabricate
job state or stats. API recovery may restore only newly validated authority.

## Focused verification

`ReadsFixtures.ts` provides a synthetic 65-job keyset server with between-read
insert/delete operations, filtering and independent global totals. Deferred
Effect gates stop actual describe/list calls; tests do not fabricate atom state.
`Reads.test.ts` covers 20/50, valid neighbors/back/first, reset scopes, delayed
failure retention, latest loading/error/defect ownership, generation privacy,
concurrent inserts/changed anchors and rapid known-page navigation.
`Runtime.test.ts` delivers WS ready/invalidation and admission-close events through
the browser FFI, checks HTTP reconciliation and scope cleanup. Two existing atom
pagination tests now use enough synthetic rows to exercise the real 20-row default.

The stream intentionally leaves Dashboard wiring to integration. Browser slow API,
no remount/stat flash/focus/scroll, keyboard/mobile axe and real PG/workerd/WS matrices
must qualify that integrated tree; synthetic unit tests are not those claims.
