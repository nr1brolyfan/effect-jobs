# Same-object SQLite atomic enqueue qualification

Run from the repository root with Node 24.15.0, npm 11.12.1 and Bun 1.4.2.
Install the root lock for type resolution of imported repository source.

```sh
bun install --frozen-lockfile --ignore-scripts
npm ci --prefix tests/qualification/do-sqlite-atomicity --ignore-scripts --no-audit --no-fund
npm run --prefix tests/qualification/do-sqlite-atomicity check
npm test --prefix tests/qualification/do-sqlite-atomicity
```

The lock pins Effect 4.1.3, Alchemy and its Cloudflare package at 2.0.0-beta.85,
Miniflare 5.20261006.1-alpha, workerd 1.20261006.1 under Miniflare, esbuild
0.28.2, Workers types 5.20261108.1 and TypeScript 7.0.2. The Worker uses
compatibility date 2026-10-01. The runner checks Miniflare's resolved workerd
binary and prints the binary and worker bundle hashes. Each case starts an
independent runtime and SQLite directory. Startup, each request including
body consumption, and disposal have 3-second deadlines. The test runner has
a 20-second backstop. All requests use the local harness.

## What runs

- The repository's `JobProducer.enqueueInTransaction`, internal opaque
  `withJoinedTransaction` capability and standard Schema/canonical payload codec
  run inside the object. The encoding transform gets a required service from
  Context. Its callback registers a microtask before it can resume. The trace
  checks the suspension and the persisted bytes include the service's prefix.
- `src/internal/do-sqlite/Transaction.ts` runs the scoped Effect callback
  inside native `ctx.storage.transaction` and owns the joined enqueue mapping,
  deduplication and rollback-only state. The fixture observes the native callback
  and settlement and injects native rollback and a failing SQLite payload write.
- The fixture owns object selection, native binding, domain and receipt schema,
  migration execution, HTTP, and the acknowledgment barrier. Job and payload
  rows use the same schema and adapter as the JobStore, drain and Alchemy fixtures.
  The adapter is internal. Ambient enqueue, standalone enqueue and public adapter
  exports are outside this qualification.

## What the gate checks

Every mutation has a separate read request. The positive case checks domain,
job identity/catalog, exact artifact format/payload/projection bytes and
receipt. A second named object is empty. Typed failure, defect and caught
integrity conflict all follow successful SQL writes to every table.
The conflict uses a second enqueue of the same producer tuple with changed
semantic bytes. The body catches it, tries a further write and returns
normally. The adapter’s rollback-only state rejects the native callback. A second control
catches a SQLite payload-write failure after the job insert, then verifies that
the job and domain writes still roll back. A matching duplicate returns the
original job ID and preserves all four stored rows.

The interruption case forks the transaction into a scoped fiber, waits for
the codec's suspension signal after the domain insert, then interrupts and
joins the fiber. The exact trace requires codec cleanup, capability closure
and native rejection before the join completes. A second interruption starts
after all four writes and requires all four to roll back. The host deadline fails
the test if settlement stalls. Each ordinary case checks exactly one native
and Effect callback, attempts to use both retained write capabilities after
ownership ends and verifies the complete database state. The negative
control performs the full body, explicitly rolls back the native
transaction, obtains a fulfilled response and verifies that the positive
commit oracle rejects it.

The successful path awaits native `storage.sync()` after native transaction
settlement and before building the reply. The local Worker discards that reply
and returns an injected 503 with outcome `Unknown`. A harness-only hash of the
discarded receipt verifies the exact bytes returned by the subsequent
read-only lookup by operation ID. The trace must stay unchanged during reads.
The runner disposes Miniflare and starts a new workerd on the same explicit
`resourcePersistencePath`. A fresh object epoch, unchanged persisted rows
and receipt bytes, and empty execution trace establish local recovery
without callback replay.

A separate control takes the same lost-response path. It starts the real
`storage.sync()` and holds the returned fixture promise until the Node
observer explicitly releases it. The observer requires entry, release,
DO response construction with the successful settlement already in its
trace, and injection of `Unknown`, in that order. The DO captures its trace
when it constructs the response, so workerd output gating cannot hide early
construction. The control exercises the fixture's wait. The unheld run
supplies the local persistence evidence.

The forced `ctx.abort()` case requires exactly one signal from the open
native callback after all four writes. The callback reports its operation
ID, epoch, native trace and row counts to the Node observer through a local
service binding before calling abort. The observer retains the signal
outside SQLite and across the reset. The post-reset read requires a fresh
epoch, empty trace, only the earlier committed rows, a 404 for the aborted
receipt and byte equality for the earlier receipt.

## Installed archive

Build and pack the local package, then run the same oracle from an empty
consumer with only the archive and its pinned Effect peer installed.

```sh
bun run build
bun run release:pack
node tests/qualification/do-sqlite-atomicity/Packed.mjs .toolchain/release/artifact/effect-jobs-0.1.0-alpha.6.tgz
```

The harness checks that package specifier imports of the internal modules fail
and uses a qualification-only relative file import from the installed archive.
The bundle input graph must contain the installed compiled adapter and one Effect
installation. The runner prints the archive and bundle hashes and removes the
consumer and its local persistence.

The persistence evidence covers tested same-object transactions and controlled
local restart. Hosted replication, process kill, device failure, eviction,
point-in-time recovery and a product deadline for native settlement are outside
the gate. The separate JobStore, drain and Alchemy fixtures cover additional
local paths.
