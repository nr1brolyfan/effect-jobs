# Local integration qualification results

The final changed integration gate passed on 2026-10-11, from 21:36:15Z to
21:38:04Z. The scoped PostgreSQL session count was zero at completion. Its exact
container was removed and absence verified at 21:38:05Z. A separate foreground
preview of the production entry returned HTTP 200; Ctrl-C stopped it, removed its
exact container and private configuration at 21:40:01Z. No preview is running.

## Tested inputs and commands

Node 24.15.0, Bun 1.4.2, PostgreSQL 16.15, local workerd 2026-10-06
(package 1.20261006.1), Miniflare 5.20261006.1-alpha, Playwright 1.56.1 and
Chromium 141.0.7390.37 were used. PostgreSQL used the issue-authorized pinned image:

`postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`

```sh
node apps/playground-worker/tests/integration/Build.mjs
python3 apps/playground-worker/tests/integration/RunOwned.py
PLAYGROUND_DEADLINE=2026-10-11T21:50:00Z python3 apps/playground-worker/tests/integration/RunOwned.py --preview
# HTTP GET /jobs -> 200; then Ctrl-C in the same terminal
```

Build and strict application types passed. Focused lint and formatting cover the
changed integration files; inherited global warnings remain. This is not a full
push-preflight receipt. The packed library SHA-256 stayed
`316c8eb36d7313af3e53231ac6a99c74a691839a382e1b3701bd5d9674c46fa1`;
private app paths were excluded and every packed dist byte matched the library
build. Library source, dependency inventory, peers, exports and release file
inventory are unchanged from the owner baseline.

Source SHA-256 receipts, artifact hashes and exact resource IDs are attached in
the final evidence archive. The build receipt field named `workerd` records the
Miniflare package version; the actual workerd version is recorded separately in
the final tool receipt. The existing qualified slices and consumed review/fix
reports were retained; unchanged historical matrices and reviews were not rerun.

## Passed changed integration checks

- actual HTTP guarded command / atomic jobs associations receipt / exact replay.
- four registered native DOs / automatic local alarms / six real handlers.
- real SELECT-only projection / keyset pages / private detail / no decrypt on list.
- actual Chromium UI/read/command/detail/reset/live.
- integrated persisted retry/dead/unknown/lease recovery / idempotent provider ledger.
- reset fences old generation / retains jobs and quota / old exact receipt.
- public native enqueue fixture / delayed scheduling / another sandbox viewer permits admitted unattended work.
- real keyset pagination retained across concurrent admission and lifecycle mutation.
- bounded larger backlog / multiple sandboxes / retained quota / filters / measured PG and DO costs.
- global last-viewer retirement / describe resumes ALL four queues / DB-time expiry.

## Quantitative observations

The browser made six reads and nine describe requests, opened two WebSockets,
received two ready frames and one jobs-changed frame, and verified authoritative
reconciliation after reconnect with two viewers. The bounded backlog observation
retained 100 admission quota units with 68 inserted jobs. PostgreSQL
pg_stat_statements recorded 2,130 calls and 1,042.574 ms aggregate execution time
in that observation window. Each of the four queues had eight activations and
three automatic alarm callbacks in the measured window. These are local app/query
observations, not hosted cost, throughput or CPU guarantees.

Job completion, retry counts, receipts, generations, associations, quota and
provider ledger assertions were read from persisted rows. Alarm/activation
counters use test-only subclasses in TestWorker; production Worker is built
separately and used by the preview. The delayed/unattended case uses a test-only
fixture calling the public native backend transaction and enqueue API. It is not
an additional HTTP scheduling capability. Expiry fixtures change authority
fields only; job lifecycle writes remain library-owned. No real provider HTTP is
allowed by the launcher.

Hosted Cloudflare, Alchemy, crash/network fault qualification, CPU qualification,
real external providers and terminal cleanup are not tested. Unsupported
retry/redrive/cancel operations remain false. Reset retains jobs and quota.
