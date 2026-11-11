# Native queue observation fixture

Run `python3 apps/playground-worker/tests/native/Run.py --observation` from the
repository root after the locked installation and `bun run workspace:prepare`.
Set `NATIVE_EVIDENCE_DIRECTORY` to an owned output directory. The supervisor
creates a fresh loopback PostgreSQL container, migrates only its synthetic
schema, runs real Alchemy/workerd and verifies teardown before removing PG.

`ObservationStack.ts` deploys `ObservedWorker.ts` with the production Worker
properties and implementation. Only the fixture decorates the native export
descriptors of Communications, Media, Commerce and Private. Their names,
`shared` object identities, constructors and callback engines are unchanged.
The production Worker only exports its existing properties and implementation;
it never imports this fixture or exposes its diagnostics.

`QueueObservation.ts` decorates the real `RuntimeContext.makeCallback` factory.
It preserves native registration, scheduling, cancellation, options and handler
delivery. Persistent fixture counters record successful `activate()` completion,
callback handler entry and failed handler exit. Reading diagnostics does not
activate a queue or deliver a callback. These counters are observations within
this synthetic fixture, not an exactly-once guarantee or a performance baseline.
SQLite counter writes add test-only work.

`GET /_integration/queues` exists only on the fixture Worker. It returns the four
queues in Communications, Media, Commerce, Private order. `ObservationClient.read`
uses a bounded HTTP request and validates the response Schema. Fields:

| Field                            | Meaning                                                                |
| -------------------------------- | ---------------------------------------------------------------------- |
| `name`                           | Native namespace name                                                  |
| `activations`                    | Completed production `activate()` calls                                |
| `calls`                          | Actual registered callback handler entries, including retries          |
| `failures`                       | Failed callback handler exits                                          |
| `alarm`                          | Actual native SQLite `storage.getAlarm()` result; null when absent     |
| `scheduledAt`                    | Native callback `queue` / ID `wake` requested deadline, or null        |
| `retryAt`                        | Native retry recovery deadline, or null                                |
| `attempts`, `progress`, `parked` | Native callback status, with absent status represented by 0/null/false |

`alarm` and `scheduledAt` can differ during retry. `calls` counts callback
deliveries rather than arbitrary HTTP requests or all platform alarm events.
Snapshots use the native concurrency gate and do not change wake scheduling.
The fixture adds only its internal `observe()` RPC; no credentials, payloads,
authority records or arbitrary storage values are exposed.

The finite test proves initially empty observations, real activation and
delivery, next armed wake, native retry after a temporary fixture-owned SQL
relation failure, progress after recovery, retirement cancellation, stable
counters while retired, and reactivation. Production five-second maintenance
and durable delivery remain enabled. Destroy is awaited before the final
zero-PG-client assertion; the supervisor separately checks closed HTTP and
confirmed container removal.

The original adapter author can select this Stack only for `instrument:true` in
their Core host, leaving ordinary hosts on `alchemy.run.ts`. Preserve the current
synthetic environment whitelist, isolated cwd/stage and HTTP readiness check
against the exact configured ORIGIN. Preserve awaited teardown in this order:
Core.destroy, Scope.close, sidecar.close, then PG disposal. The accompanying
handoff contains a finite unapplied Local.ts/TestWorker.ts patch. Existing
Harness/A1 oracles still need their original author to run them; this test does
not replace those gates or broad Chromium qualification.
