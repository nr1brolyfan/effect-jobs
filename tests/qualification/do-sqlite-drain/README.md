# Local DO SQLite worker drain qualification

Run from the repository root with Node 24.15.0, npm 11.12.1 and Bun 1.4.2.

```sh
bun install --frozen-lockfile --ignore-scripts
npm ci --prefix tests/qualification/do-sqlite-atomicity --ignore-scripts --no-audit --no-fund
tests/qualification/do-sqlite-atomicity/node_modules/.bin/tsc -p tests/qualification/do-sqlite-drain/tsconfig.json
node --test --test-force-exit --test-timeout=30000 tests/qualification/do-sqlite-drain/Qualification.mjs
```

The runner uses the atomicity fixture's lockfile and checks Effect 4.1.3,
Alchemy and its Cloudflare module 2.0.0-beta.85, esbuild 0.28.2, Miniflare
5.20261006.1-alpha and the actual workerd 1.20261006.1 executable. It logs the
lockfile, bundle and executable hashes. The runtime uses compatibility date
2026-10-01, native SQLite and one application-selected named Durable Object.

The application inserts a synthetic invoice job through the source
`JobProducer.enqueueInTransaction`, using the standard codec and shared SQLite
adapter in a native transaction. The fixture targets one successful
insertion. The existing atomicity and JobStore suites qualify their respective
persistence boundaries. A separate request acquires and releases the actual
`JobWorker.layer` using `JobApi`, `JobGroup.handlers` and `JobStorage.layer`.
Readbacks after enqueue and after assembly require an untouched pending job,
zero handler entries and zero deliveries.

One further request explicitly calls source `JobWorker.drain` with concurrency
one, `maxJobs: 1`, `recoveryLimit: 1` and a two-second Effect deadline. The
worker uses the accepted SQLite port and its shared 250 ms response budget.
The request owns the Layer scope. The handler installation counts acquisition
and release, and the host awaits each request and runtime lifecycle operation
with a five-second deadline. There is no polling, alarm or startup drain.

An independent request observes the handler's decoded payload and metadata in
the object's memory, the application's invoice delivery row and the job's
fenced Complete transition. It checks `finalizedAttempts === 1` and the
fixture receipt for the original Active attempt. The same named object is then
reopened after Miniflare disposal using the same explicit
`resourcePersistencePath`. The fixture compares every returned field of the job and delivery rows,
including the serialized receipt. The object epoch must change and its
drain, scope and handler activity must stay at zero during the reopened read.
The runner disposes workerd and removes its temporary persistence directory
in cleanup.

## Negative controls

Run the same Node test in two disposable worktrees at the qualified commit.
Install the pinned dependencies in each copy using the commands above.
Apply just one substitution to each worktree. Both mutations preserve the
appearance of a successful drain so the independent evidence must reject them.

| File | Replace | With | Required failure |
| --- | --- | --- | --- |
| `src/internal/worker/Execution.ts` | `Effect.suspend(() => handler.execute(copied, context)).pipe(` | `Effect.void.pipe(` | Handler entry check fails, durable finalization check passes |
| `src/internal/do-sqlite/Store.ts` | `write(sql, before, after, encodeFinalizationReceipt(request))` | `void after` | Durable finalization check fails, handler and delivery check passes |

A successful application write is separate from finalization. The qualified
path shows one observed invocation and local persistence across a graceful
restart. It establishes neither exactly-once execution, atomicity between an
arbitrary handler effect and finalize, nor hosted or process-crash durability.
The schema and latest-receipt representation are internal. A public format and
retention policy remain open.
