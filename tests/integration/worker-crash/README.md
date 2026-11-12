# Worker crash integration tests (Vitest + Effect + real PostgreSQL)

These are assertion-based **Vitest integration tests**, not a performance script.
The worker helper runs the real Effect worker in another Node process so the test
can kill it without gracefully releasing its lease. No library runtime changes.

## Local / CI command

Use Node 24.15.0, Bun 1.4.2, repository dependencies, and a Linux Docker runner.
Install the isolated pinned test dependencies (native PgClient 4.1.0 and Vitest
4.1.11). Root package pins and published package files do not change:

```sh
bun install --frozen-lockfile
npm ci --prefix tests/integration/worker-crash --ignore-scripts --no-audit --no-fund
# Explicit infrastructure preparation, outside the tests:
docker pull postgres:16.15-alpine
bun run test:postgresql:crash
```

The command builds current source, then runs Vitest with the dedicated config.
It is intended for a separate integration CI job, not automatic execution during
every unit-test run. Missing Docker, missing image, setup failures and failed
assertions **fail** the job; there is no silent skip. The fixture never pulls an
image itself. The separate `PostgreSQL crash recovery` job in
[`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) runs this suite on
pull requests; see [CI behavior and local reproduction](../../../docs/ci.md).

Vitest's usual reporter flags work for CI, for example:

```sh
bun run test:postgresql:crash --reporter=default --reporter=junit --outputFile.junit=/tmp/opencode/worker-crash-junit.xml
```

## Scenarios and oracles

1. **Normal control:** enqueue, run an independent worker, observe one committed
   provider request and durable Completed with one finalized attempt, zero stalls.
2. **Crash after effect:** wait for an independent provider ledger commit and a real
   Active claim; kill that worker with **SIGKILL**. Assert that its job remains
   unchanged and neither recovery nor a new claim is possible before lease expiry.
3. Observe expiry using **PostgreSQL time**, not a fixed sleep or fake Effect clock.
   Recover exactly one job through the queue-scoped public store API. Assert Pending, one stall,
   zero finalized attempts, cleared old ownership.
4. A replacement worker claims with a different token and higher version, and
   re-invokes the handler with the same business idempotency key. While it holds
   the new claim, submit the authentic old capability/snapshot: stale writes must
   fail with JobOwnershipLost and leave the new row unchanged.
5. Resume the real replacement worker. Require acknowledged Completed, one finalized
   attempt, one stall, unchanged policy/payload artifact, and two provider requests
   but only one ledger entry for the business consequence.

The provider ledger uses a separate schema/connection and commits outside the queue
transaction. Its primary key implements the **test provider's** idempotency contract;
the library does not provide exactly-once effects. The worker killed before
finalization and the successful replacement are two handler invocations but only
one finalized attempt. No fixed latency threshold is used.

## Isolation and cleanup

Every suite creates its own randomly named/labelled PostgreSQL container with a
random loopback-only port, 2 CPUs, 1 GiB RAM and 256 MiB shared memory. It accepts no
database URL or environment-based target. Setup/observation use a private admin;
workers and the parent's configured jobs instance use a DML-only runtime role. All connections have
finite query/connect budgets; each test/hook has a 60-second Vitest deadline.

Credentials are stored only in mode-0600 files under a unique
`/tmp/opencode/effect-jobs-worker-crash-*` directory, not command arguments.
Worker stdout/stderr are ignored; IPC carries only test states and claim metadata.
The fixture kills leftover child workers and verifies its exact random ownership
label before deleting the container and volumes. It removes private config at
normal/failure teardown. SIGKILL/runner loss can bypass teardown; use an ephemeral
CI runner and inspect the printed unique container name before manual cleanup.

The evidence directory retains server/image/Node identity and `resource.json` with
container-cleanup outcome. Vitest provides the assertions and exit status. This
does not test uncertain commits, network partitions, PostgreSQL restarts or real
external providers; those are separate future scenarios.
