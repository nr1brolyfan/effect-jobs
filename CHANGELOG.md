# Changelog

## 0.1.0-alpha.2 (unpublished candidate)

Breaking prerelease changes since alpha.1:

- Rename public `Job.make({ kind })` to `{ name }`, definition/catalog and handler
  context access from `.kind` to `.name`, and `JobIdentity.JobKind` to
  `JobIdentity.JobName`. The public Drizzle jobs-column property also becomes
  `.name`, including `extraIndexes` callbacks. Keep existing name values and
  catalog versions: the physical PostgreSQL column is still `kind`, so this
  rename alone needs no column rename, data rewrite/reset or migration. See
  [the API migration contract](./specs/api-refinements.md).
- Require exact Effect `4.0.5`; the qualified native PostgreSQL companion is
  `@effect/sql-pg@4.0.5`. Optional Drizzle peers are the exact snapshots
  `1.0.0-rc.5-ab785fc` and `1.0.0-rc.5-169397b`.
- Bind producer slots to definitions with inferred enqueue inputs and explicit
  application-owned transaction/service composition.
- Extend the PostgreSQL schema/readiness contract for Cancelled jobs, guarded
  operators, corrected redrive and durable repair lineage. Applications own
  migration review and execution; runtime does not migrate old installations.

Also included:

- Focused `JobOperators` support for guarded retry acceleration, cancellation and
  redrive; corrected redrive creates a new job and preserves source evidence.
- Current Astro documentation, runnable application examples and the local
  playground. The npm package excludes the website/playground implementation.
- PostgreSQL Node/Bun CI, real-process crash/recovery tests, and a bounded manual
  soak harness. These are scoped synthetic qualification, not production or
  exactly-once guarantees.

Completed retention remains 90 days by default. Upstream Drizzle full-declaration
checks retain their documented known-failure exceptions; successful own-code
checks do not mean upstream full strict PASS. Publication, registry installation
and deployment remain separate owner actions.

## 0.1.0-alpha.1-effect.4.0.5.local.2 (local only)

- Qualify exact Drizzle snapshots `1.0.0-rc.5-ab785fc` and `1.0.0-rc.5-169397b`
  with Effect/sql-pg 4.0.5; use `ab785fc` for the Alchemy beta.83 peer graph.
- Preserve native PgClient transaction ownership and production runtime bytes.
- Keep the narrowly approved seven upstream declaration diagnostics as separate
  C FAIL; require independent A+B source and negative controls for both snapshots.

## 0.1.0-alpha.1

Breaking prerelease API changes since alpha.0:

- Resolve ambient `enqueue` through `JobEnqueue` on the same active PgClient;
  use `enqueueStandalone` for an explicitly owned transaction.
- Use immutable `JobPolicy.defaultPolicy` and validated typed `FailureCode` catalogs.
- Bind `JobPayload.encrypted` to a domain Schema and application key service.
- Default job version to 1 and infer the standard encoder; add optional Drizzle
  `extraIndexes` without changing the required baseline.
- Preserve mixed codec Causes and qualify the revised README against the exact
  package, pinned Alchemy declarations, Node/Bun and native PostgreSQL fixtures.

Cloudflare external PostgreSQL and deployment remain NotTested. This changelog
describes the release candidate; registry publication is a separate owner action.

## 0.1.0-alpha.0

Initial alpha extraction of the Effect-native durable jobs mechanism from
MIT-licensed effect-auth, with application-owned domains and infrastructure.

- Schema-defined catalogs, typed producer slots and library-generated job IDs.
- Transaction-bound production and immutable semantic duplicate comparison.
- PostgreSQL two-table storage, fixed leases, fencing, retry and bounded recovery.
- Explicit scoped workers, bounded cleanup and protected-payload projection.
- Focused ESM exports and optional effect-native Drizzle migration declarations.

This is an alpha, not a production qualification claim. Exact versions and
unsupported cases are listed in README and the release qualification document.
No registry publication or cryptographic build provenance is claimed by this file.
