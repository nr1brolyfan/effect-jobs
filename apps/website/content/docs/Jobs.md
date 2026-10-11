## Explore durable jobs

The jobs playground is a separate application consuming `effect-jobs`. It uses
synthetic orders, actors and providers. Source labels distinguish UI fixtures
(`mock`) from actual local, workerd or hosted observations. A mock read is not
evidence of durable execution or PostgreSQL qualification.

### Reading a page

Apply exact state and kind filters together. Results are ordered by job ID
ascending, using an opaque cursor. Search and the due-Pending checkbox operate
only on the current page; due uses the browser clock and cannot establish DB-time
eligibility. Counters describe this page, not the whole sandbox. The frozen API
has no global text search, alternate sort, total count or expired-lease query.

Refresh retains filters, cursor and selected job. Pages are current reads, not
historical snapshots: changing states can move rows between pages. An invalid
cursor is shown as an error. Use **First page** to restart explicitly. Reconnect
and the visible-page five-second timer reconcile reads. Stale state retains the
last successful read and labels it as potentially outdated.

### Details and privacy

Details show identity, persisted policy, failure code, finalized attempts,
stalled recoveries and lifecycle version. Lease duration is policy, not proof of
current ownership. The API does not expose lease tokens or expiry, payloads,
ciphertext, fingerprints, progress percentages or complete attempt history.
Synthetic entity links lead only to the explanation on this page. Missing
observations mean unknown, not success or zero progress.

### Commands and unknown outcomes

The launcher selects a bounded scenario and count (1–10). These scenarios control
fake provider behavior; they never send live email, payments or webhooks. Run and
reset are disabled when capability flags are false. Retry, cancel and redrive
have no supported browser command and remain disabled even if a future capability
flag changes. The server must independently enforce authority, CSRF and budgets.

Acknowledged enqueue does not prove handler success. Unknown command results,
including transport failures after sending, retain the exact request identity
and disable further commands. **Check exact request receipt** performs only a
read. Absence of a receipt never authorizes replay. Acknowledged reset hides old
data immediately and advances the sandbox generation; it does not cancel running
jobs or edit library lifecycle state.

Pending request identity is mount-local and is lost on reload. The UI does not
persist sandbox credentials or uncertain commands in browser storage. Durable
receipt lookup across page loads belongs to the server integration.

### Isolation

Only your server-authorized sandbox is read. UI development fixtures use a fixed
synthetic sandbox and provide no authentication. A public read-only shared feed
is explicitly unavailable because the frozen contract has no such endpoint.
Hosted integration must use real jobs and a server-owned credential cookie,
never fixtures or client-supplied authority.
