# effect-jobs

Effect-native durable, transaction-bound background jobs.

## Status

Initial scaffold only. The package has no queue implementation or public runtime
API yet and is not ready for publication or production use.

The first implementation will extract the jobs substrate from `effect-auth`.
Domain-specific job definitions, handlers, and auth producer transactions will
remain in `effect-auth`; this package must not depend on it.

## Intended initial scope

- Schema-defined, versioned jobs and logical queues.
- Atomic enqueue within an application-owned transaction.
- Durable lifecycle, semantic deduplication, fixed leases, and ownership fencing.
- Persisted retries, bounded recovery, and unknown-outcome reconciliation.
- A bounded worker drain and an explicit scoped Node/Bun polling adapter.
- PostgreSQL persistence with application-owned migrations.

These are implementation goals, not current support claims. Additional backends,
Cloudflare coordination, recurring schedules, and admin APIs are outside the
initial scaffold.

## Development

Use Bun 1.4.2. Effect is pinned to the same RC as the current `effect-auth`.

```sh
bun install
bun run check
bun run build
bun run test
```

Tests will live under `tests/`. The test command currently permits an empty suite;
this is not conformance evidence.

## License

MIT.
