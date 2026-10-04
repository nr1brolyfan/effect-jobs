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
bun run lint
bun run format
bun run format:check
bun run build
bun run test
bun run verify
```

Type checking and declaration builds use the native TypeScript-Go compiler patched
by `@effect/tsgo`. The `tsc` command is the patched entrypoint, not the JavaScript
TypeScript compiler. Installation runs `prepare`, and check/build/lint/test also
apply the version-validated patch so that a skipped installation script cannot
silently disable Effect diagnostics.

Oxlint uses the Effect correctness preset, rejects floating Effects and explicit
`any`, and fails on warnings. Oxfmt follows the formatting conventions of
`effect-auth`. VS Code uses the native TypeScript language service after setup;
do not run a second TypeScript-Go language server alongside it.

Tests under `tests/` currently verify the toolchain, including negative controls
for Effect diagnostics and ordinary type errors. They do not qualify a queue
implementation.

## License

MIT.
