# Private job operators

The private boundary defines POST `/api/jobs/operator` and POST
`/api/jobs/operator/receipt`. Strict commands bind sandbox, generation, request ID,
source ID, expected state/version and action. Redrive additionally requires
`confirmDuplicateEffects: true`; client-selected producer, policy and payload are
rejected. Accepted responses describe historical operator acceptance, not handler
completion. Unknown responses retain the exact command identity and permit only
read-only receipt reconciliation. Distinct confirmations are distinct consequences.

Private credential-owned sandboxes enable supported operators through the root
`JobOperators` API. Persisted demo ownership always denies mutations. The native
operator, receipt, audit, quota and lineage writes share the exact application
client transaction. No job lifecycle UPDATE is implemented in application code.

## Application integration

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
  v1/v2/v3 checksums for two schemas. The registrar appends explicit v4 from
  `PostgreSqlSchema.operatorMigration` and app receipt/lineage DDL. Setup remains
  application-owned; event code never migrates a database.

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

## Local qualification

Run `bun run check`, `bun run playground:check`, `bun run build`,
`bun run playground:build`, `bun run test`, `bun run check:postgresql`,
`bun run test:release-imports`, and `bun run check:docs:api` for source gates.
`PLAYGROUND_EVIDENCE_DIRECTORY=.multica/operators-qualification node
apps/playground-worker/tests/integration/Build.mjs` prepares current app/packed
artifacts. Bundle `OperatorProbe.ts` into that evidence directory with esbuild
(platform=node, format=esm, external node:_, effect, effect/_, effect-jobs/*),
then run `python3 apps/playground-worker/tests/integration/OperatorsRunOwned.py`.
The foreground launcher owns fresh PostgreSQL 16.15 on loopback/tmpfs and a
separate workerd/browser runtime. It removes its exact container ID and private
configuration before returning. Never use an existing preview database/config.

The root package provides the focused `effect-jobs/JobOperators` subpath. See
`specs/operator-contract.md` for the generic contract and explicit exclusions.
Installed API qualification includes the operator Context tag, methods and
Schema decoding-service requirements. The private contracts packed guard also
checks browser import independence.

Aggregate historical lint/format and upstream Drizzle declaration limitations
remain separate from scoped qualification. No hosted, deployment, soak or review
claim follows from local checks. The coordinator owns one frozen combined review
set; no push, PR, main merge or preview switch is authorized here.
