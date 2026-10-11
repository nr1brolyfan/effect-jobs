# Alarm setup failure qualification

The sole accepted integration triage item A1 is fixed in the shared
`Queue.alarm` callback. Failed event setup or execution now rejects with a fresh
`Error("Queue alarm unavailable")`. This native Promise boundary deliberately
discards internal error details and allows finite native alarm retries. It adds
no manual rearm loop, operation replay or new authority. HTTP sanitization and
the internal provider/transaction mixed-Cause behavior are unchanged.

The original qualified product snapshot is
`0afad40fa95729452255956421f7bd23f0ce6263`, tree
`cf5668e4302d6682dcbfe03b6d9c34dc1cec8ca1`. The retained branch also contains
`187e0d84cbe8d61014631cbbb5d605694adc90b3`, an automatically retained evidence
commit. Its product bytes match the qualified snapshot. This fix continues the
same `agent/effect-jobs-implementor/upve-1872` branch and preserves that history.
Only `Worker.ts` differs among the original 263 source inputs. Library source,
root manifest, lockfile, Executor and PostgreSqlProvider are unchanged.

Tests-only qualification used Node 24.15.0, Bun 1.4.2, Effect/PgClient 4.0.0,
Miniflare 5.20261006.1-alpha, local workerd 1.20261006.1 and the originally pinned
PostgreSQL 16.15 image digest. Application build/types and focused Worker/test
lint/format passed. The library was built only to restore this checkout's
missing generated dependency outputs; no historical library matrix was rerun.

The original refused-loopback-port reproduction uses the real Event.run and all
four real queue callbacks. Only its final `rejected` assertion changed from
false to true. All four now reject; each retains one activation write and no
manual replacement alarm. The script's unchanged final descriptive sentence
still names the original defect; the JSON/assertions are the fixed oracle.
A separate privacy control verifies the exact constant error, no Cause or DSN,
operation not executed on setup failure, and activation at 400 ms.

The affected final Harness section passed against a fresh task-owned PG and
real local workerd: all four automatic callbacks retired with null alarms,
authorized describe reactivated all four, and expired authority returned 401.
Generation/quota/job-count/lifecycle-version snapshots stayed unchanged while
retired. This focused fixture starts without jobs; the earlier populated
ten-group evidence is retained rather than claimed as rerun. Separate
deterministic controls retained MoreWork 100 ms, Backoff 1000 ms, the activation
ceiling, and a 5000 ms repair prearm after failure and interruption.

The affected runner is `apps/playground-worker/tests/integration/A1RunOwned.py`.
After the existing integration build prepares its bundles, it runs only
`A1Affected.mjs`. It requires an explicitly authorized future deadline and at
least eight minutes remaining, provisions one loopback/tmpfs database with
private generated configuration, then removes the exact container and config.
Receipts are written under `.multica/a1/runtime`. Two serial executions qualified
the initial slice and its strengthened observation assertions; both cleaned up,
and the final check had zero remaining database sessions. No service is left
running. The attached A1 evidence archive contains executable original/fixed
oracles, runtime/source/artifact hash receipts, commands and exact Git handoff.

This is local callback contract qualification. Actual PostgreSQL outages under
workerd and hosted retry exhaustion were not exercised. Hosted CF, Alchemy,
crash/network/CPU, real providers and full push preflight remain NotTested.
Conditional cacheable-hosting BFCache item C1 is deferred and unchanged. The
three original reviews and sole triage are complete; no further review or triage
was performed. No push, PR, merge, deployment or publication was performed.
