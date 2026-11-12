# Creation time qualification

Use Node 24.15.0 and Bun 1.4.2 with the frozen root lockfile. No preview database,
owner checkout, persistent service or external deployment is used.

```sh
bun install --frozen-lockfile
bun run build
bun install --frozen-lockfile --ignore-scripts --force
bun run playground:build
bun run check
bun run check:postgresql
bun run playground:check
bun run test
bun run playground:test
bun run test:release-imports
bun run check:docs:api
bun run playground:qualify
bun run lint
bun run playground:lint
bun run format:check
mkdir -p .toolchain/creation-time
apps/playground-worker/node_modules/.bin/esbuild \
  apps/playground-worker/tests/integration/SchemaEntry.ts --bundle \
  --platform=node --format=esm --external:effect '--external:effect/*' \
  '--external:effect-jobs/*' --outfile=.toolchain/creation-time/Migrations.mjs
python3 tests/qualification/creation-time/RunOwned.py
# Choose a fresh artifact directory for each immutable pack.
EFFECT_JOBS_ARTIFACT_DIRECTORY="$PWD/.toolchain/creation-time/artifact" bun run release:pack
EFFECT_JOBS_ARCHIVE="$PWD/.toolchain/creation-time/artifact/effect-jobs-0.1.0-alpha.1-effect.4.1.0.local.5.tgz" \
  node tests/qualification/creation-time/Installed.mjs
```

`RunOwned.py` owns one bounded tmpfs PostgreSQL 16.15 container, a loopback port
chosen by Docker, and a fresh mode-0600 private configuration. It falls back to
`docker.exe` when needed. It runs real PG tests followed by production workerd
and Chromium checks. Browser checks cover drawer/full page on `/jobs` and
read-only `/demo`, the exact persisted time, local/UTC formatting, and a populated
pre-v7 record with an accessible unknown creation time. Finally it removes the
exact container, verifies absence of child process groups and deletes secrets.
Receipts, logs and screenshots remain under ignored `.toolchain/creation-time`.

The only shipped durable backend is PostgreSQL. Explicit-handle, standalone and
native ambient production plus both redrive variants share `insertOrCompareAt`.
The application-owned pg adapter is exercised by the focused database tests;
the native Effect PostgreSQL adapter is exercised through the production worker.
Mapped schema/table names are covered by real PG and deterministic SQL tests.
Optional Drizzle declarations are tested both from source and a normal installed
tarball, including nullable `created_at`, no default and an extra creation index.
The synchronous worker harness stamps its simulated inserts; UI-only DTO mocks
retain null because they have no durable creation observation. The historical
D6 proof adapter is not a shipped store and is not a second supported backend.

Fresh schemas contain nullable bigint `created_at`; populated installations
explicitly run `creationTimeMigration(mapping)`. Playground migrations v1–v6
retain their bytes; v7 adds creation metadata without backfill. Readiness rejects
unmigrated or incompatible storage. Enqueue result shapes remain unchanged.

The installed gate enables full strict checking (`skipLibCheck: false`) for the
core consumer. The normal Drizzle consumer uses the existing
`skipLibCheck: true` policy, retaining strict checks on authored code. A separate
diagnostic audit with `skipLibCheck: false` records the raw upstream declaration
result without turning a FAIL into a PASS. Existing repository checks retain
their existing configuration. Full lint/format results may also include inherited
issues outside this change; the handoff records these separately from checks on
changed files. A passing runtime gate does not make a failed full gate pass.
