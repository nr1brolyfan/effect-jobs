# Release qualification

## Integrated alpha.2 candidate (unpublished)

Package metadata remains `0.1.0-alpha.2`. This local integration combines current
main and the preserved contract-first redesign, selecting exact Effect/sql-pg
`4.1.0`, Drizzle `1.0.0-rc.5`, and Alchemy/Cloudflare `2.0.0-beta.85`.
Node `24.15.0`, Bun `1.4.2` and TypeScript `7.0.2` remain pinned. The standalone
Alchemy example retains its bounded TypeScript 6 graph. Completed retention
remains 90 days.

Historical receipts below describe their original inputs only. Final integrated
qualification must bind a complete source snapshot and one immutable archive to
fresh commands, graphs and hashes. No source/packed pass authorizes push,
publication, deployment or remote integration. Full foreign-declaration audit
results must be collected on these pins; older exceptions are not inherited.

Build all application assets before browser/site tests. Required local gates
include clean-artifact frozen install, verify/types/lint/format/build, README and
JSDoc/source/packed API, generated reference, optional-peer import boundaries,
real PostgreSQL Node/Bun/crash and installed consumers, native workerd/provider
lifecycle, browser/site and the standalone Alchemy example. Preserve independent
SQL oracles, negative controls, mixed-Cause/Unknown/no-replay guards and actual
cleanup receipts. Unrun or blocked checks are not PASS.

Source fixtures use one physical root Effect runtime for Schema metadata; their
Vitest PostgreSQL matrix deduplicates that peer explicitly. Independently installed
consumers must resolve the qualified archive and selected Effect from their actual
caller paths. A matching package version alone does not prove matching bytes or
one Schema runtime; retained registry copies are not qualification of this candidate.

Use one `EFFECT_JOBS_ARCHIVE` for installed checks and verify source/archive byte
parity. `node scripts/check-release.mjs --metadata-only` checks inventory and
metadata without publication. The owner alone may later publish that same
qualified archive with `--tag alpha`; this task does not authorize it.

Effect 4.1 promotes typed failures to defects when a dying finalizer is combined
with them. Preserve explicit mixed-Cause structure tests separately from native
finalizer normalization tests. Neither permits retry/finalization after defects
or interruption. Native SQL fixture clients supply the required `driver` field.

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
Native Drizzle full-declaration results remain separate and must be remeasured on
the selected graph. Immutable raw FAIL logs, individual negative expectations,
manifests and gate receipts remain in the handoff; recording acceptance does not
rewrite historical evidence.

## Reproduction and evidence

The tracked `.github/workflows/ci.yml` defines the required Verify, PostgreSQL
Node/Bun and process-crash gates. Use the exact tools and frozen installs from
that workflow, including its isolated PostgreSQL and crash fixture installs.
Build library/contracts and all application assets before browser/site adapters;
`verify` performs that ordering itself. Run heavy builds and qualifiers serially
so no gate reads partially rewritten assets.

Build and pack one immutable candidate. Supply the same `EFFECT_JOBS_ARCHIVE` to
the README, JSDoc, public release, API, PostgreSQL installed, native Drizzle,
Drizzle-index and creation-metadata gates. `release:pack` refuses to overwrite
existing bytes and records SHA256, SHA512, integrity and inventory. Source/packed
byte guards and actual caller resolution are required; registry bytes with the
same version are not substitutes.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run test:browser:install
bun run verify
bun run playground:check
bun run playground:lint
bun run test:postgresql:matrix all
bun run test:postgresql:crash
bun run release:pack
# Set EFFECT_JOBS_ARCHIVE to the immutable archive produced above.
# Native PG runners also need validated task-owned loopback resource records.
bun run qualify:docs:readme
bun run check:docs:api
bun run qualify:release
bun run qualify:api:installed
bun run qualify:postgresql:installed
bun run qualify:drizzle:native
bun run qualify:drizzle:indexes
node scripts/check-release.mjs --metadata-only
```

The full handoff also records compiled browser/UI, public docs/islands, native
private/public/observation/concurrency, provider cleanup, bounded export and
standalone Alchemy gates. Source optional-PG skips are NotTested in that command;
dedicated source Node/Bun matrices must run every required case without skips.
Strict core declarations, normal native own-code checks with the approved
`skipLibCheck:true`, and full foreign-declaration diagnostics have distinct scopes.
Never convert a foreign FAIL or unavailable prerequisite into PASS.

Evidence must cover immutable slot/routing inference and negative controls,
complete catalog handlers, constructor snapshots, same-client atomic
producer/domain/receipt writes, first-write policy and queue retention,
protected/fractional payloads, bounded artifacts, DB-time leases/fencing,
retry/cap/jitter/creation metadata, read-only scheduling, finite shutdown,
Unknown reconciliation without replay, and cleanup/authority/privacy races.
Keep SQL oracles independent of implementation builders.

Every owned process, listener, pool, temporary privilege and disposable container
must be closed or restored before handoff. Resource records identify exact
container/image/labels/deadline/loopback ports; validate actual ownership before
SQL or cleanup. Keep credentials outside Git and reports. Real runtime bundles,
source/config/lock hashes, immutable archive hashes, command exits and cleanup
receipts belong to the delivery evidence.

Historical receipts remain in Git history and the integration evidence, bound to
their original source/tools. They do not qualify this candidate. Cloud deployment,
production traffic, arbitrary network/server failures and other driver/runtime
versions remain NotTested unless separately exercised. Actual worker SIGKILL is
qualified by its dedicated gate; synthetic lost acknowledgements are not network
fault or server-crash guarantees.

No publication, registry mutation, push, PR or remote merge follows from a local
PASS. Owner authentication, registry ownership/MFA, release tagging and deployment
remain separate authorized actions. Preserve the MIT license and attribution.
