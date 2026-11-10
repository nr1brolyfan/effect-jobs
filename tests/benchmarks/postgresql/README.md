# Disposable PostgreSQL soak

Application-level, single-host load test of the **current built library**, not a
production qualification or universal throughput guarantee. It makes no runtime,
index, autovacuum or default-policy changes. No external service is called.

## Run

Prerequisites: pinned repository Node 24.15.0/Bun 1.4.2, repository dependencies,
Docker, and `postgres:16.15-alpine` already present locally. Images are never pulled
automatically. Install the isolated native-driver fixture once:

```sh
npm ci --prefix tests/benchmarks/postgresql --ignore-scripts --no-audit --no-fund
bun run test:soak
# Plan only: no build, Docker calls or database connection.
bun run soak:postgresql
# 12-second wiring check, including short-retention cleanup.
bun run soak:postgresql --run --smoke
# 30-minute soak at 100 jobs/second plus up to 60 seconds to drain.
bun run soak:postgresql --run
# Repeat at a different bounded offered load/duration/history size.
bun run soak:postgresql --run --duration 3600 --rate 100 --history 100000
```

Other options: `--workers` (1–8), `--image` (explicit official version). Unrecognized
options, nonfinite durations and estimated runs exceeding one million jobs are
rejected. Root dependency pins and the npm package contents are unchanged; this
development harness has its own pinned lockfile/native client.

## Workload

- Four paced producer lanes, three independent worker instances, two queues and
  two kinds per queue. Each worker has concurrency four per queue and finite drains.
  All share a 32-connection native workload pool in **one Node process**; this does
  not qualify separate-process deployment or multi-host coordination.
- 1 KiB payload data, schema encoding/decoding and SHA-256 work, with synthetic
  5/15 ms handler waits. These are bounded stand-ins, not real payment/email latency.
- 90% of arriving jobs use the actual library default policy (Completed: 90 days
  on this baseline). 10% explicitly use 30-second retention to exercise cleanup
  continuously. Smoke mode uses two seconds. Neither changes production defaults.
- 10,000 synthetic retained Completed jobs before measurement (100 for smoke).
  Cloned from a real enqueue artifact, with payloads/indexes. This represents live
  retained storage, **not** 90 days of physical churn. One template catalog is used
  for history; live traffic covers all four catalog entries.
- Cleanup batches of 500 every 200 ms, plus a bystander UPDATE every 100 ms using
  a separate two-connection pool. Observer queries use another two-connection pool.
- Ordinary PostgreSQL defaults; setup-only `VACUUM (ANALYZE)`. No pinned snapshot,
  forced vacuum during load, auto-tuning or statistics reset.

Producer lanes skip missed arrival slots instead of accumulating promises or
catching up in bursts. Inspect **actual throughput and missed arrivals**, not just
the configured target rate. The deadline stops new arrivals; finite in-flight work
can complete into the drain period. Counters are assigned when operations finish.

## Safety and resources

`--run` builds source and creates a fresh randomly named/labelled Docker container,
with a random **loopback-only** port, 2 CPUs, 1 GiB RAM and 256 MiB shared memory.
There is no existing-database URL option or environment-based target selection.
Only setup/observer connections are privileged; workload uses a DML-only role.
Passwords are kept in mode-0600 temporary files and removed at exit, never logged.

The parent bounds setup/workload time, escalates a stuck child from TERM to KILL,
and only removes a container after checking its exact random ownership label.
SIGINT/SIGTERM follow the same cleanup path. SIGKILL/host loss may leave the uniquely
named container behind; inspect ownership before manually removing it. No existing
containers, databases or private environment files are reused.

There is also a 100,000 due-pending-job circuit breaker and an actual one-million-job
insertion budget. These are **not disk quotas**; maintain host disk/memory headroom.
The host Node process is outside Docker's resource limits. Concurrent host work,
observer scans and instrumentation affect results. Do not compare runs without
recording resource/contention differences.

## Evidence and pass criteria

Each run prints its unique `/tmp/opencode/effect-jobs-soak-*` directory:

- `metadata.json`: options, source HEAD/tracked diff hash, harness/runtime hashes,
  dependency lock hash, Node version, exact Docker image ID/digests and limits.
  Harness hashes include new files not represented by `git diff`.
- `postgres-settings.json`: server version, durability/autovacuum settings.
- `samples.ndjson`: cumulative and interval p50/p95/p99/max operation histograms,
  confirmed completion and insertion counters, due backlog count/oldest age,
  server-side workload connection states, Node RSS, WAL and heap/index/tuple/autovacuum observations.
  Histograms have bounded memory; samples stream to disk.
- `summary.json`: offered-load throughput, remaining states, accounting and health
  checks; `failure.json` on early failure contains stage only, not raw provider errors.
- `resource.json`: workload completion and owned-container cleanup result.

Claimed/Empty claims have separate distributions. Enqueue latency includes commit;
store operations include native acquisition/transaction/protocol work, not just SQL
execution. `completed.sinceEligible` approximates eligibility-to-confirmed-completion
using DB epoch eligibility and host wall time (same host, not a distributed-clock
measurement). No external-effect idempotency claim is made.

The harness exits nonzero on incomplete execution, operation Failure/Unknown/Backoff,
uncompleted inserted jobs, accounting mismatch, loss of retained history, orphan
payloads, or missing cleanup activity when the run is long enough. Completion
counters require confirmed `Complete` transitions, not handler returns. Missed
arrivals and performance are reported independently: **healthy does not mean the
database sustained the target rate or met an application SLO**.

Inspect interval p95/p99, backlog age trend, actual inserted/completed throughput,
missed slots and storage growth across repeated runs. PostgreSQL tuple counts are
delayed estimates, not exact bloat measurements; WAL is cluster-wide but the cluster
is dedicated. No arbitrary latency/degradation threshold constitutes a pass.

This does not test retries, uncertain commits, provider deduplication, process
crashes, failover or network partitions. Those need separate fault-injection cases.
