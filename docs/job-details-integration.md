# Job details integration

The local integration adds a quick drawer and `/jobs/:jobId` and
`/demo/jobs/:jobId?generation=...` detail views. Encoded payloads, retained facts,
related jobs and repair controls use the shared strict contracts. Handler results,
creation times and complete attempts remain explicitly unavailable. Browser
plaintext and local keys stay inside the payload component. Navigation, expiry
and unmount revoke that component.

Private pages and every private API require trusted `LOCAL_PRIVATE="true"`.
Request Host, headers, cookies and query hints cannot enable private mode. Demo
mutation paths are denied before entering the database composition. Public data
admission waits for an actual completed synthetic encrypted job and the audited
known-failure corrected successor resolution. The original failure remains Dead.
The internal seed capability has no HTTP route.

Resolution filters use the separate problems API. Needs attention counts Open
and InProgress chains once; execution counts still include every retained job.
Problem-only tombstones render without fabricated job summaries. Both mutation
families retain an immutable registry-owned request identity after uncertainty;
only their separate exact receipt ports can reconcile it.

## Application migration setup

Apply `MigrationRegistry.migrations(schema)` in application-owned migration
transactions before backend readiness. Historical v1-v5 generators/bytes are
preserved; v6 first applies mapped core lineage and then app repair schema.
After v6, explicitly run `MigrationRegistry.backfillSyntheticTenants(schema)`
inside the same native migration client/transaction. The hook validates exact
catalog, canonical payload/projection and existing scope/actor/order before
retaining tenant authority. Invalid/missing source artifacts cannot supply it;
correction safely refuses when neither a valid old artifact nor authoritative
retained tenant exists. New private and trusted encrypted seed associations write
validated tenant directly.

The migration hook is setup code, never a request/event migration. No imports
create pools, start workers or run DDL. The native repair adapter and core backend
must share the exact scoped SqlClient used by `Event.run`.

## Finite qualification

```sh
bun run check
bun run check:postgresql
bun run playground:check
bun run playground:test
bun run playground:build
bun run test
node apps/website/tests/ui/DetailsIntegration.mjs
node apps/playground-worker/tests/details-integration/Admission.workerd.mjs
```

DetailsIntegration uses the production Client.js/CSS and explicit synthetic HTTP
fixtures. Admission.workerd uses actual workerd and denied routes with nonusable
synthetic database configuration. Neither qualifies stored PostgreSQL data.
The original actual-PG qualification entrypoint is
`apps/playground-worker/tests/repairs/PostgreSqlQualification.ts`; execute it only
with an explicitly owned fresh PG16.15 client/schema and finite cleanup scope.
No historical full Actionable matrix or soak is required by this slice.

Real database repair/retention/backfill/concurrency, native/installed-PG and the
combined PG/workerd/browser lifecycle remain prerequisites until executed.
Aggregate lint/format and upstream Drizzle declaration limits must be reported
separately from focused passing checks. No remote publication or preview switch
is included.
