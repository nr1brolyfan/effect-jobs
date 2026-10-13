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

The default collector runs the original app PG reproduction and the combined
slice. It consumes completed core retention/native/installed evidence rather than
rerunning those matrices. `REPAIR_PHASE=supplementary` selects the populated
historical migration plus combined slice; `REPAIR_PHASE=browser` selects only
the combined slice. Preserve resource receipts before another finite attempt;
do not automate resource retries. A failed gate makes the collector exit nonzero.

The accepted original-author migration helper sends one PostgreSQL command with
unchanged descriptor bytes, on the same owning client/transaction. `RepairPg.ts`
uses it for recorded setup too. No SQL splitting, additional migration pool,
changed checksum, fabricated lifecycle/history or HTTP fixture substitutes apply.
Failure reports contain SQL classifications/codes, not provider messages or SQL.

Bundle `RepairHistorical.ts` using the same externals as `RepairPg.ts`. Its
qualification-only `LegacyPopulation.mjs` must be built from exact accepted base
`358299e638c01c73bde356acbff3c134f5ceaef2` source in a private test directory.
Resolve library and contract imports to that historical source, keeping Effect
and pg external and using the pinned PgClient. The evidence includes the small
population entrypoint and exact input hashes/build recipe. It uses the historical
application's real issue/scenario/worker/redrive APIs, then migrates populated
v1-v5 to v6 with tenant backfill and verifies preservation and scoped deletion.
This test extraction never replaces integrated or owner source.

The combined browser slice checks real stored encrypted bytes, tampering,
relocking, private correction/resolution, counts/pagination and public admission.
`REPAIR_MISSING_ONLY=true` selects remaining private scenarios after consuming
the captured demo/crypto run. Its receipt explicitly retains the earlier Escape
focus failure and exits nonzero even when the selected remaining scenarios pass.
It is a continuation receipt, not an independent full-suite PASS.

`REPAIR_REMAINING_ONLY=true` selects the original stored focus/navigation
reproduction and the remaining page/cursor/scroll, problem-view/filter/related,
mobile/direct-link, live-read, decrypt/navigation race and browser expiry groups.
It skips previously completed crypto, private repair, counts and admission groups.
`REPAIR_BROWSER_GROUP` selects comma-separated substrings of remaining group names
for affected-only continuation. Such a receipt qualifies only its selected groups;
consume earlier receipts explicitly before claiming combined coverage.
`REPAIR_OUTPUT_DIRECTORY` chooses a new task-owned evidence directory containing
the pinned RepairPg bundle and unchanged archive, preserving previous attempts.

The expiry group advances only the browser clock beyond the real PG admission's
expiresAt; it does not claim natural DB-time expiry coverage. The race group holds
the real Web Crypto decrypt completion across navigation and reopening, without
substituting crypto results, payloads or HTTP. Only boolean completion facts are
observed; plaintext and key bytes are never copied into evidence.

The worker tsconfig permits only `effect/sql/SqlClient#SqlClient` in the three
integration SQL modules. The two explicit integration qualification entrypoints
also permit the pinned Reactivity layer they need. This uses `allowedUnstableApis` from the
installed `@effect/tsgo@0.48.0` documentation. No lint rule or severity changes;
another source file importing SqlClient still reports unstable API usage.
