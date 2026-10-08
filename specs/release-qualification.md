# Alpha.1 release candidate qualification

The `0.1.0-alpha.1` candidate starts at remote main
`031cbcdea33e40edaad78605c683d498c86824fe`, tree
`353745a6aae5c5b07720c1a0d20c444c60c639ae`. It preserves PR12 runtime source
bytes and its original-author final receipts, including the accepted C1 fix.
Only README, qualification fixtures/guards, release metadata and this provenance
are revised. The breaking prerelease API differences from published alpha.0 are
listed in CHANGELOG.

On 2026-10-08 the registry contained only alpha.0, with both `alpha` and `latest`
pointing to it. Alpha.1 must be checked free again before publication. Publish the
exact qualified archive with `--tag alpha`; do not republish alpha.0 or alter
`latest`. Registry installation/MFA/publication belongs to the owner/coordinator.

Run the current `verify` pipeline and PostgreSQL type/source gates on final inputs,
then pack once and consume that immutable archive with `EFFECT_JOBS_ARCHIVE` in
`qualify:docs:readme`, `qualify:release`, `check:docs:api`,
`qualify:api:installed`, `qualify:postgresql:installed`,
`qualify:drizzle:native`, `qualify:drizzle:indexes` and `release:check`.
All are local, finite foreground gates. Optional source PG skips never count as
PG PASS; use the separate task-owned loopback resource for real PG invocations.

The README qualifier inventories every visible fence. All TypeScript fences are
extracted exactly and checked against source/current packed declarations. Runtime
fixtures cover producer/service/slot composition, policy, optional Drizzle indexes,
handlers, bounded drain and real AES-GCM/HMAC application key services on Node/Bun.
Native SQL/polling/startup/migration readiness require their separately qualified
application runtime; Cloudflare external PG, callback execution and deployment
are NotTested. Alchemy beta.81 declarations are installed and hashed in a separate
consumer because its optional Drizzle peer pin differs from the library's native
Drizzle pin. This declaration check is not a combined deployment compatibility claim.
Shell install fence checks candidate version/command; actual registry installation
waits for publication. The text topology is conceptual.

Node 24.15.0, Bun 1.4.2 and root frozen tool pins remain required. Archive inventory,
SHA256/SHA512/integrity, input hashes and sanitized receipts bind the final bytes.
Full upstream strict Drizzle declaration FAIL and server/network crash/Cloudflare
NotTested limits remain explicit. No production deployment is included.

## Historical alpha.0 qualification

This release preserves accepted D1–D8 and all production source bytes of main
`427e9f96db19808b89671c733f8c84edca165ff5` (tree
`8ea09baa94089ed66c13964af00a9adf93497b76`). New work covers packaging, documentation
and finite qualification tooling. No auth dependency, migration of legacy data,
new backend, worker protocol or cryptographic mechanism is introduced.

## Immutable artifact and reproduction

Version `0.1.0-alpha.0` is the first prerelease for the existing `effect-jobs` name.
The public registry returned E404 on 2026-10-06; availability and ownership must
be checked again by the coordinator immediately before publication. Dist-tag is
explicitly `alpha`, never `latest`. The MIT license is retained with both jobs and original auth copyright notices; the
mechanism was extracted from the owner's MIT effect-auth repository. No invented
npm ownership or cryptographic provenance is asserted.

Use Node 24.15.0, Bun 1.4.2 and exact locked tools. There are no tracked GitHub CI
workflows. Local gates are the actual package verify pipeline plus PostgreSQL
types, source and installed matrices and native optional-peer checks.

```sh
bun install --frozen-lockfile
(cd tests/postgresql && bun install --frozen-lockfile)
(cd tests/qualification/d6-pg && bun install --frozen-lockfile)
bun run build
bun run release:pack
# Set EFFECT_JOBS_ARCHIVE to that immutable versioned archive.
# Set D6_RESOURCE_DIRECTORY to private, task-owned loopback PG resource records.
bun run qualify:drizzle:native
bun run qualify:release
bun run verify
bun run check:postgresql
bun run test:postgresql:node
bun run test:postgresql:bun
bun run qualify:postgresql:installed
bun run release:check
```

All child operations are foreground and finite. Tests sharing schemas run
serially. Resource records contain exact container/image/labels/deadline/loopback
ports; validation compares actual Docker state before fixture SQL. Credentials
are kept outside Git and reports. The application creates/drops fixture schemas,
restores temporary privileges and closes pools in finally. The author removes
only its exact verified disposable container before handoff.

`release:pack` refuses to overwrite an existing archive and records SHA256,
SHA512, npm integrity and included files. Installed and native runners consume
`EFFECT_JOBS_ARCHIVE` without rebuilding/repacking. `release:check` validates
exports/files, lifecycle absence and explicit-alpha npm dry-run. It never
publishes. Coordinator publishes those same bytes only after review, integration,
local/hosted gates and owner authentication. Any integration byte change requires
rebuilding and qualifying its affected inputs, not relabeling old receipts.

## Required evidence inventory

The issue attachments contain final exact Git identifiers, archive hashes,
runtime versions, command exits, read manifest and sanitized detailed logs. This
file defines evidence scope; it does not assert a future gate succeeded.

| Accepted requirement                                           | Qualification oracle                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Typed declarations, operation/slot validation, library job IDs | Core definitions/identity/type gates; PG production inserts and duplicate readback         |
| Catalog/payload/fingerprint equality; first config retained    | Installed real-PG protected duplicates, changed-content conflict and rollback              |
| Exact source/connection/lifetime, outer ownership              | Installed neutral pg application and native Effect Drizzle registrars; auth final receipts |
| Two generic tables, app migrations/pools                       | Installed migration/readiness, least privilege, cascade; import/construction controls      |
| DB-time due/lease edges and ownership fencing                  | Source and installed real-PG equality and neighboring millisecond boundaries               |
| Persisted retries, bounded stalls/recovery and completion      | Installed neutral real-PG lifecycle oracle                                                 |
| Unknown response reconciliation without blind replay           | Deterministic before-send/after-durable-COMMIT injection; core worker protocol             |
| Finite fractions, Union protected projection and bounds        | Core codec and portable installed public-codec probe on Node/Bun                           |
| Malformed payload isolation                                    | Installed public codec rejection and fenced Isolated transition                            |
| Bounded cleanup, cleanup-vs-retry, payload cascade             | Installed generic PG fixture and auth coordinated receipt/OTP receipts                     |
| Registration, OTP, receipt retain-until                        | Auth UPVE-1129/1130 final corrected receipts and UPVE-1355 final-head qualification        |
| Explicit workers/shutdown and metrics privacy                  | Core worker/polling/telemetry gates; installed import controls                             |
| Optional peers absent/present, public export/type graph        | Installed absent-peer imports, native normal npm resolver and exports/types                |
| Runnable setup/documentation                                   | Installed typed quickstart plus real-PG public migration/application fixture               |
| License, private-auth exclusion, lifecycle/package metadata    | Archive inspection, source/artifact hashes and release check                               |

## Limits and preserved evidence

Prior jobs receipt UPVE-1165 binds its archive SHA256
`1fb5a2ae426d80e5725b3412a8147d43b6df98bb4666786aea7b6a5d7cd6171c` to main's
production bytes. Reuse requires per-file byte comparison and unchanged tools and
config; new archive checks cannot be replaced by that old archive receipt.
PR7 Security is OWNER WAIVED for PR7 only, never Security PASS.

Auth PR163 corrected T1–T3 before merge, including source-bound transaction
execution and receipt log privacy. PR164 follow-up qualified final head
`48b0587a7fca673ffcee14b9827d943ef60605c9`, tree
`9879c8bd6ca2215a84feeca79350a9187630416e`, merged as
`4f78f51349f646502842717ad18458c26c23550f` with unchanged tree. Its exact receipts
cover 372 PG tests, installed consumers and Node/Bun packed graphs on Node24.15.0
and Bun1.4.1. Those are consumed auth evidence, not new auth tests or evidence for
the new jobs archive until dependency/artifact byte comparison is recorded.

Full upstream Drizzle declaration checking with `skipLibCheck:false` FAIL is
preserved. Strict non-Drizzle declarations and Drizzle consumers with
`skipLibCheck:true` have distinct scope. Native qualification is a concrete
application adapter; no universal Drizzle/Effect SQL transaction adapter ships.
Optional PG skips in root verify are NotTested in that invocation. Real-PG gates
supply their separate evidence. Actual server crashes, arbitrary network faults,
other runtime/driver versions and Cloudflare deployment are NotTested.

No production application deployment is part of this release. Publication and
registry-install verification belong to the coordinator; auth's dependency switch
waits for actual npm publication. Registry authentication/ownership/MFA remains
owner-only and is not bypassed by local qualification.
