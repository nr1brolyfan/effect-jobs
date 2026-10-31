# Local Effect 4.1.0 / Drizzle rc.5 candidate

## Isolated retry API candidate

`0.1.0-alpha.1-effect.4.1.0.local.3` adds the owner-approved typed configuration
and bounded proportional-jitter revision to the
[composable retry policy](retry-policy.md) on the local.1 dependency baseline.
Previous local.1/local.2 archives remain immutable. New checks must be rerun on
these revision bytes; previous review/test receipts are not evidence for changed APIs.
It remains isolated from the owner checkout and the separate API/docs redesign.
Core Node/Bun, source PostgreSQL persistence and installed-consumer checks must
be tied to these new bytes, not borrowed from local.1. Original full-verification
and foreign-declaration limits remain unwaived. Independent review and owner
integration are not claimed by local tests or artifact creation.

## Historical Effect 4.1.0 local.1 dependency candidate

`0.1.0-alpha.1-effect.4.1.0.local.1` targets exact `effect@4.1.0` and optional
`drizzle-orm@1.0.0-rc.5`. Active native/platform/Atom companions and qualification
consumers use `4.1.0` as well. Node, Bun and compiler pins are unchanged.

This is a local-only dependency update. It neither publishes a release nor
integrates the separate documentation/API candidate. Existing encryption codecs,
key ownership, ciphertext envelopes, fingerprints and UUID generation remain
unchanged; adopting the unstable `effect/crypto` modules is a separate decision.

Previous local artifacts remain immutable. Source, packed-consumer and native
PostgreSQL results must be recorded against these new bytes. Foreign declaration
audits run on the actual new graph without inheriting older snapshot exceptions.

Effect 4.1 promotes typed failures to defects when combining them with a dying
finalizer. Codec tests independently retain the explicit mixed-Cause preservation
and redaction oracles, and exercise native finalizer normalization through both
encrypted and standard schemas. Neither case permits worker finalization after
defects or interruption. Test-only SQL clients now supply the required `driver`.

## Historical Effect 4.0.5 local.3 candidate

`0.1.0-alpha.1-effect.4.0.5.local.3` is a local-only dependency update with exact
peers `effect@4.0.5` and optional `drizzle-orm@1.0.0-rc.5`. Development and
qualification consumers use the same ORM release. It does not integrate the
separate documentation/API redesign candidate or authorize publication.

The previous local.2 artifact remains immutable. Its snapshot-specific foreign
declaration exceptions do not apply to rc.5: the native consumer runner performs
a fresh `skipLibCheck:false` audit and reports failures as unwaived. Current
commands, exact archive hashes and results belong to the local.3 delivery receipt;
the historical counts below are not evidence for these new bytes.

## Historical local.2 candidate

`0.1.0-alpha.1-effect.4.0.5.local.2` identifies local migration bytes based on
published alpha.1/main `eb25dfa6272f0e2c807af6b3dbb57392e4c4a103`.
It is not a published release or a publication plan. Effect peers and supported
qualification consumers use exact `4.0.5`; the native companion is
`@effect/sql-pg@4.0.5`. Node 24.15.0, Bun 1.4.2 and compiler pins stay unchanged. The exact
Drizzle peer set is `1.0.0-rc.5-ab785fc || 1.0.0-rc.5-169397b`; development
uses `ab785fc`, with an independently installed `169397b` matrix variant. Application pool/migration ownership and D1–D8 remain unchanged.

Use the supplied immutable local tarball with ordinary npm installation and no
peer bypass or overrides. README's shell fence refers to that local file.
Run the gates below against that archive. For this candidate run
`node scripts/check-release.mjs --metadata-only` instead of `release:check`:
this validates inventory, metadata, imports and exact packed bytes, then records
publication checks as NotTested without invoking npm publish, even in dry-run.
The local version guard rejects the publication path without that flag.

The issue handoff binds command exits, source tree, patch and tarball hashes to
new evidence. Historical counts and receipts below are not results for these
bytes. A+B source contracts require strict/exactOptional with owner-approved
dependency `skipLibCheck:true`. C remains separately reported known upstream
FAIL and is nonblocking; unchanged foreign audit inputs reuse their original
hashed log/config/command. Consumer success is not C PASS.
The qualified native route uses public `PgClient.withTransaction(body)`, preserving
Drizzle schema/query building and inferred E/R without correcting `db.transaction`.
Ordinary outer ownership and jobs joining that exact client/Context are covered;
nested/options/isolation equivalence is not promised. Cloudflare,
external services, real network/server crashes and production remain NotTested.

## Local.2 dual-snapshot evidence

Local.1 remains immutable, SHA256
`40ba80678ac19ef73fbd61fd288206ebc72c8a3cdfd1b41e4af4ad83ef424f88`.
Local.2 changes qualification metadata, tooling and documentation; production
runtime and its native transaction owner are unchanged. Qualification checks
actual resolved versions rather than treating the peer OR string as a pin.
For each exact snapshot run build/types, native packed A+B including six actual
negative diagnostics, real-PG Node/Bun explicit and ambient transaction probes,
and schema/index generation. Root verify additionally covers core tests and
release/JSDoc guards. Optional PG skips in root verify remain NotTested there;
the native packed matrix supplies its own real-PG receipts.

The normal combined Alchemy 2.0.0-beta.83 graph uses exact `ab785fc`, one Effect
4.0.5 and intended sql-pg 4.0.5 / pg 8.23.0 peers. It is an install-graph result,
not a cloud/runtime/deployment guarantee. The final handoff binds the source
base/head/tree, full binary patch, archive and main/variant consumer lockfiles.

Owner approval in UPVE-2497 thread `01a15e56-25ce-7800-aa6e-e3e246ca237f`
extends C's nonblocking exception only to the seven demonstrated byte-identical
upstream diagnostics for exact `ab785fc`: 3 TS2307 and 4 TS2420. C stays FAIL,
never full strict PASS. Own A+B strict/exactOptional and negative controls remain
required independently for both variants. Real network/server crashes, other
snapshots, nested/options/isolation equivalence and downstream apps are NotTested.

## Local playground: exact Redux declaration exception

Owner approval in UPVE-2531 thread `01a16073-b6e7-7ea9-9f1e-2f0b9498e2e9`
accepts only the six diagnosed foreign declaration errors on the frozen
`Recharts@3.10.1 -> @reduxjs/toolkit@2.13.0` graph with TypeScript `7.0.2`.
Recharts owns this internal Redux state; application state remains Effect Atom.
All locations below are in `@reduxjs/toolkit/dist/index.d.ts`:

| Code   | Location                          | Incompatibility                                                              |
| ------ | --------------------------------- | ---------------------------------------------------------------------------- |
| TS2344 | 994:146, 994:249, 994:346, 997:74 | Merged thunk `dispatch` does not satisfy the `ThunkDispatch` constraint.     |
| TS2344 | 1690:99                           | Merged thunk `state` does not satisfy `PreventCircular`'s `never`.           |
| TS2420 | 2064:15                           | `TaskAbortError.code: string \| undefined` does not satisfy `code?: string`. |

The audited declaration SHA256 is
`4ebd4061b84c620b21e519842bab9f1a42b3c48e17ba7742ee172492e81a518d`.
The original Packed UI log and a normal installed one-line `import "recharts"`
reproduction have identical diagnostics. The retained compiler configuration uses
NodeNext, `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
`verbatimModuleSyntax`, `noEmit` and `skipLibCheck:false`. Full foreign strict
remains **FAIL with the accepted exact-six exception**, never full strict PASS.

Acceptance requires the exact diagnostic multiset and frozen dependency/compiler
provenance. Extra, substituted, duplicated or own-code diagnostics are not covered;
a changed graph, declaration hash, flags or diagnostic set requires new
qualification and cannot inherit this exception automatically. Own-code strict,
negative compiler oracles and required runtime gates remain independently required.
No dependency patch/upgrade, suppression or compiler-option change is introduced.
The separate exact-seven Drizzle C exception above is unchanged. Immutable raw FAIL
logs, individual negative expectations, manifests and gate receipts remain in the
issue handoff; recording acceptance does not rewrite historical evidence.

## Historical alpha.1 release candidate qualification

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
