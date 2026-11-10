# Guarded application commands

`GuardedScenarios.layerNoDeps` combines persisted `SandboxAuthority` and
`CommandPersistence`. The native application composition provides both. Each
command checks credential-derived sandbox identity, DB-time expiry and current
generation. Receipt reconciliation may read an earlier generation of the same
live authenticated sandbox; it never grants old-generation write authority.

`Persistence.layerNoDeps` uses `CommandTransactions`, configured public
`JobEnqueue` and stable application `DocumentKeys`. Enqueue, association, quota,
audit and receipt writes share one application-owned native transaction. Success
means acknowledged COMMIT. A separately committed first-admission journal fences
uncertain submissions: receipt absence never creates a new write permission.
Unknown outcomes retain the exact request identity and permit read-only lookup.

Reset increments application generation and retains jobs, associations, payloads,
quotas and old receipts. It cannot stop an executing handler or undo prior effects.
Provider execution has its own same-transaction authority/generation guard.

## Private operators

Credential-owned private routes expose POST `/api/jobs/operator` and POST
`/api/jobs/operator/receipt`. Transport strictly decodes the full immutable
command, requires same selected Origin and CSRF, bounds JSON/body consumption,
uses existing global/per-sandbox admission rates, and sanitizes wire failures.
Public/demo routes deny mutation; native persistence independently denies
persisted demo ownership even with caller-supplied capability hints.

`OperatorPersistence` calls the root `PostgreSqlJobs.Backend.operators` through
the same native client as `PostgreSqlOperatorTransactions`. The owner locks the
sandbox, then the scoped source, before the library call. Library lifecycle,
receipt, audit, quota and redrive lineage changes commit atomically. DB-time expiry
is checked after lock waits/decoding and again before COMMIT. Library/provider
errors abort the transaction; safe pre-write rejections can persist exact rejection
receipts without changing a job. Hints and queue activation follow acknowledged
commit, never provisional transition results.

- Retry now strictly accelerates a future RetryScheduled job to database time,
  retaining its ID, first policy, attempts, stalls and immutable artifacts.
- Cancel supports Pending/RetryScheduled only and records honest Cancelled with
  a terminal timestamp and Forever retention. Active cancellation stays disabled.
- Redrive supports Dead or valid investigated Isolated artifacts. It requires
  explicit duplicate-effects confirmation, creates a new library ID and budget,
  keeps the original unchanged and persists restrictive scoped lineage.

The deterministic server producer includes sandbox/generation/request/source.
Unknown responses retain the immutable pending request. Only its exact receipt
lookup resolves acceptance; no implicit replay or new request ID is generated.
Ordinary detail/list reads never decode private payloads. See
`docs/playground-operators-integration.md` and `specs/operator-contract.md` for
composition, exclusions and local qualification commands.
