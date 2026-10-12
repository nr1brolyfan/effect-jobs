# Private operator integration checkpoint

The private boundary defines POST `/api/jobs/operator` and POST
`/api/jobs/operator/receipt`. Strict commands bind sandbox, generation, request ID,
source ID, expected state/version and action. Redrive additionally requires
`confirmDuplicateEffects: true`; client-selected producer, policy and payload are
rejected. Accepted responses describe historical operator acceptance, not handler
completion. Unknown responses retain the exact command identity and permit only
read-only receipt reconciliation. Distinct confirmations are distinct consequences.

This checkpoint does **not enable operator execution**. The event composition
still explicitly provides `OperatorsUnavailable`, and persisted capability hints
remain false. The application transaction adapter and private source validation
are staged for the separately authored root library operator service. No job
lifecycle UPDATE is implemented in application code.

## Implemented application scaffolding

- Atoms owns one immutable pending command across scenario/reset/operator actions.
  Responses are guarded against revoked authority and stale selection. Accepted
  receipts trigger silent authoritative reconciliation, without fabricating rows.
- Native dialogs provide keyboard/touch confirmation, Escape dismissal and focus
  return. Redrive explains the new ID/budget and possible duplicate effects.
  Active cancellation explains that safe interruption is unavailable.
- `PostgreSqlOperatorTransactions` stages separate durable admission followed by
  one native owner transaction. Admission stores every normalized command field;
  changed-content reuse fails closed. The sandbox lock precedes scoped job locks,
  with persisted demo denial, generation/DB-time expiry checks, shared admission
  and retained-job quotas, immutable receipts/audit and restrictive lineage.
  Duplicate unresolved admissions never grant a fresh source capability.
- Command-side artifact validation checks the supported catalog, exact canonical
  bytes/projection, sandbox/generation and private export subject/tenant invariant.
  It invokes no handler/provider. The server hashes the complete scoped
  request/source tuple for a bounded deterministic new producer identity.
- `LegacyJobsV1` freezes the accepted six-state SQL generator. Tests pin exact
  v1/v2/v3 checksums for two schemas. `OperatorSchema.proposal` is the staged app
  v4 fragment; it is deliberately unregistered until the root additive migration
  is available. No existing database was migrated.

## Explicit local origin configuration

`LOCAL_PREVIEW` enables HTTP aliases only when its value is the exact string
`"true"`. The trusted `ORIGIN` must be a canonical HTTP localhost or 127.0.0.1
origin with a nonempty port. Both aliases are admitted at that port, while POST
and WebSocket Origin must equal the actual selected request origin. Admission is
independent in Worker, Gateway and the live DO. No Host/forwarded-header authority
or IPv6 alias is introduced.

Cookie issuance/authentication receives trusted policy context. Preview cookies
are host-only, per-port, SameSite=Strict, with an HttpOnly credential and a separate
CSRF cookie. Hosted mode defaults to exact HTTPS with Secure `__Host-` cookies.
The shared Cookies module selects names; it grants no authority by itself.
The disposable launcher sets the flag only for its HTTP mode, preserving its
strict HTTPS mode. Browser HTTP stays relative and WebSocket URLs use location.

## Remaining integration and qualification

The root author/coordinator must hand off the exact qualified operator commit
before serial integration. Then wire `PostgreSqlJobs` factory/layer/exports and
same-client `JobOperators` into private persistence, remove the explicit unavailable
layer, enable only persisted private capabilities, append combined v4, and extend
Cancelled DTO/stats/read/chart/filter fixtures. Preserve the original root source
while its author is active.

Real PG16.15 atomicity/concurrency/expiry/Unknown/migration checks and Chromium
HTTP/WS/cookie/operator confirmation/CSP/StyleX/axe qualification remain required
on the final combined bytes. Unit source tests do not qualify the staged SQL
adapter, actual focus behavior or browser alias sessions. Use one owned disposable
database/runtime at a separate port. Keep the existing preview untouched.

There is no full-CI, hosted, deployment, soak or review claim at this checkpoint.
The existing skipLibCheck limitation remains. Root backend/installed/new-subpath
guards and the one frozen coordinator-controlled review set follow combined
qualification. No push, PR, main merge or preview switch is authorized.
