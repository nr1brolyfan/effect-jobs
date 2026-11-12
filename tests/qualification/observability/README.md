# Synthetic observability qualification

Build with pinned Node 24.15.0, Bun 1.4.2 and Effect 4.1.0, then run:

```sh
bun run qualify:observability
python3 tests/qualification/observability/RunPostgres.py
```

The first runner starts its own Motel 0.2.0 child on an unused loopback port and
uses its own SQLite file. `MOTEL_PACKAGE` can point to the installed package;
the default is the local skill installation. It never queries another collector.
All children, listeners and private PostgreSQL configuration are cleaned before
return. Logs, query results and cleanup receipts stay under `.toolchain/observability`.
Only synthetic payloads/errors are generated; no application env/config is copied.

The consumer independently exercises Node and Bun, enqueue and a synthetic worker,
the actual Effect SQL transaction wrapper with a failing control, native Effect
OTLP JSON conversion/serialization, HTTP acceptance, and stored queries. Its
application-owned positive error MUST remain visible. SQL/control/payload/producer
canaries MUST remain absent. The synthetic metric store provides independent
HTTP acceptance/query evidence; Motel itself supports traces/logs, not metrics.
Tests separately exercise protobuf conversion and serialization. The test backend
is neither a production collector nor a durable queue implementation.

For source execution use Bun with `OBS_SOURCE=1`; ordinary Node loads the current
build. To use a separately installed immutable package, set `OBS_PACKED=1` and
`OBS_CONSUMER_ROOT` to that consumer directory. The consumer resolves the package's
public ESM export mapping. Actual package-export resolution/import inertness is
also enforced by existing release/installed gates.

The PostgreSQL runner creates a fresh label-verified, loopback-only PostgreSQL
16.15 container with ephemeral credentials/data. It runs the existing source
Node+Bun suites, including operator/creation fixtures, plus the bounded-health
regression. With `EFFECT_JOBS_ARCHIVE` set, it additionally runs installed backend
and native Drizzle/ambient qualification. The separate foreign declaration audit
retains skipLibCheck:false and its raw FAIL. Only the exact known seven foreign
diagnostics are nonblocking for normal skipLibCheck:true/runtime checks; new
authored/unexpected diagnostics remain blocking. No existing database or owner preview is touched.

The native SQL oracle uses the real pinned wrapper across begin/commit/rollback,
release, mixed reasons, interruption and body failure. It compares caller channels,
control counts and nonempty serialized bytes. Exporter fault tests independently
exercise rejected, stalled and offline local HTTP, finite flush/shutdown and a
synchronous sink defect. The maintained app-owned `BoundedSink.mjs` additionally bounds source records,
serialized queue bytes/items, in-flight requests, capture data and request/shutdown
lifetimes. `Sustained.mjs` provides positive slow/offline overload controls and
unchanged business outcomes. Its limits and loss semantics are documented in the
guide; no new library exporter API/default or provider registry is introduced.

`bun run verify` includes the jobs-only observability compiler gate. Full inherited
auth ai-docs checking is a separate diagnostic; unrelated imports are not jobs APIs.
An unavailable Traits tool, baseline formatter/linter failure, skipped backend or
empty capture is never PASS. Attach the actual byte-bound receipt when handing off.
