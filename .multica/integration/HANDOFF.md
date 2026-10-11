# UPVE-1872 local integration handoff

Qualified at 2026-10-11T21:42:02.412832+00:00 before the unchanged deadline 2026-10-11T22:18:50Z.
Actual run start: 2026-10-11T21:08:11Z (project integration checkpoint).

Owner/runtime baseline: `929ee1b6fdb0985a820fd810f4b9dffed8602fbe` (tree e1036acc85bf893bd4bcc07714c9feb0bf66e1b9).
Qualified slice assembly / NEW integration review base: `e25591d5bcbb33f587cf8da5f2d09b1895b6e314`
(tree `a775ad17e99ccbd7a077f90c1abb6e742f3438de`). This local assembly commit preserves exact
frozen product bytes selected in qualified-base.json; it is not a feature rewrite.
Final head: `0afad40fa95729452255956421f7bd23f0ce6263`; tree `cf5668e4302d6682dcbfe03b6d9c34dc1cec8ca1`.
Branch: `agent/effect-jobs-implementor/upve-1872`.
Worktree: `/home/pc/multica_workspaces/upventure-43a8c02fcc9d/upve-1872-f205191671ba/worktree`.
Commits: chore(playground): assemble qualified local slices;
feat(playground): integrate scoped local dashboard and queues.

The first review should inspect new-integration.patch (27 paths), not repeat the
consumed prerequisite reviews. qualified-assembly.patch explains original slice
composition. local-handoff.bundle contains both local commits and requires the
owner/runtime baseline. qualified-source.zip is a source capsule of final tracked
files; inherited effect gitlink remains unchanged and is carried in the Git bundle.
No original branches or owner checkout were mutated. No remote actions or agent
dispatch were performed.

Ownership comprises shared private-app/root registrars, app adapters, changed
integration qualification files and docs/playground-qualification. The root library
source, dependency/peer/export/file inventory and archive bytes remain unchanged.
Retained prerequisite reports, sole reviews, triages and accepted fixes were consumed
through the issue/parent/executor checkpoint and authenticated attachments. The source
selection is in qualified-base.json and integration-sources.json. Prerequisite hashes
are in prerequisite-provenance.json. ALL 16 recursive ai-docs files and relevant
accepted decisions/workflow paths are recorded in docs-read.json.

Build, strict types, focused changed-file lint/format, packed-library isolation and
ten actual changed-runtime groups passed. final-runtime/ contains the exact runtime
input and resource receipts. 157 tracked runtime input
hashes match the final commit, including byte comparison against Git blobs; no
mismatch. Later committed additions/formatting are qualification prose only, outside
runtime inputs. Artifact hashes are rechecked in final-artifacts.json. Build's
workerd field contains the Miniflare version; final-tool-receipt.json records the
actual binary and hash. Final focused lint/format logs and successful build/type logs
are included. No full push-preflight PASS is claimed.

See repository Results.md for commands, persisted assertions and observations:
Chromium UI/HTTP/read/command/detail/reset/live; six handlers/four actual automatic
local alarms; retry/dead/Unknown/lease recovery; real pagination/filters under mutation;
privacy; retained reset/quota; multiple sandboxes/viewers; last-viewer retirement and
resume; expiry. Browser observed 6 reads, 9 describes, 2 sockets, 2 ready frames,
1 changed frame. Backlog observation: 68 inserted jobs, quota 100, 2,130 PG calls,
1,042.574 ms total SQL execution; each queue 8 activations/3 alarm callbacks.
Counters are test-only instrumentation; production entry was separately previewed.
The delayed admission is a public native API fixture, not an HTTP capability.

Final runtime completed 21:38:04Z with zero PG sessions, exact PG cleanup/absence
at 21:38:05Z. Production preview HTTP 200 then Ctrl-C; exact cleanup/absence and
private-config removal at 21:40:01Z. preview-resource-receipt.json identifies its
resource. Previous exact IDs were independently checked absent before each setup.
The launcher denies arbitrary provider HTTP. No service or owned DB remains running.
README.md documents reproducible bounded foreground launch/stop.

Failures were diagnosed locally: workerd empty-body POST (bounded reader fix),
test-fixture job-kind namespace (fixture fix), missing Chromium (installed pinned
browser), then stronger ready/changed-frame assertions and bounded hint signatures.
Failed attempts retain hash/resource receipts; attempts 02-04 also retain source
capsules. Attempt 01 has hash receipts only, not a full early source capsule. Raw
errors/stacks, private config, credentials and DB payload dumps are excluded from
the delivery archive. A browser-cache install removed older shared cached browser
versions; owner code was not affected. Future install instructions disable browser GC.

Hosted Cloudflare, Alchemy, crash/network faults, CPU and real providers remain
NotTested. Terminal cleanup remains deferred, reset retains rows/quota, and
retry/redrive/cancel remain false. FFI is limited to app transport/DO/native runtime
and test tooling. No new library runtime defect was reproduced; Findings.md records
application/library usage lessons. No later stage was activated and no historical
matrix/review was repeated. Only NEW integration bytes await coordinator's first
risk-based review selection.
