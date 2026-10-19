# UPVE-2382 — local implementation handoff

Project: effect-jobs / 52ccc13e-4995-4a3f-be37-6f4cf6bebe3e.
Base: `78b0cd802ac76ef2b63fdceaac57cd98778b606b`
Head: `5adae2d9cc110d2300bc97838db3b7ee51f02567`
Tree: `4a9baad10133da48d01deb3e7ce379788e437c5a`
Branch: `feat/applicable-job-controls`
Worktree: `/home/pc/multica_workspaces/upventure-43a8c02fcc9d/upve-2382-259db7872eac/worktree` (runtime-local integration pointer, not a delivered file link).

Only website operator/repair/payload controls, necessary composition/styles and
directly affected tests changed (15 files). The runtime's empty baseline commit
was preserved on its original task branch; this implementation branch starts
at the exact authorized base. Canonical checkout/preview and server/shared-library
sources remain untouched. No push, PR, merge, deployment or review dispatch.

Outcome: controls are hidden by semantic applicability; busy/pending/locked
applicable controls remain discoverable and disabled. Empty cards/wrappers are
omitted; full-page payload spans the available row without a blank action column.
Unlock prerequisite, errors, confirmations, exact unknown receipt identities,
stale-version guards and live reconciliation remain. Payload has no visible
Locked/Unlocked footer or Result section; async success stays accessible and
wrong-code/copy errors remain visible. Current result DTO admits only not-stored;
existing provider/history evidence remains in the timeline.

The complete source-backed action/state/resolution/public/encryption matrix is
`apps/website/tests/ui/repair/Applicability.md` (also attached separately).

## Qualification

- `bun install --frozen-lockfile`: PASS; Bun 1.4.2 / Node 24.15.0.
- `node apps/playground-worker/tests/integration/Build.mjs`: PASS on final
  application code; library build, local file-dependency refresh, contracts/app
  build, app types, workerd bundles and byte-compared local library pack.
  Full command receipts/artifact hashes: `build-receipt.json` and `build.log`.
- `bun run playground:check`: final PASS (`types.log`).
- `bun run playground:test`: 18 files / 120 tests PASS (`affected-tests.log`),
  including 28 new source-projected applicability cases.
- Scoped `oxlint --deny-warnings` on every changed TS/TSX/MJS: PASS;
  scoped `oxfmt --config .oxfmtrc.json --check`: PASS (14 supported files;
  Python is not an oxfmt input). Exact scope is the changed source/test paths.
- `node apps/website/tests/ui/repair/Applicability.browser.mjs`: PASS, 225 checks:
  224 combinations (7 states × 4 resolution variants × public/private ×
  desktop/mobile × drawer/full page), plus locked correction/relock, copy error,
  disabled-but-visible busy controls and preserved rejection feedback.
  Controlled HTTP snapshots; no claim that impossible combinations are real DB rows.
- `bun apps/website/tests/ui/repair/Browser.mjs`: PASS, 5 existing component
  workflows, stale editor/version, pending receipt identity, unsupported encryption,
  unknown closure acknowledgment, mobile confirmation.
- `python3 apps/website/tests/ui/repair/ApplicabilityOwned.py`: PASS,
  PostgreSQL 16.15 pinned tmpfs + actual workerd + Chromium, 28 checks.
  Six required real lifecycle states in desktop/mobile drawer/full page;
  actual confirmed Pending→Cancelled and RetryScheduled→Completed; real stored
  encrypted synthetic source, wrong code, unlock, clipboard equality, edit,
  authenticated resealing/corrected redrive, successor Completed and resolved live
  groups; public demo has no private action cards. No lifecycle SQL edits.
  Exact container/config removal, browser/workerd/pool disposal verified in receipts.
- `git diff --cached --check` before commit: PASS; source tree is committed clean.

Full `bun run playground:lint` still FAILS on existing worker-test Effect
warnings outside the changed paths (see `playground-lint.log`). No check was
weakened. This is not authorization for a push. No hosted/crash/network/24-hour
qualification or unchanged full backend/installed matrix was rerun. Existing
historical reviews remain intact. Coordinator owns selection of the once-only
blind review and any subsequent accepted-fix handoff.

Earlier finite harness attempts exposed test setup issues (header spelling,
JSON content type, request-rate load, and an obsolete public Create-jobs assertion).
They were corrected without modifying app limits/authority. Every attempt removed
its own exact container/config; final passing evidence is included. The final
harness stays within five minutes and supports docker.exe fallback; this host
used working Linux docker. Synthetic HTTP busy/error coverage complements the real
PG run rather than claiming real server errors were injected.

Generated `.multica/integration` evidence changes are deliberately outside the
commit/patch; they are local build outputs, not owner changes. The standalone
patch contains only the authorized 15-file implementation/test diff. Build output
and final input hashes bind the receipts to the delivered source/config/artifacts;
`final-inputs.json` records source and test file hashes.

## Documentation read

- `ai-docs/README.md`
- `ai-docs/src/01_services/10_services-and-layers.ts`
- `ai-docs/src/01_services/20_module-consumption.ts`
- `ai-docs/src/01_services/30_layer-composition.ts`
- `ai-docs/src/02_modeling/10_schema-tagged-match.ts`
- `ai-docs/src/03_errors/10_errors-and-causes.ts`
- `ai-docs/src/04_observability/10_operation-observability.ts`
- `ai-docs/src/05_resources/10_resources-interruption-secrets.ts`
- `ai-docs/src/06_persistence/10_mutation-boundaries.ts`
- `ai-docs/src/07_transport/10_wire-errors.ts`
- `ai-docs/src/08_style/10_visible-code-and-modules.ts`
- `ai-docs/src/09_testing/10_testing-and-review.ts`
- `ai-docs/src/10_boundaries/10_external-time-regex.ts`
- `ai-docs/src/fixtures/Auth.ts`
- `ai-docs/src/index.md`
- `ai-docs/tsconfig.json`

Other governing reads:
- AGENTS.md (runtime task instructions)
- UPVE-2382 + empty comment scan
- UPVE-2381 + empty comment scan
- UPVE-1020 + empty comment scan + downloaded multica-workflow.md
- specs/architecture-decisions.md
- specs/operator-contract.md
- specs/job-details-repair-contract.md
- apps/website/src/server/read/README.md
- apps/website/src/server/commands/README.md
- apps/playground-worker/src/execution/README.md
- apps/playground-worker/src/demo/README.md
- apps/website/tests/ui/details/Integration.md
- root/app package scripts and .oxfmtrc.json
- multica-platform/SKILL.md + references/issues.md
