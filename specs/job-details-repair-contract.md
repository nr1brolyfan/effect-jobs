# Job details and repair contract

Frozen implementation contract for UPVE-2145 and its existing children. This is a
source audit and specification, not implemented API or runtime qualification.
Project: effect-jobs (`52ccc13e-4995-4a3f-be37-6f4cf6bebe3e`). Product decisions
come from the parent issue, D1–D8 in `architecture-decisions.md`, and
`operator-contract.md`. The canonical Multica workflow is UPVE-1020's
`multica-workflow.md` attachment; no review or implementation dispatch occurs here.

## Snapshot and authority

- Accepted base: `358299e638c01c73bde356acbff3c134f5ceaef2`.
- Accepted base tree: `91399ce26d48afa8d5d7d0b18bd3d9e3045d7730`.
- Audit branch: `docs/job-details-repair-contract`.
- Isolated worktree: `/home/pc/multica_workspaces/upventure-43a8c02fcc9d/upve-2146-c27ed7989947/worktree/contract-worktree`.
- Runtime checkout HEAD `32fc76f51bcf8a733a304963648b40dbb7b6f4bf` is NOT the base.
- Owner checkout `/home/pc/Code/opensource/effect-jobs-actionable-scenarios` is
  untouched. No private configuration, credentials or owner evidence was read.
- Only this specification is committed. The resulting head/tree and spec hash
  accompany the issue handoff; they cannot be embedded in their own commit.
- Local commits only. No push, PR, main merge, deployment, publication or preview
  switch is authorized. Stage 2 is the coordinator's responsibility.

## What exists at the base

| Boundary            | Existing capability and evidence                                                                                                                                   | Required extension                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Library operators   | `JobOperatorsService.retryNow`, `cancel`, `redrive`; `src/internal/postgresql/Operators.ts` locks and checks exact state/version, DB time, policy and artifacts    | Corrected payload production and durable generic lineage                |
| Production          | `JobDefinition.enqueue`, `enqueueStandalone`, `enqueueInTransaction`; `Producer.insertOrCompareAt` uses the globally unique producer tuple and semantic projection | Reuse insertion/comparison; compare operator lineage as well            |
| Transaction         | `PostgreSqlNative.make` resolves the configured client's exact `transactionService`; no connection-string identity inference                                       | Retain same-client ambient operation and provisional library result     |
| Storage             | Configurable schema/jobs/payload table names; SQL and optional pinned Drizzle declarations; readiness; payload FK cascades only that job's payload                 | Additive lineage columns/FK/checks; no successor cascade                |
| Application command | `OperatorPersistence`, `PostgreSqlOperatorTransactions`, immutable separately committed admission, atomic receipt/association/audit, sandbox then source lock      | Corrected request identity, problem resolution, explicit investigation  |
| Application lineage | `operator_redrives` stores source/successor/scoped receipt and source state/version; restrictive association FKs                                                   | Durable original identities plus nullable live references; redrive kind |
| Read                | `JobsRead.list/detail`, association-scoped SQL, strict DTO decoding, signed cursor, DB-time authority; no payload reads today                                      | Explicit detail projections, repair chain and resolution filters        |
| Execution evidence  | Current job snapshot; durable `provider_ledger` accepted/invocations; `command_audit` and exact operator receipts                                                  | Project retained facts; no new execution event subsystem                |
| Browser             | React, Effect Atom registry, StyleX, Base UI; selected job side panel, detail revisions, cursor history and stale-generation revocation                            | Accessible drawer/full page and return context; new isolated components |
| Encryption          | `PrivateDocument` AES-256-GCM/HMAC-SHA-256 envelope, application keys, codec format 1                                                                              | Browser compatibility adapter and separate known synthetic fixture      |
| Demo                | GET-only demo endpoints and persisted demo ownership checks; real producer/worker seed                                                                             | Internal trusted repair example, never public operator admission        |

Important limits: handler signature is `Effect<void, JobFailure, R>`. There is no
stored handler return value, created timestamp, per-attempt start/end record,
progress trace or complete failure history. `attemptsMade` counts confirmed fenced
finalizations; unknown outcomes can repeat an attempt number. `stalledCount` is
separate. The durable ledger counts provider invocations, not library attempts,
and has no event timestamps. `FakeProvider.inspect` deliberately returns no mock
observation for durable storage. Current Isolated state alone does not prove a
known outcome; unknown finalization/recovery may ultimately produce Dead too.

## Library API additions (UPVE-2147)

Keep `retryNow`, `cancel`, `JobOperatorExpected`, `JobRedriveRequest` and existing
error meanings. Add these names to `src/JobOperators.ts`; public registrars remain
serial-owner work:

```ts
type JobRedriveKind = "Redrive" | "CorrectedRedrive"
interface JobLineage {
  readonly originalSourceJobId: JobId // durable immediate source identity
  readonly sourceJobId: JobId | null // live FK to that same immediate source
  readonly kind: JobRedriveKind
}
interface JobCorrectedRedriveRequest<Payload> {
  readonly expected: JobOperatorExpected
  readonly producer: ProducerIdentity
  readonly payload: Payload // decoded definition Schema type
}
// Add required lineage: JobLineage to JobRedriveResult.
// correctedRedrive returns that same JobRedriveResult.
correctedRedrive<S extends Schema.Top>(
  definition: Pick<JobDefinition<S>, "catalog" | "payload">,
  request: JobCorrectedRedriveRequest<S["Type"]>
): Effect.Effect<
  JobRedriveResult,
  E | JobOperatorRejected | JobPayloadCodecError | JobIntegrityConflict,
  R | S["EncodingServices"] | S["DecodingServices"]
>
```

`JobRedriveResult` keeps `source`, `jobId`, `inserted`, `dbNow`. Its lineage records
creation evidence; later detail reads report the current nullable FK. Ordinary
jobs have no lineage (all three storage fields null), not an invented source.
No application reason, problem status, authentication or receipt service enters
core. Add `"lineage-conflict"` to `JobOperatorRejected.reason` for an existing
producer tuple whose operator source/kind differs or whose lineage is absent.
Such conflicting reuse must poison the transaction like `JobIntegrityConflict`;
it must not become a persisted safe rejection after partial writes.

Both redrive forms:

1. Resolve ambient transaction before decoding/encryption. Reject missing,
   foreign, inactive context with the existing `PostgreSqlInvalidHandle` path.
2. Lock source. Require exact `jobId`, state and lifecycle version, complete valid
   unowned Dead/Isolated snapshot, valid persisted policy, supported exact catalog
   and lease response reserve. Reject original producer tuple. No Active replay,
   budget reset or source lifecycle/payload mutation.
3. Plain `redrive` retains its existing complete canonical source artifact/schema
   validation and copies the exact encoded bytes and first policy.
4. `correctedRedrive` validates/encodes the replacement with `encodeJobPayload`,
   validates that encoded artifact with `decodeJobPayload`, and copies source
   policy. Fresh budget means zero attempts/stalls/version, new generated ID,
   Pending and DB-now availability, not changed retry/retention configuration.
   A malformed/missing old payload can be replaced if source metadata/policy and
   catalog are valid; it cannot be used for a diff or plain redrive. Invalid
   source metadata/policy cannot be repaired by this method. No catalog upgrade.
5. Snapshot mutable bytes before yielding. Sample final DB time after locks and
   validation. Insert job/payload/lineage in the same transaction.
6. Reuse global semantic deduplication. Matching tuple/catalog/projection AND
   original source/kind returns the existing successor. Live source FK must be
   null or match durable original ID; it is never reassigned on a duplicate.
   Wrong semantics use `JobIntegrityConflict`; wrong lineage uses the poisoned
   conflict above. Ordinary enqueue cannot silently become operator lineage.
7. Return provisional evidence only; outer application owns expiry checks,
   COMMIT, receipts and uncertainty. Never begin/commit/replay internally.

Core cannot establish whether an Isolated job's external effects occurred.
Application investigation and duplicate-effects confirmation are mandatory.
Do not add a generic capability service merely to duplicate this small matrix.

### Mapped storage and migrations

On configured jobs table add nullable `original_source_job_id text`,
`source_job_id text`, `redrive_kind text`. They represent the immediate edge, not
an inferred chain root. Required constraints:

- Either all three are null (ordinary job), or original ID/kind are nonnull and
  live source may be null; kind is `Redrive` or `CorrectedRedrive`.
- Original ID differs from child `id`; nonnull live source equals original ID.
- Live `source_job_id` references the SAME mapped jobs table's `id` with
  `ON DELETE SET NULL`. Never `ON DELETE CASCADE` for source-to-successor edges.
- Durable original ID has NO FK, survives source deletion unchanged, and is
  written together with the live FK on new operator insertion.

Expose `PostgreSqlSchema.lineageMigration(mapping = tables())`; update fresh
`migration`, Drizzle `makeJobTables` and readiness to agree. Fixed column names,
existing identifier validation and quoted `relations(mapping)` remain supported.
Add an index on nonnull source reference for bounded FK deletion/edge reads.
Readiness verifies columns, checks and actual SET NULL FK target/action; it never
runs DDL. Old schemas require explicit application migration, not silent fallback.
SQL-generated and Drizzle-generated mappings, custom namespace/table names and
63-byte identifier/index constraints need qualification. Keep worker snapshot
contract free of application fields and preserve existing producer behavior.

Library migration adds empty lineage to existing ordinary rows, without guessing
history. Serial app migration backfills existing `operator_redrives` only from
validated exact receipt/association edges (kind Redrive); invalid/ambiguous data
fails migration rather than inventing relationships. Source/child locks guard
retention races. Generic cleanup can remove an eligible source without deleting
its successor; app cleanup still owns restrictive domain references. Isolated
remains excluded from generic automatic cleanup.

## Application requests and mutation authority (UPVE-2150/2151)

Introduce focused `packages/playground-contracts/src/Repairs.ts` at serial
integration. Register POST `/api/jobs/repair`, `/api/jobs/repair/receipt`,
`/api/jobs/resolution`, `/api/jobs/resolution/receipt` respectively for execute,
receipt, resolve and resolutionReceipt. Demo exposes no mutation counterparts.
Application composition uses a nested `repairs: typeof Repairs.Service` field
(or provides the service directly), never spreads Repairs.execute/receipt over
existing Operators.execute/receipt. `Repairs.execute(access, JobRepairCommand)` and
`Repairs.receipt(access, JobRepairReceiptRequest)` use `PlaygroundError` and return
`JobRepairResult`; browser client names are `repair` and `repairReceipt`.
These names are distinct from existing operator methods, whose retry/cancel and
historical receipt format remain supported. New redrive submissions use Repairs
so they cannot bypass problem/investigation rules. The legacy operator redrive
write path rejects new admissions with investigation-required; existing exact
legacy receipts remain readable without replay. Library redrive itself is reused.

All command fields are required unless marked optional here. `Reason` is a
nonblank string of 1–512 characters, at most 1024 UTF-8 bytes; reject NUL. Reasons
are operator-entered audit data: synthetic context only, no secrets/raw errors.
Use existing `SandboxRef`, `RequestId`, `JobId`, `Counter`, `EpochMillis` bounds.
Strictly reject excess keys, including client producer, policy and authority.

```ts
type Investigation =
  | { _tag: "KnownFailure" }
  | { _tag: "ConfirmedNotApplied"; reason: Reason }
  | { _tag: "AcceptDuplicateRisk"; reason: Reason }
  | { _tag: "Unconfirmed" }
type JobRepairCommand = {
  sandbox: SandboxRef
  requestId: RequestId
  jobId: JobId
  expectedState: "Dead" | "Isolated"
  expectedLifecycleVersion: Counter
  expectedResolutionVersion: Counter // 0 for implicit Open
  reason: Reason
  confirmDuplicateEffects: true
  investigation: Investigation
} & ({ action: "redrive" } | { action: "corrected-redrive"; payload: JsonValue })
type JobRepairReceiptRequest = { sandbox: SandboxRef; requestId: RequestId }
type JobRepairResult =
  | {
      _tag: "Committed"
      sandbox: SandboxRef
      requestId: RequestId
      action: "redrive" | "corrected-redrive"
      sourceJobId: JobId
      sourceState: "Dead" | "Isolated"
      sourceLifecycleVersion: Counter
      resultJobId: JobId
      observedAt: EpochMillis
      problem: JobProblem
    }
  | {
      _tag: "Rejected"
      sandbox: SandboxRef
      requestId: RequestId
      jobId: JobId
      reason: JobRepairReason
    }
  | { _tag: "OutcomeUnknown"; sandbox: SandboxRef; requestId: RequestId }
```

`JobRepairReason` comprises existing `JobOperatorReason` plus
`invalid-payload`, `resolution-conflict`, `repair-in-progress`,
`already-resolved`, `request-conflict`, `encrypted-correction-unavailable`, and
`lineage-conflict`. Reuse existing HTTP `PublicErrorCode` status mapping for
transport/authority errors. Safe domain refusal is a Rejected DTO, HTTP 200.
Payload validation diagnostics expose allowlisted JSON paths and bounded rule
names only, never values, Schema parse inputs, SQL or crypto errors.

Local website correction supports the six synthetic catalogs' unprotected
`Definitions.Payload` shapes; the encrypted private-data-export correction editor
is disabled with `encrypted-correction-unavailable`. The generic library method
can encode protected/encrypted schemas with explicit app services. This browser
flow never submits decrypted documents or keys to do so. Unencrypted synthetic
payload editing is intentional; invariant/sandbox identity fields are fixed by
the server. Example repair changes synthetic `behavior: "dead"` to `"success"`;
plain redrive preserves behavior and may fail again. Validate exact selected
catalog/version, full replacement Schema and same sandbox/actor/tenant/order
invariants; no arbitrary job kind or producer namespace input.

`JsonValue` is bounded canonical JSON using codec limits (64 KiB, depth 32),
not an unbounded `Schema.Unknown` pass-through. Editor diff is computed from
retained validated source/replacement, explicit Added/Removed/Changed paths.
Encrypted fields never enter a plaintext diff. Server recomputes the validated
change; no client diff is durable authority. Diff is unavailable when source
bytes are absent/invalid. Persist reason, action, identities, changed paths and
validation outcome; do not store duplicated source plaintext or values in audit.

### Eligibility and uncertainty

| Source/evidence                                         | Redrive / corrected redrive                                                  | Automatic resolution                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------- |
| Known failure Dead                                      | Allowed after explicit reason + duplicate confirmation                       | Completed current successor can resolve |
| Investigated valid Isolated, effects known not applied  | Allowed with `ConfirmedNotApplied` reason + confirmation                     | Completed current successor can resolve |
| Isolated or Dead with uncertain/missing effect evidence | Only explicit `AcceptDuplicateRisk` with investigation reason + confirmation | Never solely from successor success     |
| Confirmed already applied                               | Close problem through explicit reconciliation; no suggested replay           | Operator reconciliation only            |
| Unconfirmed investigation                               | Reject `investigation-required`                                              | Never                                   |
| Pending/RetryScheduled/Active/Completed/Cancelled       | Repair refused; existing retry/cancel rules retained                         | No repair implication                   |

Server derives known failure only from allowlisted supported stored failure/provider
evidence: at this base a valid Dead snapshot with exact scoped durable synthetic
ledger `accepted=false` and `fake_provider_terminal_rejected` or
`fake_provider_retry_rejected` is known failure. Other evidence requires explicit
investigation; caller's `KnownFailure` assertion is insufficient. Isolated invariant
or invalid-artifact inspection still needs investigation. Lost outcome, recovery
exhaustion, absent/corrupt evidence and unsupported codes default to uncertainty.
Current accepted synthetic ledger evidence is separately labeled; it does not
prove real provider effects. A user investigation is recorded as an operator
assertion, not fabricated provider proof. For correction, only old payload
corruption may be replaced; corrupted lifecycle/policy still rejects.

### Same-client atomicity and idempotency

Reuse the native command protocol: separately acknowledged immutable first
admission, then one same-client native transaction for source/chain lock, core
operation, successor association, lineage, problem update, quota, audit and exact
receipt. Authenticated sandbox identity, current generation and DB-time expiry
are checked after lock waits/decoding and immediately before commit. Lock order:
sandbox, problem row, source, successor (stable IDs if more than one). No forked
operations inside one transaction. Existing scoped associations are authoritative.

Derive a server producer namespace `playground.repair`/slot `replacement`, hashing
sandbox/generation/request/source/action into bounded operation ID. Bind immutable
admission to the entire strict command, including expected versions, reason,
investigation, confirmation and canonical replacement payload. Use SHA-256
`commandDigest` for bounded durable admission identity and receipt matching;
canonicalize with the codec's JSON rules. Digest is not payload confidentiality.
Receipts store metadata/digest and acceptance/refusal, not replacement payload
again. Apply a finite 128 KiB HTTP body budget and decoded codec bounds before
admission; preserve deadlines, CSRF/origin/auth/rates. Do not widen old admission
constraints or rewrite old stored commands just to fit a replacement payload.

Same request/digest returns its exact committed historical receipt. Different
command under the same scoped request ID rejects `request-conflict`, creates no
job and cannot replace admission. Concurrent fresh requests serialize on the
chain; at most one in-flight repair is accepted. `AlreadyPresent` is acceptable
only with exact matching persisted lineage/admission; never infer provenance
from a matching producer alone. Integrity/lineage conflict aborts all writes.

Unknown admission/COMMIT stays OutcomeUnknown. Preserve full Cause including
mixed interruptions/defects; do not relabel timeout as rollback. After uncertainty
only exact read-only receipt lookup is allowed; missing receipt cannot authorize
replay or a replacement ID. The problem stays unresolved. Post-commit hints
activate workers/refresh reads only after acknowledged COMMIT.

## Application-only problem resolution

No new library state. Original remains Dead/Isolated, all global execution counts
continue to count actual rows. Define `JobResolutionState = "Open" | "InProgress"
| "Resolved"`; display InProgress as **In progress**.

```ts
interface JobProblem {
  rootJobId: JobId // durable first failed identity in scoped repair chain
  state: JobResolutionState
  version: Counter
  updatedAt: EpochMillis
  activeSuccessorJobId: JobId | null // durable selected identity, no deletion FK
  outcomeKnowledge: "KnownFailure" | "Unknown"
  resolution: null | {
    kind: "SuccessorCompleted" | "OperatorReconciled" | "ManualClose"
    reason: Reason | null // null only for SuccessorCompleted
    observedAt: EpochMillis
    successorJobId: JobId | null
  }
}
```

Use app `job_problems`, scoped primary key `(sandbox_id,generation,root_job_id)`;
root and active successor identities outlive job rows. No cascading job FK.
Repair associations include durable root ID; exact root is propagated under lock
from source membership. App `job_repair_members` has unique
`(sandbox_id,generation,job_id)` membership and root identity. One chain has ONE
problem row, not one problem for every Dead successor. A root with no row projects
implicit Open/version 0 using actual terminal snapshot timestamp; ordinary healthy
jobs have `problem: null`. First repair/close materializes that row atomically;
GET reads do not create audit or resolution rows. Scoped membership survives
source deletion. Migration validates/backfills existing recorded chains and rejects
cycles/foreign edges; ordinary preexisting terminal jobs project individual roots.

- Open -> InProgress only on committed new successor; record its identity and
  increment resolution version once. Source execution is unchanged.
- Current successor Pending/RetryScheduled/Active remains InProgress.
- Current successor Dead/Isolated/Cancelled reopens the SAME problem. Store an
  idempotent audited transition; preserve unknown knowledge when applicable.
- Completed current successor resolves only KnownFailure. Unknown knowledge
  stays Open and requires explicit operator reconciliation or manual close.
- Missing retained successor cannot imply success: reopen unresolved problem,
  report outcome unavailable. Known recorded resolution is retained if the
  successor is removed later. Do not delete problem evidence to avoid counts.
- Ignore stale earlier-successor results after a newer repair. Compare locked
  problem version/active identity and recorded observed lifecycle version;
  terminal reconciliation runs once, cannot overwrite ManualClose/Resolved,
  and does not increment version again on identical repeated observations.
- Refuse another repair while InProgress or Resolved. After a successor fails,
  a new explicit command may repair that successor within the same root chain.
  Require the current retained terminal chain tip as source, not an earlier failed
  ancestor, so a stale root command cannot create parallel remediation branches.
- Manual closure never changes job lifecycle or pretends execution succeeded.
  No automatic reopen of a manually closed chain from a late worker hint.

Introduce `JobResolutionCommand` with required `sandbox`, `requestId`, `rootJobId`,
`expectedResolutionVersion`, `reason`, and action `"reconcile-applied"` or
`"manual-close"`. `Repairs.resolve` and `resolutionReceipt` use the same admission/
receipt/authority protocol; `JobResolutionResult` has Committed
`{sandbox,requestId,problem,observedAt}`, Rejected
`{sandbox,requestId,rootJobId,reason: JobRepairReason}`, or OutcomeUnknown
`{sandbox,requestId}`. Record explicit investigation disposition, reason, scope,
trusted synthetic operator category, version and DB time. No invented actor ID.
The command has optional `confirmUnknownOutcome: true` (literal true, no false
variant); ManualClose requires it when locked knowledge is Unknown. This
acknowledges possible unresolved external effects.
`reconcile-applied` records operator assertion of applied effect with reason; it
never rewrites provider ledger. No generic ticket system or extra KMS service.

Implement bounded `RepairReconciliation.run({ limit: 50 })` inside the existing
serialized executor after drain and before hints; finite queries and native
transactions, no detached fiber/timer. It inspects persisted current successors
and failures in their real scope, with expiry/generation rules. It may materialize
problem evidence as app maintenance, never run a handler or write lifecycle.
A focused repair/resolve command also reconciles its locked chain before applying
expected resolution version. Reads project effective state from current stored
snapshot plus problem evidence, so delayed/missed hints do not display success
from stale status; explicit command refresh detects any resulting version conflict.

### Counts, filters and paging

Extend `JobFilters` with optional `resolution: JobResolutionState` and optional
`needsAttention: true`. Default list remains all actual jobs. Resolution filters
list one representative per problem chain: current retained repair tip, otherwise
retained root; never multiply one problem by number of failed members. Needs
attention means Open or InProgress, counts unresolved problems, and explains that
semantics in UI. Deleted representatives use a retained member if available;
problem-only tombstones remain counted and appear as an explicit unavailable-job
problem row through the problem view, not a fabricated JobSummary. Define
`JobProblemRow {problem:JobProblem, representative:JobSummary|null}` and
`JobProblemPage {sandbox:SandboxRef, items:JobProblemRow[], nextCursor:Cursor|null,
filteredTotal:Counter, stats:JobStats, attentionStats:JobAttentionStats}` (max 50
items) for that view; `JobsRead.problems(access, ListJobs)` supplies it. Ordinary `JobPage`
continues actual-job items; do not inject tombstones into its schema.

Define `JobAttentionStats = { Open: Counter; InProgress: Counter; Resolved: Counter;
needsAttention: Counter }` and add required `attentionStats: JobAttentionStats` to ordinary JobPage and JobProblemPage;
needsAttention = Open + InProgress. All counts scoped to authenticated sandbox /
generation, computed from the same statement snapshot. Global `JobStats` remain
all retained actual lifecycle rows with total equal to their sum, independent of
state/kind/resolution filters. Root/current-representative kind/state filters and
resolution filters compose before problem pagination/counting; document that a
chain's representative supplies kind/state, null representatives match only
unfiltered kind/state. `filteredTotal` is matching rows before cursor predicate.

Maintain default 25/max 50 and ascending ID `COLLATE "C"` keyset for ordinary jobs.
Problem view orders by rootJobId with the same collation; signed cursor version 2
binds view (`jobs`/`problems`), sandbox/generation, all filters and after identity.
No cursor accepted across views/filters/scope. A request with resolution or
needsAttention uses the problem view; `JobsRead.list` rejects those filters to
prevent ambiguous item types. Add GET `/api/jobs/problems` and
`/api/demo/jobs/problems`; allowlist new query keys strictly. Old v1 cursors may
remain accepted only for old job filters; otherwise reset to first page. Counts
are live, not snapshot guarantees. Preserve bounded cursor repair when rows move;
no arbitrary page-number SQL or duplicate rows from lineage joins.

## Details DTO and truthful retained evidence

Keep `JobDetailRequest {sandbox,jobId}` and `JobsRead.detail`. Extend JobDetail
with required fields below; serial contracts owner registers strict Schemas.
Nullable means required null, not an omitted pretend value. Existing `job`,
`producer`, `policy`, `relations`, optional genuine `observation` remain; no mock
observation inferred from state.

| Field/type                     | Required shape and privacy                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `createdAt`                    | `null` at this base; availability/update time is not creation                             |
| `payload: JobPayloadView`      | See union below; detail only, never list/stat/live hint                                   |
| `result`                       | `{ _tag: "Unavailable", reason: "not-stored" }`; no void-success JSON result              |
| `history: JobHistory`          | `{ coverage: "RetainedFacts", attempts: null, items: JobHistoryItem[], nextCursor: Cursor | null }`; real audit facts only                                                                                                    |
| `provider: JobProviderEvidence | null`                                                                                     | `{source:"synthetic-postgresql", accepted:boolean, invocations:Counter, observedAt:null}` from exact scoped ledger; no signatures |
| `lineage: JobLineage           | null`                                                                                     | Durable original identity plus current live FK; absent for ordinary jobs                                                          |
| `problem: JobProblem           | null`                                                                                     | Chain-effective application resolution, independent of job state                                                                  |
| `related: JobRelatedPage`      | Up to 50 scoped `{jobId,state:JobState                                                    | null,kind:JobRedriveKind                                                                                                          | null,sourceAvailable:boolean}` and nextCursor; state null if gone |
| `eligibility`                  | `{redrive,correctedRedrive}` each `{enabled:boolean,reason:JobRepairReason                | null}`; server result, rechecked at command                                                                                       |

`JobPayloadView` union:

- `Available {formatVersion:1, catalog:CatalogIdentity, encoded:JsonValue,
validation:"Valid", encryption:"None"|"PrivateDocumentV1"|"SyntheticDocumentV1"}`.
- `Unavailable {reason:"not-stored"|"invalid-artifact"|"unsupported-catalog"}`.

Only supported allowlisted synthetic schema wire data is exposed. Never blindly
return raw blobs, projection bytes, lease tokens, credential hashes, cursor keys,
provider signatures, SQL or errors. Encoded encrypted envelope contains ciphertext
and its fingerprint solely in this explicit detail projection; authenticated
browser verification needs it. Do not include the semantic projection separately.
`validation: Valid` for encryption means validated wire/schema shape, NOT decrypted
plaintext or verified authentication. UI separately displays locked/unverified
until browser authentication succeeds. Existing private document envelope does not
require server decryption for a read. Unsupported/corrupt bytes return bounded
Unavailable with no data echo. Return cache-control no-store for all detail APIs.

`JobHistoryItem` is a strict union:

- `Snapshot {job:JobSummary, observedAt:EpochMillis}`: current snapshot, labeled
  current state, not a historical transition.
- `Operator {requestId,action,sourceJobId,resultJobId,observedAt}`: exact committed
  retained retry/cancel/redrive/corrected repair receipt.
- `Resolution {rootJobId,state,kind,reason:Reason|null,observedAt}`: recorded app audit.

No expansion of attemptsMade into fake attempt rows. No invented timestamps for
provider invocations or source deletion. Only actual scoped receipts/audit may be
shown. Missing older facts display incomplete retained history. First detail page
contains at most 50 facts; additional `JobsRead.history` and `related` take
`{sandbox,jobId,cursor?:Cursor,limit:1..50}`. Signed purpose-specific cursors bind
scope/job and stable identity. GET detail subreads use
`/api/jobs/history` and `/api/jobs/related` (and matching `/api/demo/jobs/...`),
strict query fields sandboxId/generation/jobId/cursor/limit. `JobRelatedPage` is
`{items:JobRelatedItem[],nextCursor:Cursor|null}`; `JobHistory` is the same
coverage/attempts/items/nextCursor shape on every page. Audit storage needs a stable app audit identity for
new resolution/repair facts: key `(sandbox_id,generation,request_id,action)`;
maintenance uses `(root_job_id,successor_job_id,observed_lifecycle_version)` as
its unique reconciliation key. Historical audit without
a stable row key can be aggregated honestly or projected from exact receipts,
never deduplicated by a fabricated timestamp order. Timeline uses stable actual
receipt key and DB time for ordering; ties use request identity. Bounded related
chain queries use stored root membership, no unbounded recursive traversal.
Deleted source label uses `originalSourceJobId`; a live FK null is “source no
longer retained”. Source payload diff/result/history are unavailable when gone.

## Browser encryption and fixture boundary (UPVE-2149)

Current `PrivateDocument` encoded form is exactly
`{ nonce:number[12], ciphertext:number[], fingerprint:string[64] }`:
byte values 0..255, canonical lowercase hex fingerprint, ciphertext at least a
16-byte GCM tag and at most 2048 bytes. AES-GCM uses 256-bit raw encryption key,
96-bit nonce, 128-bit tag and UTF-8 AAD `playground-private-document-v1`.
Separate 256-bit HMAC-SHA-256 fingerprint key authenticates canonical plaintext
`JSON.stringify({subject,tenant,note})`. Document Schema fixes synthetic subject,
allows demo tenants and note <=256 chars. GCM decrypt, UTF-8/JSON/strict Schema,
then constant-time HMAC verification (`crypto.subtle.verify`) are all required.
Fingerprint projection equality alone does not authenticate ciphertext.

Browser real-key support is only this explicit compatible envelope, with BOTH
keys supplied locally by the operator in volatile component memory, never server
configuration exposure. Raw key inputs must be 32 bytes each and distinct; use
nonextractable imported CryptoKeys. Wrong key/tamper/schema failure returns a
bounded `PayloadUnlockError {reason:"invalid-key"|"authentication-failed"|
"unsupported-envelope"|"unavailable"}`; no plaintext/crypto diagnostics. Other
production envelopes show unsupported, no generic KMS or guessed decryptor.
Existing random/configured server document keys are not obtainable by code 123.

Create isolated synthetic fixture helpers in
`packages/playground-contracts/src/SyntheticCryptoFixture.ts`:
`syntheticDocumentKeys`, `sealSyntheticDocument`, `openSyntheticDocument`.
Use an explicitly public fixed, separate demonstration key pair for SYNTHETIC
fixtures only, never Event.Config's private keys. Code `123` is a UI demonstration
unlock gate that performs real AES-GCM decrypt/HMAC verify; it is not a secure
password/key derivation design. Show “Synthetic demo; key material is public;
unlock code 123”. Wrong code stays locked. A separately tagged synthetic fixture
catalog/version (registered serially) uses the same compatible envelope and
fixture codec. Trusted seeding stores its real encoded encrypted payload and
worker uses its matching fixture decoder; browser decrypts those stored bytes,
not an unrelated illustration attached to an existing private job. Never reinterpret
existing ciphertext as synthetic or publish its server keys.

Decrypted plaintext and user-supplied real keys never enter shared Atom registry,
URL/history, local/session storage, caches, logs, telemetry or network requests.
Crypto component lifetime is the selected detail identity + mode + generation;
close, navigation, relock, pagehide, expiry and unmount clear buffers/references
and visible text. An in-flight decrypt completing after close cannot republish
plaintext. JavaScript/native copies cannot be promised perfectly zeroized.
Copy action copies encoded payload only; ordinary unencrypted synthetic JSON
remains copyable. Decrypted clipboard copy is disabled to keep unlocked plaintext out of persistent
external state. Browser does not transmit unlocked content for correction. Public fixture constant material is the explicit
synthetic exception to runtime key persistence, not a production key practice.

## UI and route integration (UPVE-2148/2151)

- List selection opens accessible quick drawer with overview, real counters,
  cause/next step, repair badges, and “Open full details”. Base UI dialog/focus
  behavior, Escape/Close focus restoration and narrow viewport access are tested.
- Full paths: `/jobs/:jobId` and `/demo/jobs/:jobId`, with expected generation in
  `?generation=...`. Direct load authenticates/obtains current sandbox then reads
  exact job; mismatched generation is stale, not silently a different job.
- Browser navigation adapter owns `popstate`/history and works with the existing
  Atom runtime. No competing router/state manager. Serial server/assets route
  owner serves the existing app shell on those paths; `/demo/jobs/...` must be
  recognized as demo by Client and Worker, not private bootstrap.
- Define `JobReturnContext {sandbox:SandboxRef, filters:JobFilters,
view:"jobs"|"problems", pageSize:number, pageNumber:number,
cursors:(Cursor|undefined)[], scrollY:number, selectedJobId:JobId|null}` in
  volatile existing registry/navigation state. URL includes shareable filter/view/
  generation metadata only. No payload/key/plaintext in return state.
- Opening full page preserves list filters/cursor page/scroll; Back/Close restores
  context after layout, without reset/flicker. Lost/generation-stale anchors use
  existing bounded first-page recovery with explanation and safe focus fallback.
  Direct links without return context fall back to same-mode list. Foreign
  return URLs are not followed. Related links preserve mode/scope and relock.
- Overview explains recorded failure code and next step without raw provider
  messages. Timeline distinguishes snapshot/counters/provider evidence/audit and
  unavailable full attempts. Metadata groups identity, catalog version, policy,
  scheduling and application relations; responsive main content has payload,
  retained evidence and related chain. Execution and resolution badges separate.
- Component interfaces: `JobDetailsPage`/`JobDetailsDrawer` take
  `{detail:JobDetail, now:number, onClose:()=>void, onOpenFull:()=>void,
onRelated:(jobId:JobId)=>void, payloadSlot:ReactNode, repairSlot:ReactNode}`.
  `JobPayloadPanel` takes `{detail:JobDetail, identityKey:string}`.
  `JobRepairPanel` takes `{detail:JobDetail, readOnly:boolean,
pending:JobRepairCommand|null, onSubmit:(command:JobRepairCommand)=>void,
onReceipt:()=>void, onResolve:(command:JobResolutionCommand)=>void}`.
  Integrator supplies request identity/state/scope; components do not own clients.

## Public/private enforcement and real showcase

`LOCAL_PRIVATE="true"` is trusted application configuration, not Host/origin/
header/query detection. It is the required enablement for LOCAL private `/jobs`,
private detail pages and ALL private sandbox/command/repair/resolution APIs.
With config absent/false deny private API/page admission server-side before
issuance or mutation; existing public `/api/demo*` GETs remain available. A
loopback alias by itself cannot enable private mode. CSRF/cookies/expiry/generation
checks remain required when local mode is enabled. Conceal unavailable private
routes as 404/not-found; demo mutations also fail server-side and create nothing.

A persisted `demo_owned` sandbox refuses ordinary public/private repair commands
even under spoofed capability hints or private cookies. Internal trusted seeding
uses a separate non-HTTP service capability, not a caller-selectable `trusted`
flag or temporarily disabled guard. It shares the repair transaction/core APIs,
quota, receipt, audit and problem rules, with actor category `SyntheticSeed`.
Integration creates a known-failure synthetic source through real enqueue/worker,
performs corrected redrive through that service, then observes actual successor
completion and audited resolution before publishing the showcase. Never SQL-write
states/counters, replay missing receipts, forge history/results or expose the
internal capability through routes. The seed consumes existing public retained
cap, paced traffic/rotation budgets; cap remains 20,000, cleanup at most 50 per
retired sandbox/event. No 24-hour soak or preview switch here.

### App retention integration

Additive app migration `playground-job-repairs-v6` is a proposal owned by UPVE-2150
and registered by UPVE-2151. Freeze historical v1–v5 SQL/checksums before updating
library fresh schema generation; v4 currently calls live `operatorMigration`, so
retain exact original bytes, not a recomputed changed generator result.

Extend recorded app edges with original source/successor IDs, nullable live source/
successor references, durable root ID, kind and reason; retain exact scoped receipt
reference while it is needed. Existing source ID becomes durable identity. Replace
restrictive live association source/successor FKs with nullable composite scoped
references using PostgreSQL `ON DELETE SET NULL (source_job_id)` / corresponding
successor column ONLY. Shared sandbox/generation columns stay nonnull; never plain
composite SET NULL that nulls scope. Named/numeric scoped IDs must still match
original identities when live. Migration can rename old source column to
`original_source_job_id`, add live source and backfill from actual associations;
do likewise for successor to preserve audit after either deletion. Unique durable
successor membership remains. All live references validate scope on writes.
Supported PostgreSQL baseline is 16.15; column-specific SET NULL requires actual
PG and mapped SQL qualification, not Drizzle syntax assumptions.

Library job FK references mapped jobs; app scoped FK references associations.
Both must update on coordinated removal, never delete a child job. Receipt/audit/
problem rows persist independently of source rows until app retention permits
their deletion. Extend `demo/Manager` cleanup in one transaction to release app
references/ledger eligible for retired synthetic sandbox, with the existing
lock order; do not call generic cleanup to bypass them. Source-deleted detail
retains identity and reason but never retained payload data by accident. Existing
private histories are not automatically purged by this feature. Only after a
retired synthetic sandbox has no remaining associated jobs may its bounded app
problem/membership/lineage/audit records, then receipts, then admissions, then
sandbox be removed in dependency order in that same controlled cleanup protocol.
Until then keep exact receipts and original identities. Never leave restrictive
receipt/audit FKs blocking demo rotation forever, and never erase current or
private evidence to make deletion succeed.

## Exclusive file ownership and handoff order

All new paths below are reservations; they need not exist at the base. Authors
must not create temporary duplicate shared contracts in the repository. Compile
fixtures may declare local test shapes until the serial contract registration.
Report shared registration requests as a finite handoff, not concurrent edits.

| Issue     | Exclusive files / interfaces                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UPVE-2146 | This spec only; frozen before dispatch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| UPVE-2147 | `src/JobOperators.ts`, `src/internal/postgresql/{Operators,Producer,Readiness,Rows}.ts`, `src/PostgreSqlSchema.ts`, `src/PostgreSqlDrizzleSchema.ts`; necessary backend composition internals in `src/PostgreSqlJobs.ts`; existing `tests/core/operators/*`, `tests/postgresql/operators/*`, `tests/types/operators.ts`, new corrected/lineage cases there and `tests/types/repair-operators.ts`; refinements to `specs/operator-contract.md`. No app files, index/export/package registrars                                                                                                                                                                                                                                                                                                                                                                                                                         |
| UPVE-2148 | New `apps/website/src/features/jobs/details/{JobDetailsPage,JobDetailsDrawer,JobOverview,JobTimeline,JobRelatedJobs}.tsx`, their `.stylex.ts`, `details/Navigation.ts`; new `apps/website/tests/ui/details/*`. Reserve payload/repair slots; no existing Dashboard/Atoms/Mount/Client/build/route edits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| UPVE-2149 | New `apps/website/src/features/jobs/payload/{JobPayloadPanel.tsx,JobPayloadPanel.stylex.ts,BrowserDocumentCrypto.ts}`, `packages/playground-contracts/src/SyntheticCryptoFixture.ts`, new `apps/website/tests/ui/payload/*` and `packages/playground-contracts/tests/SyntheticCryptoFixture.test.ts`. No manifest/exports/definition registrar edits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| UPVE-2150 | New `apps/playground-worker/src/persistence/commands/{RepairPersistence,RepairTransactions,RepairSource,RepairSchema}.ts`, `persistence/authority/PostgreSqlRepairTransactions.ts`, `execution/RepairReconciliation.ts`; new `apps/website/src/server/read/JobDetailsProjection.ts`, `server/commands/HttpRepairs.ts`; new `features/jobs/repair/{JobRepairPanel.tsx,JobRepairPanel.stylex.ts,PayloadDiff.ts}` and focused `tests/ui/repair/*`; new worker `tests/repairs/*`. Existing files exclusively available to this author: `apps/playground-worker/src/persistence/read/Queries.ts`, `apps/website/src/server/read/{PostgreSqlRead,HttpRead,CursorCodec}.ts`, `apps/playground-worker/src/persistence/commands/{OperatorPersistence,OperatorSource,OperatorTransactions}.ts`, `persistence/authority/PostgreSqlOperatorTransactions.ts`, `execution/Executor.ts`, `demo/Manager.ts`. No shared registrations |
| UPVE-2151 | Sole serial owner: `packages/playground-contracts/src/{Jobs,Repairs,Services,Operators,Sandbox}.ts` and shared fixtures/mock services; all package manifests/lockfiles/exports, `src/index.ts`; `persistence/MigrationRegistry.ts`, existing app schema registrars; `HandlerRegistry.ts`, scenario `Definitions/PrivateDocument/Handlers/Fixtures`, trusted seed module; `execution/{Event,Application}.ts`, `Worker.ts`, `demo/Http.ts`; website `features/jobs/{Atoms,Adapter,Runtime,Dashboard,Dashboard.stylex,Mount,OperatorControls,OperatorEligibility}.ts[x]`, `Client.ts`, `integration/HttpClient.ts`, `server/{Routes,Services,HttpApplication}.ts`, website/worker build/asset registrars and final integration harness                                                                                                                                                                                  |

The library author may refine the core contract details but must preserve these
shared interface names/semantics or report a concrete incompatibility before
others depend on it. UPVE-2150 publishes schema/contract/registration proposals;
UPVE-2151 implements shared declarations once and integrates the exact author
commits. Corrections to existing worker/read files stay with UPVE-2150 even if
found during integration; no conflicting parallel writer. UPVE-2151's actual seed
calls the UPVE-2150 trusted service and UPVE-2149 fixture. No author dispatches reviews.

Order: consume this frozen contract -> four existing disjoint stage-2 children
may work in parallel -> UPVE-2147 API handoff enables UPVE-2150 real execution
qualification -> all four exact commits feed UPVE-2151 serial declarations,
migrations, routing/Atoms/seeding and local qualification -> coordinator freezes
one integrated base/head/tree for three parallel independent blind reviews ->
one critical triage -> accepted original-author fixes -> original reproductions/
affected gates only. No second/delta/final review. Nothing in this spec activates
children or overrides owner acceptance/remote authorization.

## Finite gates and inherited limits

This audit ran no runtime tests, full matrix, PG provisioning or service restart.
It checks exact Git snapshot, source contracts and documentation; the only final
local gate is `git diff --check` and a spec-only commit inventory. Dependencies
are absent in this isolated worktree; no tool installs are needed for a Markdown
contract. That is not a library/application CI PASS.

Implementation handoffs require bounded relevant gates using pinned tools:
Bun 1.4.2, Node >=24.15.0 <25, Effect 4.0.0, Drizzle
1.0.0-rc.5-169397b, TypeScript 7.0.2, oxfmt 0.71.0, oxlint 1.86.0.
No `.github` workflow is tracked at the accepted base; root `package.json` scripts
and current qualification specs are the local gate inventory. No inherited receipt
is reused for changed inputs.

- Core: `bun run check`, `bun run lint`, `bun run format:check`, `bun run build`,
  `bun run test`, `bun run test:release-imports`, `bun run check:docs:api`; the
  public API delta also needs `bun run qualify:api:installed`,
  `bun run qualify:drizzle:native`, and mapped SQL/Drizzle lineage migration tests.
  `specs/release-qualification.md` further requires one immutable local pack and
  affected `qualify:docs:readme`, `qualify:release`, `qualify:drizzle:indexes`,
  `release:check` artifact guards for final library delivery; these are local
  qualification, not publication authorization.
- Playground: `bun run playground:check`, `bun run playground:lint`,
  `bun run playground:test`, `bun run playground:build`, scoped new suites,
  `bun run playground:qualify` when shared contracts change. Register all focused
  app suites explicitly: the existing playground:test script discovers ONLY
  packages/playground-contracts/tests.
- PG/installed: `bun run check:postgresql`, pinned actual PostgreSQL 16.15 Node/Bun
  operator tests and `bun run qualify:postgresql:installed`. Finite fresh owner-
  authorized resources, max 10-minute commands; no existing preview/config reads.
- Mandatory reproductions: same-client missing/foreign context before preparation;
  corrected canonical/schema rejection, immutable source and fresh successor;
  concurrent identical requests, conflicting payload/reason/source/kind reuse,
  rollback after lineage/association failure, lost COMMIT exact receipt lookup;
  valid/corrupt Dead/Isolated, uncertain evidence and manual closure; source deletion
  with live SET NULL/durable ID/no child cascade, mapped SQL+Drizzle readiness and
  unchanged v1–v5 checksums; one unresolved chain, competing repairs, stale successor
  completion, cancellation/failure/deletion, scope/filter/cursor/count consistency.
- Browser/workerd/real PG final slice: detail direct link/drawer/Back filter-page-
  scroll and focus, race/expiry/relock, stored synthetic fixture decrypt/wrong code/
  tamper/no persistence/transmission, validation/diff/corrected redrive, actual
  successor reconciliation and manual unknown close, unchanged retry/cancel/reset,
  public private-API rejection including spoofed Host/flags, both localhost and
  127.0.0.1 trusted local config, live refresh without flicker, truthful global
  execution counts and problem pagination. Use a finite NEW integration slice,
  not the entire historical Actionable matrix or a 24-hour soak.

Inherited documented limits in `apps/website/tests/ui/Integration.md`: historical
aggregate root/playground lint and whole-repo formatting failures, transitive
`skipLibCheck` accommodation and skipped PG tests in older receipts. They are
reported history, not reproduced or waived by this audit. `ai-docs` retains
effect-auth sample naming and references to absent auth modules; read as patterns,
not added effect-jobs dependency. Hosted production/crash/network/24-hour behavior
is unqualified. A later remote push still requires all current gates or an explicit
owner exception; no push is authorized here. No unresolved product decision is
required to start the frozen scope: missing evidence is explicitly unavailable.

## Documentation read record

All recursively tracked `ai-docs/` files were read, including examples/config:

- `ai-docs/README.md`
- `ai-docs/tsconfig.json`
- `ai-docs/src/index.md`
- `ai-docs/src/01_services/10_services-and-layers.ts`
- `ai-docs/src/01_services/20_module-consumption.ts`
- `ai-docs/src/01_services/30_layer-composition.ts`
- `ai-docs/src/02_modeling/10_schema-tagged-match.ts`
- `ai-docs/src/03_errors/10_errors-and-causes.ts`
- `ai-docs/src/04_observability/10_operation-observability.ts`
- `ai-docs/src/05_resources/10_resources-interruption-secrets.ts`
- `ai-docs/src/06_persistence/10_mutation-boundaries.ts`
- `ai-docs/src/07_transport/10_wire-errors.ts`
- `ai-docs/src/08_style/10_visible-code-and-modules.ts`
- `ai-docs/src/09_testing/10_testing-and-review.ts`
- `ai-docs/src/10_boundaries/10_external-time-regex.ts`
- `ai-docs/src/fixtures/Auth.ts`

Other governing reads: supplied runtime AGENTS.md (no additional tracked AGENTS.md
in the accepted tree), assigned issue and parent (both thread scans empty),
UPVE-1020 issue/thread scan and downloaded canonical workflow attachment;
`specs/architecture-decisions.md`, `specs/operator-contract.md`,
`specs/release-qualification.md`, `specs/drizzle-compatibility.md`, root/app/contract
package scripts and `.oxfmtrc.json`; `apps/website/src/server/read/README.md`,
`apps/website/src/server/commands/README.md`,
`apps/playground-worker/src/execution/README.md`,
`apps/playground-worker/src/demo/README.md`,
`apps/website/tests/ui/Integration.md`. Source evidence is the exact accepted
Git tree and the focused paths cited above, not owner configuration or historical
runtime receipts.
