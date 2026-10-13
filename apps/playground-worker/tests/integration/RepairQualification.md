This is the finite continuation of the frozen job-details integration, using
task-owned PostgreSQL 16.15, the production worker/browser and the original
repair qualification entrypoint. It never reads preview configuration.

Build the library/contracts/apps with the pinned root scripts and refresh the
local file dependency before bundling `RepairPg.ts`. Bundle it as ESM to
`.toolchain/repair-continuation/RepairPg.mjs`, keeping `node:*`, `effect`,
`effect/*`, `effect-jobs/*` and `pg` external. Download the previously qualified
immutable archive to that directory using the authenticated attachment CLI.

Run `python3 apps/playground-worker/tests/integration/RepairRunOwned.py` in the
foreground. On WSL, `REPAIR_WSL_INTEROP` may select a verified existing interop
socket for this process only. The collector uses `docker.exe`, a private
Windows-readable env file and a task-local Python CLI adapter. It owns one
digest-pinned, tmpfs container at a time, one ephemeral loopback port and generated
credentials. Cleanup removes the exact ID and private files on every normal
exception path. An externally killed process is not a cleanup receipt.

`REPAIR_AMBIENT_PROGRAM` can name an already-built original native consumer's
Bun ambient program to finish that missing gate without repeating completed
Node/native gates. `REPAIR_PHASE=recorded` runs only the remaining recorded-data
slice. These options do not turn prior failures into passes. Resource receipts
must be preserved before another finite attempt; do not automate resource retries.

The original app entrypoint is deliberately unchanged. Its registered migration
scripts currently produce PostgreSQL `42601` through the pinned PgClient's
extended protocol. The combined slice stops at the same migration prerequisite;
it must not replace the stored seed with HTTP or recorded-state fixtures. Report
this as an original-author qualification incompatibility, not absent Docker.
Failure reports contain SQL classifications/codes, not provider messages or SQL.

The worker tsconfig permits only `effect/sql/SqlClient#SqlClient` in the three
integration SQL modules. The explicit qualification entrypoint also permits the
pinned Reactivity layer it needs. This uses `allowedUnstableApis` from the
installed `@effect/tsgo@0.48.0` documentation. No lint rule or severity changes;
another source file importing SqlClient still reports unstable API usage.
