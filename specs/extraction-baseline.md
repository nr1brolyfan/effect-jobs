# Extraction baseline (E0 / UPVE-847)

Recorded 2026-10-04. This is a source inventory and reproducible evidence ledger,
not an implementation, release qualification, or permission to start later stages.
`architecture-decisions.md` (accepted D1–D8) overrides historical auth proposals.

## Frozen inputs and ownership

| Input       | Committed revision                         | Branch / test workspace                                                                                |
| ----------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| effect-jobs | `0886232c8e946230e14b0ba582f09c4f9a8af474` | `docs/upve-847-extraction-baseline`, `/home/pc/Code/opensource/effect-jobs-e0-worktrees/upve-847-jobs` |
| effect-auth | `e22d1f250516c12a6aec21f8a3640955d9bd8ca7` | detached, `/home/pc/Code/opensource/effect-jobs-e0-worktrees/upve-847-auth-baseline`                   |

Both assigned workspaces were clean at entry. Auth input tree:
`f8de59a9acc81285610aeb5b2cc7811505dce4c1`.
Jobs main was clean at the jobs input SHA. Auth owner checkout was on
`feat/application-registration` at the auth input SHA, with untracked
`O-transcript.md`, `docs/`, and `repositories/`; these were not read or changed.
The runtime-bootstrap checkout is context-only, not the documentation workspace.

UPVE-847 owns **only this file**. No source, tests, exports, manifests, lockfiles,
migrations, or auth commits are changed. Each workspace has its own frozen-lockfile
dependency installation; none is shared with UPVE-848. Builds and test outputs
exist only in the detached auth test workspace or ignored jobs build directories.
Auth-generated `.fixtures-dist/` and `baseline-*.log` are local evidence, not
source edits. They are not part of the handoff diff.

After extraction, jobs owns the generic mechanism without importing auth. Auth
owns domain definitions, providers, authority, producer transactions, audit and
receipts, protection, and coordinated retention. There must be one lifecycle and
one durable authority, never a dual writer or copied auth runtime.
Application owners retain pools and migrations. Shared package/lockfile/export/
schema edits need serial ownership in later tasks. This task does not activate
those edits, UPVE-848 changes, integration, push, PR, publication, or DB reset.

## Source dependency map

Paths below are relative to the pinned auth root unless stated otherwise.

| Area                       | Existing modules and responsibility                                                                                                                                                                                                                                                                                                         | Extraction boundary                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Definition / catalog       | `src/server/jobs/JobQueue.ts`: immutable queue/definition, explicit transaction enqueue, handler registry, consumer/plan; `AuthJobQueues.ts`: delivery queue                                                                                                                                                                                | Generic definition and registry candidates; auth queue declaration stays domain-owned |
| Data / protocol            | `AuthJobs.ts`, `AuthJobData.ts`: store port, ownership, finalization, reconciliation, retry/retention; `src/server/persistence/PersistenceVocabulary.ts`: stored states/kinds                                                                                                                                                               | Generalize protocol, not auth identifiers/event fields                                |
| Codec                      | `JobPayloadCodec.ts`: bounded payload and semantic bytes, marker projection; `JobQueue.ts`: encrypted marker                                                                                                                                                                                                                                | Adapt to D5, including Union regression and finite fractions                          |
| Worker                     | `AuthJobsWorker.ts`: claim/attempt/finalization; `AuthJobsWorkerDispatch.ts`: private execution-boundary capability; `JobWorkerRuntime.ts`: permit-before-claim bounded scoped drain; `JobWorker.ts`: focused export                                                                                                                        | Extract one worker; do not retain an independent auth worker engine                   |
| Polling / telemetry        | `PollingAuthJobsWorker.ts`: explicit scoped polling/backoff; `AuthJobsTelemetry.ts` plus `src/server/internal/AuthTelemetryVocabulary.ts`: bounded observations                                                                                                                                                                             | Generic observations must lose auth coupling; no import-started fibers                |
| PostgreSQL store           | `src/server/postgresql/PostgreSqlAuthJobs.ts`: closed config, readiness borrow, claim/fencing, reconciliation, recovery, cleanup                                                                                                                                                                                                            | Hardcoded auth catalog/envelope and cleanup references must not enter generic core    |
| Transaction infrastructure | `PostgreSqlExecutor.ts` exports implementation from `PostgreSqlTransaction.ts`; connection/source/pool/access/config/error modules own acquisition and commit knowledge                                                                                                                                                                     | Auth integration delegates to this manager; do not copy it into jobs                  |
| Producer substrate         | `src/server/drizzle-postgresql/PostgreSqlDrizzleJobProducer.ts`: prepare, conflict insert/read/compare, parent + immutable payload; `PostgreSqlDrizzleCompiler.ts`, mapped-table support                                                                                                                                                    | Adapt generic producer bridge; never independently commit                             |
| Notifications              | `PostgreSqlDrizzleJobs.ts` binds `SecurityNotificationV1` from `src/server/notifications/SecurityNotificationEvent.ts`                                                                                                                                                                                                                      | Domain schemas, event construction and provider handling stay auth-owned              |
| Producer operations        | `PostgreSqlDrizzleRegistration.ts`, `PostgreSqlDrizzleRegistrationStorage.ts`, `PostgreSqlDrizzlePasswordChange.ts`, `PostgreSqlDrizzleSession.ts`                                                                                                                                                                                          | Domain + audit + required consequences + receipt share outer transaction              |
| Email OTP                  | `PostgreSqlDrizzleEmailOtpChallenges.ts`, `PostgreSqlDrizzleEmailOtpDeliveryJobs.ts`, `PostgreSqlDrizzleEmailOtpDeliveryAuthority.ts`; `src/server/email-otp/EmailOtpDeliveryJob.ts`, `EmailOtpDeliveryHandler.ts`, `EmailOtpDeliveryProtection.ts`; `src/server/node/NodeEmailOtpDeliveryProtection.ts`                                    | Challenge/receipt authority and existing protection binding stay auth-owned           |
| Schema                     | `src/server/drizzle-postgresql/schema/PostgreSqlAuthJobsTable.ts`, `PostgreSqlAuthJobPayloadsTable.ts`, `PostgreSqlRegistrationTables.ts`, `PostgreSqlEmailOtpTables.ts`, `PostgreSqlDrizzleSchema.ts`; `PostgreSqlDrizzleMapping.ts`, `PostgreSqlDrizzleRegistrationMapping.ts`; `src/server/postgresql/PostgreSqlSchemaImplementation.ts` | D7 generic two-table declarations; app runs DDL; no legacy migration obligation       |
| Cleanup                    | `src/server/postgresql/PostgreSqlAuthJobCleanup.ts` used by store                                                                                                                                                                                                                                                                           | Auth-owned registration/OTP coordination remains separate from generic cleanup        |
| Reference composition      | `examples/node-postgresql/Services.ts`, `Worker.ts`, `DeliverySink.ts`, `run.mjs`                                                                                                                                                                                                                                                           | Application explicitly starts polling/maintenance, supplies handlers and pool         |

Direct source/example use inventory was obtained with:

```sh
grep -rlE 'jobs/|JobQueue|AuthJobs|JobPayloadCodec|PostgreSqlDrizzleJobProducer|PostgreSqlDrizzleJobs' \
  src fixtures examples --include='*.ts' --include='*.mjs' | sort
```

Besides rows above, this inventory includes `AuthJobsWorkerDispatch.ts`,
`AuthJobData.ts`, `AuthJobs.ts`, `AuthJobsTelemetry.ts`, `JobPayloadCodec.ts`,
`JobQueue.ts`, `JobWorkerRuntime.ts`, and `PollingAuthJobsWorker.ts` themselves.
`JobWorker.ts` is a focused re-export. Indirect public facades include
`PostgreSqlRegistration.ts`, `PostgreSqlApplicationRegistration.ts`,
`PostgreSqlPasswordChange.ts`, `PostgreSqlSession.ts`, `PostgreSqlPasswordSession.ts`,
and `PostgreSqlEmailOtpDelivery.ts`. Package exports, type fixtures, packed templates,
schema readiness validation and migrations are integration-sensitive shared files,
not isolated leaf extraction work.

## Observed behavior versus accepted target

These are source observations, not claims of real-database verification.

- The existing definition's payload Schema covers the full claimed envelope.
  Enqueue results have no job ID. Producers supply job/event IDs. D2/D3 instead
  separate domain payload and library envelope, generate job ID, and return it for
  Inserted/AlreadyPresent. Producer declaration fixes operation and typed slots.
- Existing producer uniqueness/readback locates job ID **or** operation kind /
  operation ID / consequence slot, then compares canonical semantic bytes of the
  prepared full artifact. D3 instead compares catalog/payload/fingerprints, excludes
  generated IDs, policy and initial availability, and retains first configuration.
  Omitted initial availability uses DB time. No mutation of a matching stored job.
- Parent insert uses conflict-do-nothing; payload insert is required in the same
  supplied transaction. A conflict/readback mismatch is an Effect failure; outer
  domain adapters must not swallow it and commit partial domain/audit/receipt work.
  Inner success is provisional until outer COMMIT.
- Transaction joining is keyed by **connection-source object identity**, not URL.
  Same-source joining avoids another transaction and disables local replay/
  reconciliation. Generic D6 bridges must be scoped and qualified; one-argument
  enqueue, savepoint wrappers merely to enqueue, and a second engine are excluded.
- Current stored states are Pending, Active, RetryScheduled, Completed, Dead and
  Isolated. OutcomeUnknown is not a stored state. At-least-once execution requires
  application idempotency; timeout or lost response does not prove rollback.
- PostgreSQL uses `clock_timestamp()` milliseconds, SKIP LOCKED claim candidates,
  supported-catalog filtering, and persisted eligibility. Owned writes match job
  ID, token, lifecycle version, Active state, and unexpired storage-time lease.
  Claim reserves attempt timeout plus operation-response budget. Leases are fixed,
  not renewed; no connection/lock is held for handler I/O.
- Claim response loss is reconciled using the original caller token. Insufficient
  lease releases before execution without counters. Unknown finalization is read
  once; StillOwned can repeat only the identical finalization once, never handler
  execution. Unresolved ownership eventually uses fenced expiry/recovery.
- Finalization increments attempts atomically; FixedDelayV1 retry persists future
  availability. Recovery is separate and bounded; each expiry increments stalls
  and clears ownership. Zero stall budget dies on first expiry; one permits one
  recovery. Preparation/decode is inside the attempt timeout boundary.
- Codec currently allows only safe integers and uses `localeCompare` for keys.
  It projects protected fields by Schema path/fingerprint but does not traverse
  Union branches correctly. Probe: same-fingerprint different ciphertext under a
  Union produced **different** projections; `1.5` encoding failed. D5 requires
  finite fractions, locale-independent ordering, correct supported Union mapping,
  explicit app protection, separate encryption/fingerprint keys, no new generic AAD.
  Bounds remain 64 KiB payload and projection, depth 32, 16 protected subtrees,
  256 UTF-8 bytes per path. UPVE-848 owns regression implementation, not this task.
- OTP handler explicitly opens protected delivery data, checks current challenge
  authority, suppresses stale delivery, and maps provider retry/reject responses.
  Its existing context binding is not authorization to add generic AAD or remove
  the consumer binding.
- Existing cleanup is one bounded SQL statement: terminal eligibility, expired
  registration receipts and jobs; OTP issue receipts also protect jobs when naming
  enables OTP. Payloads cascade from parents. This is prior art, not proof of D8
  lock-order/race qualification. Generic cleanup cannot bypass domain references;
  Pending/Active/Isolated are never automatic deletion candidates. No generic holds.
- Jobs currently contains only an Effect 4 scaffold (`src/index.ts`, two test files),
  not an extracted backend or neutral consumer API. Auth pins Effect RC.115;
  copied APIs need adaptation to installed stable Effect 4.0.0 source.

## Golden cases and evidence locations

| Required case                                                            | Existing evidence to preserve / rerun                                                                                                              |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain/audit/two notification jobs/receipt atomicity and payload failure | `tests/postgresql/registration.test.mjs`, `application-registration.test.mjs`, `transaction.test.mjs`; core registration storage/transaction tests |
| Matching duplicate including Completed; conflicting duplicate rollback   | Registration and OTP PostgreSQL suites; `tests/core/JobQueue.test.ts`, `JobPayloadCodec.test.ts` source suites and core registration storage tests |
| Claim competition, unsupported versions, DB-time due checks              | `tests/postgresql/auth-jobs.test.mjs` concurrent stores and supported-catalog cases                                                                |
| Expired/token/version fencing and exact counters                         | Same suite: terminal-outcome fencing, zero/one-stall and bounded concurrent recovery cases                                                         |
| Claim/release/finalization response loss                                 | Same suite: deterministic commit-fault proxy, original-token reconciliation, response-budget boundary and later-owner rejection                    |
| Persisted retry, local timeout, release boundary, bounded drain/polling  | `tests/core/auth-jobs-worker.test.mjs`, `auth-jobs-fault-harness.test.mjs`, `polling-auth-jobs-worker.test.mjs`; `tests/core/JobWorker.test.ts`    |
| Cleanup/reference expiry, exact batches and payload cascade              | Auth-jobs and OTP PostgreSQL suites; `tests/core/postgresql-auth-jobs-sql.test.mjs` checks SQL shape only                                          |
| Public artifact/import inertness, optional peers and Node/Bun            | `scripts/check-packed-package.mjs`, `tests/packed/postgresql-jobs-runtime.template.mjs`; source/graph tests are not replacements                   |

Real PostgreSQL tests explicitly fail without `EFFECT_AUTH_TEST_POSTGRES_URL`;
packed script reports the PG section skipped when absent. Never label either
condition green PG qualification. Fixtures create/drop their own schemas: run only
with an owner-approved disposable test service and reviewed fixture permissions,
never a production URL or invented credentials.

## Commands and results

Host: Node `v24.15.0`, Bun `1.4.2`. Jobs pins Bun 1.4.2 and Effect 4.0.0;
auth pins Bun 1.4.1 and Effect `4.0.0-rc.115`. Auth evidence used available Bun
1.4.2, so it is not exact-pinned-Bun qualification. All calls ran foreground.

Jobs workspace:

```sh
bun install --frozen-lockfile
bun run verify
```

Passed: check, lint, format, build, 2 test files / 9 tests. This qualifies the
scaffold only. No generic PostgreSQL backend exists at this base.

Detached auth test workspace, ordered recipe (build **before** core tests):

```sh
bun install --frozen-lockfile
bun run toolchain:setup
bun run check
bun run test:source
bun run build
bun run test:node
npm pack --ignore-scripts --pack-destination .
bun run pack:check -- effect-auth-core-0.2.0-alpha.0.tgz
```

| Command                                                  | Observed result                                                                                                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install/setup                                            | Passed, separate dependency trees; no lockfile change                                                                                                                         |
| Auth check                                               | Passed, includes source/declarations/Drizzle/ai-docs/positive-negative types/options/Effect diagnostics; suggestions emitted, no errors/warnings in strict diagnostic summary |
| Source                                                   | 18 files, 109 tests passed                                                                                                                                                    |
| Build                                                    | Passed, root and workspace packages                                                                                                                                           |
| First core attempt concurrent with build                 | Failed with ERR_MODULE_NOT_FOUND for not-yet-built dist; invalid ordering, not a source regression                                                                            |
| Core rerun after completed build                         | 458 tests: 457 passed, 1 skipped, 0 failed; skipped installed-artifact public-reader case is not counted as passed                                                            |
| Auth pack / pack check                                   | Passed non-service checks on Node 24.15.0 and Bun 1.4.2; 663 archive files; PG and Redis runtime sections explicitly skipped                                                  |
| Real PG                                                  | **NotTested**: `EFFECT_AUTH_TEST_POSTGRES_URL` absent; no DB was created, reset, or contacted                                                                                 |
| Packed PG producer/worker/retry/recovery/cleanup         | **NotTested**, same missing service; non-PG pack success is not queue qualification                                                                                           |
| Node 22, exact auth Bun 1.4.1, Cloudflare local/deployed | **NotTested**, not covered by this host/run                                                                                                                                   |

Auth tarball SHA-512:
`3871348a8449723ea1ce6f1dee93479020e5479e3b72aef46a09668bfc002ce27bc8be65df29c00a9b168347df084cf44d63f4a603ec7cfab3d88d0bb926e6ee`.
Pack script exercises isolated installed consumers rather than source aliases.

The codec probes are reproducible without creating source files. In the auth
workspace execute this with `bun -e '<code below>'` (the async calls are tooling
boundaries, not library implementation):

```ts
import { Effect, Schema } from "effect"
import { JobPayload } from "./src/server/jobs/JobQueue.ts"
import { encodeJobPayload } from "./src/server/jobs/JobPayloadCodec.ts"
const protectedValue = JobPayload.encrypted(
  Schema.Struct({ ciphertext: Schema.String, fingerprint: Schema.String })
)
const schema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("a"), secret: protectedValue }),
  Schema.Struct({ kind: Schema.Literal("b"), value: Schema.String })
])
const a = await Effect.runPromise(
  encodeJobPayload(schema, {
    kind: "a",
    secret: { ciphertext: "one", fingerprint: "stable" }
  })
)
const b = await Effect.runPromise(
  encodeJobPayload(schema, {
    kind: "a",
    secret: { ciphertext: "two", fingerprint: "stable" }
  })
)
console.log(
  Buffer.from(a.semanticProjectionBytes).equals(Buffer.from(b.semanticProjectionBytes))
) // observed false; D5 expects true
console.log(
  (
    await Effect.runPromiseExit(
      encodeJobPayload(Schema.Struct({ value: Schema.Number }), { value: 1.5 })
    )
  )._tag
) // observed Failure; D5 expects Success
```

Relevant source: `JobPayloadCodec.ts:55–58` (integer restriction),
`:125–187` (projection with no Union dispatch). This is baseline fault evidence,
not a regression repair or a new review round.

Future authorized real-service recipe after build:

```sh
# Supply approved disposable-service configuration without printing credentials.
node --test tests/postgresql/auth-jobs.test.mjs tests/postgresql/registration.test.mjs \
  tests/postgresql/email-otp-challenges.test.mjs tests/postgresql/transaction.test.mjs
bun run pack:check -- effect-auth-core-0.2.0-alpha.0.tgz
```

For later jobs consumption, build jobs, use
`npm pack --ignore-scripts --pack-destination <isolated-artifact-directory>`, then
install the exact tarball and exact Effect peer into a separate consumer with
`npm install --ignore-scripts <absolute-tarball-path> effect@4.0.0`.
Run public imports under Node and Bun with optional backend peers absent, then a
second consumer with qualified peers and real PG. In an isolated auth integration
workspace use the tarball as the dependency, not a source alias, shared install,
or private deep import. No such dependency edit is authorized in E0. Existing
`sideEffects: false` is metadata, not evidence: importing core/backend and composing
ordinary Layers must start no fiber, pool, DDL, environment read, or maintenance.

## Complete ai-docs read manifest

Every path below was read in full **in both pinned workspaces**, including all
examples and configuration. The two manifests are identical; no file was omitted.

```text
ai-docs/README.md
ai-docs/src/index.md
ai-docs/tsconfig.json
ai-docs/src/01_services/10_services-and-layers.ts
ai-docs/src/01_services/20_module-consumption.ts
ai-docs/src/01_services/30_layer-composition.ts
ai-docs/src/02_modeling/10_schema-tagged-match.ts
ai-docs/src/03_errors/10_errors-and-causes.ts
ai-docs/src/04_observability/10_operation-observability.ts
ai-docs/src/05_resources/10_resources-interruption-secrets.ts
ai-docs/src/06_persistence/10_mutation-boundaries.ts
ai-docs/src/07_transport/10_wire-errors.ts
ai-docs/src/08_style/10_visible-code-and-modules.ts
ai-docs/src/09_testing/10_testing-and-review.ts
ai-docs/src/10_boundaries/10_external-time-regex.ts
ai-docs/src/fixtures/Auth.ts
```

Also read: issue UPVE-847 and its only comment thread, epic UPVE-846,
jobs `specs/architecture-decisions.md`, both package manifests, auth
`specs/auth-jobs-implementation-qualification.md`, full `JobQueue.ts`,
`JobPayloadCodec.ts`, `AuthJobsWorker.ts`, `JobWorkerRuntime.ts`,
`PostgreSqlAuthJobs.ts`, `PostgreSqlAuthJobCleanup.ts`,
`PostgreSqlDrizzleJobProducer.ts`, `PostgreSqlDrizzleJobs.ts`, and
`EmailOtpDeliveryHandler.ts`; transaction/type/test/pack files were inspected
in focused sections and searches, not claimed as complete reads.
No tracked AGENTS.md was found in either assigned
workspace; runtime dispatch and user-level Conventional Commits instructions
were applied. The inherited auth-oriented ai-docs are guidance, not evidence that
auth internals exist in jobs or that RC snippets implement stable APIs.

## Handoff gates

The documentation commit's exact head/tree are reported in Multica (avoiding a
self-referential commit hash in this file). Immutable review input is jobs base
above through that local documentation head, with this file as the only owned
change. One blind first review round and critical triage remain required; this
implementor does not delegate or self-review. No merge or later-stage activation
is implied. Real-service and runtime gaps remain explicit NotTested blockers for
qualification, not permission to weaken them or claim implementation done.
