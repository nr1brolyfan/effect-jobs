# Executor qualification

From this isolated branch, build the unchanged root library and private contracts
using the ordered foundation setup. Then:

```sh
node apps/playground-worker/tests/execution/Prepare.mjs
python3 apps/playground-worker/tests/execution/RunOwnedPg.py
```

Prepare creates an independent consumer with an immutable root tarball, checks
its dist bytes/inventory, strict TypeScript declarations, and bundles the actual
app modules for workerd. It records source, archive, lock and worker hashes under
`.multica/executor-evidence/`. Each subprocess has a 10-minute limit. Test inputs
must be frozen before preparing; compare the recorded hashes before handoff.
The PG runner currently records the authorized task stage deadline explicitly;
a later authorized continuation must update the runner's deadline and resource
expiry together rather than silently run past it.

The runner creates at most one uniquely task-owned `postgres:16.15-alpine` container
pinned to digest `721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`,
loopback-only with tmpfs. It generates private credentials in a mode-0600 file,
never logs them, and removes the exact container ID/config in foreground finally
on success or failure. No existing DB/container/volume/.env is used. Each actual
runtime gate is capped at 150 seconds. Test code uses only isolated schema DDL
and app fixtures; executor code never updates library lifecycle or deletes jobs.

Node 24.15.0 and Bun 1.4.2 execute the same packed probe. Node also runs the SAME
program inside a native Durable Object using Miniflare 5.20261006.1-alpha,
workerd 1.20261006.1, nodejs_compat and the qualified Hyperdrive connection path.
Assertions cover six handlers, private payloads, delayed/retry/recovery, provider
response loss and durable dedup races, reset/CAS/late writes, quota races, global
unattended retirement/resumed viewers, first-admission unknowns, interruption and
zero remaining driver sessions after Scope exit. Native alarm set/delete is
qualified; automatic scheduled alarm execution and hosted CF are NotTested.

Production TS is checked/linted using the repository's pinned tools. The native
MJS assertion harness uses `oxlint.json` only to disable Effect diagnostics for
untyped external FFI channels and unstable API warnings. All other inherited
lint checks remain enabled. It does not weaken production lint or root configs.
