# Jobs observability

Load [the short checklist](observability-checklist.md) with the complete source file
under assessment. Instrument an owned boundary, not every pure helper. Telemetry
is best-effort operational evidence; durable rows and application receipts remain
the authority. Imports and construction start no exporter, sampler or worker.

## Ownership and privacy

The library emits native Effect metrics, spans and annotated logs. The application
owns logger/tracer/exporter Layers, resources, sampling, transport limits, retention
and shutdown. It must sanitize its own driver/handler spans at their construction
boundary: an outer observer cannot remove an already ended child's exception.
Never persist traceparent or baggage in a payload to stitch execution together.

Jobs observers capture each invocation's original Exit locally, classify bounded
fields, finish their OWN span with Success(void), then restore that Exit outside
the span. Values, payloads, errors, Causes, identities, lease tokens, codes and
stacks are never passed to those terminal sinks. Native Effect SQL 4.1 creates its
transaction span inside the control wrapper. For transactions the native adapter
establishes, it forwards the host span with a protected end method; transaction
success/failure becomes `jobs.native.outcome=success|unknown`, and its end receives
Success(void). The real transaction retains its Fail/Die/Interrupt and cleanup
semantics. The host tracer is restored inside the callback so application-owned
spans retain their behavior. Native attributes/events supplied by the configured
client remain the application's policy responsibility. An ambient transaction
already established by the application, and arbitrary custom adapters, are outside
this protection. Do not infer a universal SQL/host redaction guarantee.

A custom synchronous logger/tracer/metric hook may itself defect. That remains a
real failure; observers do not silently fabricate success. Ordinary asynchronous
exporter transport failure is separate from the job/business outcome. Do not flush
or perform HTTP from a transaction, handler terminal callback or metric update.

## Signal and query contract

`effect_jobs_operation_total` is a monotonic count of entered operation boundaries;
`effect_jobs_operation_duration_millis` is an explicit-bucket histogram in **ms**
(OTLP unit `ms`). Elapsed time uses the Effect nanosecond clock; it is not DB time.
Both use only `jobs.operation`, `jobs.phase`, `jobs.outcome`, `jobs.result` and,
on failure, bounded `jobs.cause_kind` and `jobs.reason_count_bucket`. There are no
queue/job/producer/error labels. Each duration's metadata includes `unit=ms`.

All ambient `Metric.CurrentMetricAttributes` are excluded at each jobs update,
without altering the caller's context. Put approved finite deployment dimensions
such as environment/region/service in exporter **resource** attributes, configured
once at application assembly. Never copy all request context into resources.
This explicitly changes the former ambient-inheritance behavior. Per-request IDs,
raw paths, trace IDs and hashes of identities remain prohibited label dimensions.
Counts are independent of logger threshold and trace sampling; delivery is neither
durable nor exactly once.

| Unit / owner                 | Boundary / fields                                 | Meaning                                                                                                                            |
| ---------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| enqueue call / definition    | `enqueue`, `provisional`; Inserted/AlreadyPresent | Inside the application's transaction; not a committed job count                                                                    |
| standalone call / definition | `enqueue-standalone`, `committed`                 | Success follows the adapter's acknowledged commit; Unknown is not rollback                                                         |
| claim / worker               | `claim`, dispatch or reconciliation               | Empty/Claimed/Unknown; Owned/InsufficientLease/NotOwned/Unknown                                                                    |
| release / worker             | `release`, dispatch                               | Pre-execution release only; Applied is not queue-empty proof                                                                       |
| handler / execution          | `execute`, handler                                | Includes bounded artifact decode before invocation; success/retry/dead/isolate/unknown/failure/interrupted                         |
| attempt / execution          | `attempt`, protocol                               | One terminal measurement for every entered execution, including invalid ownership, unsupported artifacts, abandonment and deadline |
| finalization / worker        | `finalize`, finalization/reconciliation/protocol  | Separate write calls, reads and bounded protocol; `jobs.requested` on protocol span is intent, not persisted state                 |
| recovery / worker            | `recover-expired`, maintenance                    | Whole bounded recovery call, including count validation; invalid count is failure                                                  |
| drain / runtime              | `drain`, dispatch                                 | Idle/MoreWork/Backoff; includes scoped execution cleanup                                                                           |
| polling / polling owner      | `polling`, dispatch; `backoff`, maintenance       | Cycle/sleep, never a completed-job count                                                                                           |
| cleanup / PostgreSQL adapter | `cleanup`, committed                              | Bounded actual deletion after acknowledged commit                                                                                  |
| health / explicit reporter   | `health`, maintenance                             | Bounded read-only sample; no implicit schedule/dependency                                                                          |

`jobs.outcome` is success/failure/interrupted/unknown/timeout/retry/dead/isolate.
Only one validated expected Fail gets a domain classification. Mixed Cause remains
failure. All reasons and channels still reach the caller. An interrupted child
handler is not automatically a timeout: only the owning attempt deadline records
timeout, covering validation, handler and bounded finalization under the original
single budget. The attempt span records `jobs.attempt_phase` as validation, decode-and-handler
or finalization as those boundaries are entered; this is local phase context, not
a new deadline or an assertion about an interrupted provider outcome. Unconfirmed/abandoned execution remains Active for existing recovery.
An attempt's Complete/Retry/Dead/Isolate result describes acknowledged _requested_
finalization, not its policy-resolved state. The adapter can turn Retry into Dead.
`attemptNumber=attemptsMade+1` can repeat after Unknown and is neither invocation
count nor an external idempotency key. Health/telemetry performs no lifecycle replay.

| Additional name                          | OTLP unit / labels                                     | Interpretation                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `effect_jobs_transition_total`           | `1`; jobs.state=Completed/RetryScheduled/Dead/Isolated | Actual PostgreSQL plan after acknowledged commit; lower bound, lost acknowledgements not reconstructed          |
| `effect_jobs_maintenance_rows_total`     | `1`; jobs.operation=cleanup/recover-expired            | Confirmed removed/recovered row counts, not invocation counts                                                   |
| `effect_jobs_execution_in_flight`        | `1`; none                                              | Non-monotonic sum, balanced entry/exit per process registry; sum across workers                                 |
| operation duration, permit-wait/dispatch | `ms`; operation labels above                           | Local semaphore wait; includes interrupted wait                                                                 |
| `effect_jobs_scheduling_lag_millis`      | `ms`; none                                             | Validated claim updatedAt − availableAt, both from DB-time lifecycle data; no browser/process clock subtraction |
| `effect_jobs_health_rows`                | `1`; jobs.backlog                                      | supported/unsupported due work, expired leases or cleanup candidates; bounded lower bound                       |
| `effect_jobs_health_saturated`           | `1`; jobs.backlog                                      | 1 means count exceeded the sample limit; 0 means exact observed count                                           |
| `effect_jobs_health_oldest_age_seconds`  | `s`; jobs.backlog                                      | DB-sampled age of oldest candidate; -1 means no row; not zero age                                               |
| `effect_jobs_health_sample_time_seconds` | `s`; none                                              | Last successful sample's DB epoch seconds; absent/stale is not healthy zero                                     |

Logs now use one constant message `effect-jobs operation completed` with query
fields in **annotations**, not the old second message/body argument. Healthy and
expected Retry operations use Debug; degradation (failure/unknown/timeout/isolate/
dead) uses Warning. Set the host threshold intentionally. This changes existing log
queries and default volume; metrics continue even when Debug is disabled. Span
status remains Success(void) for privacy; query jobs fields to detect degradation.

## Explicit health reporter

Call `backend.health.sample({ queue, supportedCatalog, limit })` from ONE explicit
application-owned reporter for that storage/queue. Limit is 1–500 and catalog
selection is 1–500 entries from that queue. The implementation does four bounded
reads (at most limit+1 returned rows each), one DB-time sample, no writes/migrations,
and no per-claim scan. It requires an owned transaction, rejects ambient native
transactions and uses the application's finite SQL/query/control deadlines.
Filtered scans can still cost more than returned rows; qualify indexes/load and
bound statement time in the host. Failure preserves the last sample timestamp.

The buckets distinguish supported and unsupported due Pending/RetryScheduled work,
expired Active leases and due Completed/Dead cleanup _candidates_. Invalid policies,
domain references and Forever retention can still prevent candidate deletion.
This is not a global count reconstructed from UI pages. A saturated sample is a
lower bound; oldest selection remains ordered. In PostgreSQL READ COMMITTED each
query can see later commits; this is an operational sample, not an atomic audit.

Do not install a reporter per worker or sum replicas of the same gauge. Give each
queue/storage reporter its own registry/resource identity; reuse that identity on
restart. The current library has no distributed reporter election. Multiple
workers may sum operation/transition/in-flight measurements; health gauges require
a selected single source. Missing ownership, stale samples and unsupported backlog
need an operator decision, not a false healthy zero.

## Export qualification and bounds

Run `bun run qualify:observability` after build. The synthetic consumer exercises
enqueue, worker/dependencies, native control failure, annotated logs and metrics.
Its private canaries are synthetic. Tests separately prove local capture and real
Effect OTLP JSON/protobuf serialization. The consumer proves serialized JSON,
loopback HTTP acceptance, stored motel span/log queries with positive controls,
and stored metric queries against a tiny application-owned synthetic HTTP store.
Motel 0.2.0 does not ingest metrics; its traces/logs are not metric-backend proof.
The runner owns and closes both listeners and the exact collector child PID.
The stored synthetic consumer is not real-PG or production collector qualification.

The maintained application example adds `BoundedSink.mjs` around the actual Effect
OTLP serializers/exporters. It is a private synthetic application transport, not a
new library provider or default Layer. Its source admission caps native pending
log/span records at 32 (including unfinished spans), before native buffering/forking.
Dropped spans use an unsampled native span; application results are unchanged.
Trace/log flush threshold is one; source reservations are released using actual
serialized record counts, including frames coalesced by the native exporter.
This example owns fixed, bounded attributes and synthetic errors;
it does not promise bounded memory for arbitrary host objects or unbounded span
attributes. Metrics have the library's closed labels and are explicitly flushed.

The serialized transport queue admits at most **64 items / 512 KiB**; each body
must fit **64 KiB**. One worker owns at most one **64 KiB** request, with a **75 ms**
request timeout, no retry, and a **350 ms** shutdown drain/drop budget. These small
local-example limits deliberately make overload and loss observable; they are not
production SLO defaults. A real application must choose its own admission policy.
The capture oracle is itself capped at **64 records / 1 MiB**, with at most 64
remote response receipts. Raw library/application Causes are never diagnostic
queue labels. One fixed worker and finite source reservations prevent a slow
collector from creating unbounded sender fibers. Runtime/GC/HTTP implementation
memory is separate from these explicit retained-data bounds.

The native exporter receives a local **202** acknowledging only local handling
(admission or drop). Only the sink's actual remote 2xx counters/receipts prove
collector HTTP acceptance; the stored queries remain the stronger persistence
oracle. `synthetic_telemetry_admission_total` has a closed outcome label
(admitted/source-overflow/queue-overflow/oversize/closed), and
`synthetic_telemetry_delivery_total` distinguishes delivered/transport-failed/
shutdown-drop. They are application metrics, independent of exported logs/spans;
no recursive failure log or job mutation is used to report pressure.

`Sustained.mjs` exercises 3,000 actual callback entries per slow/offline case after
positive item-cap, oversize and source-admission controls. It asserts both byte and
item ceilings, one in-flight request, repeated real failed requests, overflow
measurements, unchanged business success and closed queues/worker/listeners.
Run this proof on Node and Bun with `OBS_RECEIPT` pointing to an owned receipt file.
Shutdown can drop queued telemetry. No process-kill durability or exactly-once
telemetry delivery is promised. A custom synchronous sink defect remains a real
Cause; ordinary asynchronous delivery failure remains isolated from business work.

## Operational queries and runbooks

These PromQL examples assume the host's OTLP-to-Prometheus mapping replaces dots
with underscores and exports explicit histogram `_bucket` series. Verify that
mapping and resource labels in the actual backend before installing alerts.

- Confirmed throughput: `sum by (jobs_state) (rate(effect_jobs_transition_total[5m]))`.
  This is acknowledgements/s, a lower bound on durable transitions.
- Retry/unknown: `sum by (jobs_outcome) (rate(effect_jobs_operation_total{jobs_operation="attempt",jobs_outcome=~"retry|unknown|timeout|isolate"}[5m]))`.
  Inspect the owning attempt and finalization reconciliation; do not divide rare
  Unknowns by empty poll counts or page on every normal Retry.
- Handler p95: `histogram_quantile(0.95, sum by (le) (rate(effect_jobs_operation_duration_millis_bucket{jobs_operation="invoke",jobs_phase="handler"}[5m])))`.
  Aggregate buckets after rate; never average per-worker p95 values.
- Saturation: compare permit-wait histogram, handler/attempt/protocol durations and
  `sum(effect_jobs_execution_in_flight)` with the configured total local concurrency.
  Local concurrency is not a global distributed limit.
- Oldest eligible work: select the one supported health reporter and reject stale
  sample timestamps before comparing age. Negative age means no candidate. Treat
  saturation as a lower-bound warning, not a fixed queue depth.
- Stale recovery/cleanup: inspect expired/cleanup ages and timestamp freshness;
  verify leases, DB/control timeouts, reporter ownership and application retention
  references before invoking bounded maintenance. Never reset a budget or replay
  Unknown writes merely to make a graph green.

The application chooses SLO thresholds, pending duration, routing, retention and
sampling. Start with disabled paging and validate synthetic controls, then choose
alerts appropriate to the deployment. These are query recipes, not a dashboard,
security audit or production rollout approval.
