# Public live demo

The local `/demo` page is a read-only public feed. `/jobs` continues to use separate,
credential-owned visitor sandboxes. Nothing has been provisioned or deployed.

## Lifecycle

`DemoGenerator` is a single fixed-name Durable Object. Its native alarm is prearmed
before each event; a persisted PostgreSQL control row serializes seed, traffic and
rotation. DO storage is a wakeup hint, not database authority.

- Programmatic seed: 30 real jobs across all six workloads. Success, permanent
  rejection, invariant isolation, retry-then-success and future availability use
  existing definitions, codecs, encryption and the real effect-jobs producer/worker.
  No SQL fabricates lifecycle states, attempts or leases.
- Publish only after all 30 associations exist and at least six jobs each have
  actually reached Completed, Dead and Isolated. The remaining seed initially
  includes Pending and RetryScheduled. No partial seed is exposed.
- Irregular batches of 1–3 jobs every 5–15 seconds, cycling workloads. Most succeed;
  about 30% retry once, with rare permanent failures/isolation/unknown responses.
  About 80% are scheduled 15–60 seconds ahead, and retries wait 45–90 seconds, keeping
  Pending/RetryScheduled visible through real eligibility/retry policy, not fake
  state writes or blocked handlers. Persisted slots reproduce the same batch after
  a failed transaction. The generator runs
  independently of visitor traffic. Missed alarms do not backfill an unbounded burst.
- Every 24 hours, prepare a separate candidate while keeping the old feed visible.
  Atomically switch the persisted pointer once the candidate qualifies. The browser
  reconciles the new identity and reconnects its invalidation WebSocket.
- Keep at most two demo sandboxes. An unfinished retired generation blocks further
  rotation; exceeding 20,000 retained jobs requests early rotation rather than growing
  without bound. Outages extend only demo executor authority so old work can resume.

## Retention and security

Cleanup selects only terminal jobs in **retired, demo-owned** sandboxes, locks the
job rows and removes provider ledger/association/job records in one transaction.
Active leases and Pending/RetryScheduled jobs are never deleted; workers must drain
them first. Current/candidate records and private visitor sandboxes are excluded.
At most 50 terminal jobs per retired sandbox are removed per alarm event.

This is deliberately application-owned demo retention, not a general library purge
API. Deletion removes deduplication history; retired IDs/request namespaces are never
reused. Isolated records are deleted only after retiring their entire synthetic demo.

Public access uses dedicated GET-only `/api/demo`, `/api/demo/jobs`,
`/api/demo/jobs/detail` and `/api/demo/changes` endpoints. No public credential is
issued; capabilities disable all writes. Private cookies do not authorize demo jobs.
The existing DTO allowlist still excludes payloads, ciphertext and lease tokens.

## Setup and verification

Explicit migrations include `playground-demo-v2` and `playground-demo-volume-v3`;
the v1/v2 descriptors are unchanged. The higher cap is demo-only; private sandboxes
remain capped at 100. Do not run migrations in request callbacks. Local `Preview.mjs` waits for
the seed to qualify before reporting its `/demo` URL.

Build with `node apps/playground-worker/tests/integration/Build.mjs`.
Run the disposable test with a fresh finite deadline:

```sh
PLAYGROUND_DEADLINE="$(date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%SZ)" \
  python3 apps/playground-worker/tests/integration/RunOwned.py --demo-test
```

The gate uses real PG/workerd/Chromium, verifies all seeded states, alarm-generated
traffic, WebSockets, an accelerated rotation, nonempty authoritative snapshots,
browser identity reconciliation, drain-before-delete, private isolation and bounded
generation count. Acceleration changes only the disposable test's deadline; the
default rotation remains 24h. The owner wrapper removes its exact container/config.

Local preview runs until manual shutdown, on HTTP port 8787 by default, with no
deadline. Its disposable PostgreSQL still gets removed when the preview stops.

Hosted Cloudflare resources/bindings, production migration rollout, cost/CPU budgets,
crash injection and a real 24-hour soak remain unqualified. A persistent local dev
database across restarts is separate from this disposable preview wrapper.
