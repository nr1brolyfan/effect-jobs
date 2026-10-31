# Composable durable retry policy

Owner-approved public API, revised 2026-10-31. Implementation is an isolated local
candidate; this document does not authorize publication, deployment or integration
of the separate job-name/typed-producer/default-policy candidate.

```ts
import { Duration } from "effect"
import * as Policy from "effect-jobs/JobPolicy"
import * as Retry from "effect-jobs/JobRetryPolicy"

const retry = Retry.exponential(Duration.seconds(1)).pipe(
  Retry.capped(Duration.minutes(1)),
  Retry.jittered(),
  Retry.maxAttempts(5)
)

const policy = yield * Policy.make({ retry })
```

## Public construction

- `fixed(duration)` and `exponential(duration, { factor? })` construct immutable,
  pipeable unvalidated descriptions, not running schedules. They do not throw for
  invalid numeric configuration; only effectful assembly validates final values.
  The default exponential factor
  is 2; an explicit factor must be finite and greater than 1.
- `capped(duration)` sets the maximum base delay. It may be below the initial
  delay. `jittered()` selects bounded proportional jitter; cap always applies before jitter,
  irrespective of combinator order. Repeated setters use the last value.
- `maxAttempts(n)` accepts integer 1–100 and includes the first finalized attempt.
  Defaults remain three attempts and, when `retry` is absent, a fixed five-second
  delay. One attempt disables subsequent scheduling, not the first execution.
- Duration inputs are Effect `Duration` values representing exact integer
  milliseconds in 1–253,402,300,799,999. Infinity and fractional milliseconds fail
  configuration. Conversion must not lose nanosecond precision before validation.
- `yield* Policy.make({ retry })` remains the only assembly spelling. It returns
  `Effect<JobPolicy, JobPolicyConfigurationError>` and reports expected validation
  failures as Fail, not throw/Die. Retry diagnostics identify `retry.delay`,
  `retry.factor`, `retry.maxDelay` or `retry.maxAttempts`. There is no implicit
  conversion to a full job policy, `Retry.toPolicy`, or shortcut on a job definition.
- Existing `retryDelay`/top-level `maxAttempts` inputs remain deprecated compatibility
  inputs. Combining either with `retry` fails in the Effect channel rather than silently choosing precedence.
  A new retry description owns its attempt limit.

## Persistence and evaluation

The existing policy JSON retains a top-level `maxAttempts`. Construction resolves
the public builder into ordinary data; functions/prototypes are not persisted.
Unmodified fixed schedules retain their exact `FixedDelayV1` representation.
The new `BackoffV1` schedule contains `delayMillis`, `factor`, `maxDelayMillis`
and `jitter` (`None`, legacy `Full`, or `ProportionalV1`). A capped/jittered fixed schedule uses factor 1.
Without an explicit cap the maximum representable duration is the arithmetic cap.
Decoding a stored policy never fills deployment defaults or rewrites versions.

After finalized attempt n, the base delay is the initial delay multiplied by the
factor n−1 times, saturated at the cap before multiplication can overflow, then
floored to integer milliseconds. Thus the first retry starts at the base, not
twice the base. `ProportionalV1` chooses uniformly among integer milliseconds in
`[ceil(4 × base / 5), min(cap, floor(6 × base / 5))]`. Bounds are computed with
exact integer arithmetic, including the smallest and largest supported durations.
For a 1-second base this is 800–1200 ms; at a 60-second cap it is 48–60 seconds.
Shorten the sampling interval, do not clamp a broader draw and concentrate jobs
at the cap. New proportional delays are at least 1 ms.

Stored `Full` retains its original `floor(u × (base + 1))` semantics, bounded by
base, where `0 <= u < 1`. Its zero delay still means due immediately through the
durable queue, never an in-handler retry loop. Never reinterpret existing Full
rows as proportional jitter. Jitter is scheduling randomness, not a secret.

The worker draws one Effect Random sample after an explicit Retry outcome and
only if another attempt is permitted. Its frozen finalization command retains
that sample. All repeats and read-only reconciliation use the same command.
The backend computes `availableAt` from its one database-time snapshot and writes
the timestamp, state and counters atomically under the existing ownership fence.
The sample is not a new column or durable secret: the concrete timestamp is stored.
After a restart, readers use that timestamp rather than regenerating randomness.
Custom worker/store integrations must supply the sample for a jittered Retry;
missing or invalid entropy fails closed. Pure lifecycle planning remains pure.

Exhausted attempts become Dead without calculating an unused future delay;
`availableAt` remains unchanged in this case, including for fixed schedules.
Otherwise, computed availability `>= notAfter` becomes Dead, preserving the
existing equality boundary. Timestamp overflow fails explicitly, never wraps or
clamps database time. These scheduling controls do not guarantee exact start time.

## Unchanged guarantees and rollout

First-write-wins policy and semantic deduplication remain unchanged. Enqueue replay
does not replace the first schedule, attempt limit or initial availability.
Unknown execution/commit outcomes, defects and interruption do not become known-safe
Retry outcomes. Lease recovery uses its separate stall budget; it does not advance
the exponential finalized-attempt counter or prove the external action did not run.

`Policy.make` now returns an Effect rather than resolved data. Callers must evaluate
it explicitly; `defaultPolicy` remains trusted, deeply immutable resolved data.
Do not add Effect.sync around old throwing builders or silently run effects in
production constructors. Test-only synchronous evaluation of valid fixtures is
not a new public unsafe constructor.

No physical column migration is required. This is nevertheless a worker protocol
extension: old readers reject `BackoffV1`/`ProportionalV1` and can isolate unsupported rows. Upgrade
all consumers of a storage before producing new schedule versions; do not run old
and new workers against new-policy jobs or roll readers back without resolving them.
Existing `FixedDelayV1` rows remain readable with their original values.

Qualification must cover constructor/type boundaries, cap/jitter order and edges,
attempt exhaustion, notAfter, fencing/recovery, response loss, identical-command
reconciliation, real PostgreSQL persistence/backend recreation on Node and Bun,
and an installed package consumer. Focused passing checks do not waive the existing
foreign-declaration/full-verification blockers or independent review requirement.
