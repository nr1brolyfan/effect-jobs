# Library use findings from the local integration

This integration reproduced no new library runtime defect. It composes the
qualified public library APIs with application-owned PostgreSQL authority,
receipts, read models, synthetic providers and local Cloudflare coordination.
It does not turn a local workerd result into a hosted Cloudflare support claim.

1. Native enqueue remains tied to the exact configured PgClient transaction.
   Real HTTP command admission, job/payload production, associations and the exact
   receipt compose through the application transaction. Repeating the same
   request returns the retained receipt/job IDs. Receipt absence does not permit
   replay after an uncertain result.
2. A successful enqueue acknowledgement and a persisted Completed row are
   different facts. The UI reads library lifecycle fields and persisted policy;
   it does not infer handler success from command acknowledgement. Unknown
   attempts remain Active until fenced recovery. The synthetic provider ledger
   proves its own idempotent acceptance, not exactly-once external execution.
3. The application owns alarms and event lifetime. Four fixed DOs drain four
   queues with the real six-handler catalog, a native client scoped to each event
   and database-time authority. Backend readiness, acquisition and queries add
   measurable cost; the local backlog receipt reports query calls/time and
   observed callback/activation counts without inventing hosted cost estimates.
4. Protected jobs need stable application key configuration across event scopes.
   Real private export handlers work across separate HTTP and queue events. The
   list/detail read model selects allowlisted jobs/association metadata and never
   reads or decodes `job_payloads`. This is an application read model, not a new
   library admin API or selective-decryption capability.
5. Reset changes application generation, visibility and admission. It preserves
   old jobs and retained quota. An active viewer in another sandbox can keep the
   globally shared queues alive and allow previously admitted unattended work to
   finish; zero viewers retires all four queues. Describe resumes all four.
6. Keyset pages are live reads. A retained cursor remains scoped to sandbox,
   generation and filters; inserts and lifecycle changes between reads do not
   create a historical snapshot. The browser offers explicit first-page restart
   and retains filters during reconciliation.
7. Live messages are bounded invalidation hints. Ready, post-commit invalidation,
   reset reconnection and offline/online reconciliation are exercised in Chromium.
   Queue hint adapters compare bounded count/lifecycle-version signatures, so an
   idle wake does not continuously trigger another describe/kick cycle. Periodic
   authoritative reads remain necessary when a hint is lost.

The published library dependency inventory, exports and packed bytes are
unchanged. Private app dependencies include PgClient 4.0.0 and local qualification
tools only. There is no supported retry/redrive/cancel command here. Application
terminal cleanup is absent/deferred because associations/receipts require an
application-owned retention adapter; no broad deletion or lifecycle SQL bypass
was added.

The attached exact-input receipts are the qualification result. Hosted CF,
Alchemy, crash/network faults, CPU usage, arbitrary real providers and a full
remote push preflight remain NotTested or outside this local scope. Inherited
repository lint warnings were not represented as fixed by focused integration
checks. Historical prerequisite reviews/triages and accepted fixes were consumed
without repetition; only the new integration bytes await their first review.
