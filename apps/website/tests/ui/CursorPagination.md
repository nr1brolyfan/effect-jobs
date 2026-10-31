# Authoritative reads and cursor history

`Atoms.make` owns a registry per mounted dashboard. Default `pageSize` is 20;
`setPageSize(20 | 50)` resets history and changes the server limit. Runtime exposes
`refresh`, `backgroundRefresh`, `filter`, `first`, `previous`, `next`, `goTo(n)`
and `setPageSize(n)` through its state spread; UI callbacks use `runtime.run`.

## Display and scheduling contract

`refresh` is explicit foreground reconciliation (initial/manual). Query navigation
also runs a foreground read. `loading` describes only the latest foreground read.
`backgroundRefresh` is used by polling, live invalidations and visibility callbacks.
Successful same-query background reads keep `loading`, `resultsCurrent`, connection
and notice stable. Do not announce every poll, disable controls, remount the table,
clear stats or flash a skeleton. Meaningful progress belongs to foreground work;
integration may delay its indicator to avoid short flashes.

`reading()` covers all outstanding list/describe/detail reads, including obsolete
bounded reads. Background demand during another read is ignored and never steals
foreground ownership. Repeated `next`/`previous` while loading and `goTo` to the
already requested page are ignored without depending on native disabled controls.
An explicit different known numbered target, filter or size can supersede a read.
Revision guards prevent obsolete responses, failures, defects and authority errors
from changing the latest query. Runtime Scope owns cancellation and disposal.

`page` and `stats` remain the successful displayed snapshot until replaced.
`displayedQuery` identifies its sandbox/generation, filters, page number and size;
`resultsCurrent` compares it with the requested query. During failed or pending
query replacement, the heading says `Loading…` or `Results unavailable` instead of
attributing the retained count to the requested query. Current results show only
`filteredTotal` and `result` / `results` in the existing heading; failed refreshes
mark retained current totals stale. Global stats remain global and independent of filters.
Status tabs are the only dashboard filter controls. Legacy dashboard `kind` and
`due` URL parameters are removed on entry and history navigation; valid `state`
parameters remain active. Return contexts omit kind and discard cursors scoped to
a removed kind filter. Backend kind filtering remains available. Completed tab
requests replace the list URL and in-memory return anchor, so All jobs cannot
revive a status restored from details. Real read errors stay
visible (`error`, stale/error connection). Real authority revocation clears old data.
Connection status reflects admitted live signals, reconnect attempts, socket loss
and browser connectivity; starting a read never infers a reconnect. A successful
HTTP reconciliation cannot claim a disconnected WebSocket has reconnected.

## Live totals and numbered navigation

`JobPage.filteredTotal` is a required nonnegative integer: all matching associations
for this sandbox/generation and state/kind filters, **before the cursor predicate**.
It shares one authoritative SQL statement snapshot with authority, items and global
stats. `pagination.total` comes from this snapshot and `pageCount` is
`ceil(filteredTotal / displayedQuery.pageSize)` (zero for an empty result). Both are
undefined before a snapshot. If a new filter is pending, these counts belong to the
retained displayed query. Never use unfiltered `stats.total` for filtered page counts.
Fifty matching rows immediately report three pages at 20, without visiting page 2.

The server still orders IDs ascending under PostgreSQL `COLLATE "C"` and uses scoped,
signed opaque keyset cursors. `pagination.pages` contains only reachable numbered
history positions: visited anchors and the next neighbor actually supplied by SQL.
For 50 rows at 20, the first read reports `pageCount: 3`, `pages: [1, 2]`. Visiting 2
learns the real anchor for 3. Every displayed numbered button, including the last
one, works. Unknown numbers are ignored. The total does not authorize a last-page
jump or arbitrary random access; no offset fallback or full-dataset client fetch.
Neighbor discovery requires one bounded page read, not a scan of all matches.

An unchanged next anchor preserves descendants; a changed anchor prunes them;
null removes later controls. Filter, size and generation changes reset history.
An empty cursor page, a history position greater than the new cardinality ceiling,
or a last-counted position that still has a lookahead
restarts from first with at most one additional bounded list request. The normalized
page number/cursor and displayed query publish atomically with its validated result.
If that recovery fails, retained rows keep their original display label and an error.
Malformed/foreign/filter-mismatched signed cursors remain explicit errors.

Concurrent arrivals before the current anchor appear on returning to first, while
live total/pageCount updates immediately on every accepted snapshot. New arrivals
beyond the anchor can appear in the current/next page. Deletes and filter membership
changes may change page contents. History numbers are cursor-chain positions, not
stable ordinal ranks or a frozen dataset: concurrent changes can cause overlap after
returning to earlier pages. Cardinality pages and reachable cursor positions are
separate facts. Do not promise unsupported full arbitrary random access.

## Privacy and verification

Describe/list expiry, stale generation, not-found authority, foreign identity and
generation regression revoke rows, stats, detail, selection, pending receipts and
history. A new generation clears old data before its replacement read. WebSocket
admission close 4003 revokes immediately and fences outstanding reads. The listener
is tied to its socket, identity and Scope, so retired sockets cannot revoke new data.

`BackgroundReads.test.ts` observes 40 successful cycles, live counts, 20/50 shrink,
foreground priority, duplicate demand, late success/error/defect and privacy recovery.
`Reads.test.ts` and `Atoms.test.ts` exercise delayed query labels, latest revision,
known neighbors, selection and generation fencing. `Runtime.test.ts` uses actual
browser FFI callbacks for polls, visibility, ready signals, disconnect and admission
revocation. `ReadMetadata.test.ts` verifies SQL scope/parameters/filter placement,
empty cursor metadata, cursor scope and invalid count rejection. These synthetic
checks do not claim PG execution, DOM/focus/scroll, workerd or real-browser behavior.

## Integration C handoff and finite PG reproduction

C owns Dashboard/Pagination wiring and the integrated browser harness. Its synthetic
`Ux.mjs` list response must include `filteredTotal: filtered.length` before cursor
slicing. Keep numbered controls from `pages`; show live `pageCount` independently.
Do not invent controls from the total. Preserve focus using operation guards.

Use C's one disposable integrated PG16.15 session, loopback isolated port and fresh
schema/credentials; do not touch preview8787. For sandbox A/generation 1, seed 50
matching `Pending`/`playground.scenario` associations and nonmatching state/kind rows
in A plus rows in sandbox B. Request `{filters:{state:"Pending",name:
"playground.scenario"},limit:20}`: assert `filteredTotal=50`, 20 items, pageCount=3;
follow signed next cursors for 20 then 10 distinct scoped items, all totals 50.
Repeat no-filter count against A's actual association count and limit50 (one matching
page). Insert a matching arrival before the active anchor: total51/pageCount3 at20,
current keyset membership unchanged; first reveals it. At50, 51 matches =>2 pages.
Delete or transition matches so only 5 remain while page2 is active; reconcile and
assert one first-page recovery, total5/pageCount1, correct normalized label. Delete
all matches: empty items, total0/pageCount0 while global stats remain independently
correct. Rotate generation/expire via DB time and verify old ref/cursors fail and
old displayed rows clear. Capture final query inputs, assertions and artifact hashes;
cleanup exact owned resources in finally. This stream starts no PG/service attempt.
