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
- One new job every 30 seconds, cycling workloads and outcomes. The generator runs
  independently of visitor traffic. Missed alarms do not backfill an unbounded burst.
- Every 24 hours, prepare a separate candidate while keeping the old feed visible.
  Atomically switch the persisted pointer once the candidate qualifies. The browser
  reconciles the new identity and reconnects its invalidation WebSocket.
- Keep at most two demo sandboxes. An unfinished retired generation blocks further
  rotation; exceeding 3000 retained jobs requests early rotation rather than growing
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

Explicit migrations now include additive `playground-demo-v2`; the v1 descriptor is
unchanged. Do not run migrations in request callbacks. Local `Preview.mjs` waits for
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

Hosted Cloudflare resources/bindings, production migration rollout, cost/CPU budgets,
crash injection and a real 24-hour soak remain unqualified. A persistent local dev
database/server is separate from the finite disposable preview wrapper.
