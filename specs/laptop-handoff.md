# Laptop handoff — create-jobs dialog and Resolution filter WIP

This is a source-only preservation snapshot, **not merge-ready or newly qualified**.

## Branches

- Latest integrated code: `origin/feat/dashboard-declutter-preview`, verified at
  `a467fc9e14c01d3d22a3dce7d516e3e5bd8b6a6a` on 2026-10-31.
- This candidate: `origin/wip/dashboard-dialog-laptop-20261031`.
- Separate API/docs candidate: `origin/wip/api-docs-laptop-20261031`.

## Preserved source

The candidate's original base is `6aef4d557f7872338eda719bfc906d842fdfe3ad`.
Eight product files are preserved byte-for-byte from local head
`28eb9046d5f0f1dbae8c46b748338d1c704c42e4` (the product files are also identical
to the feature commit `047fb6cc`). The runtime/log/evidence additions in the
later agent snapshot are deliberately omitted from this new snapshot delta.

- `apps/website/src/features/jobs/CreateJobsDialog.tsx`
- `apps/website/src/features/jobs/CreateJobsDialog.stylex.ts`
- `apps/website/src/features/jobs/Dashboard.tsx`
- `apps/website/src/features/jobs/Dashboard.stylex.ts`
- `apps/website/tests/ui/CreateJobs.browser.mjs`
- `apps/website/tests/ui/CreateJobs.integration.mjs`
- `apps/website/tests/ui/CreateJobsRunOwned.py`
- `apps/website/tests/ui/Declutter.browser.mjs`

## Next work

```sh
git fetch origin
git switch --track origin/wip/dashboard-dialog-laptop-20261031
```

Integrate the intended eight-file feature delta into a separate checkout of the
latest integration branch. Reconcile `Dashboard.tsx` with newer work instead of
overwriting it. Preserve Created metadata, current retry/dependency contracts,
observability, local-only `/jobs` mutations and server-enforced read-only `/demo`.

Accepted UX: put optional Resolution filtering beside status/table controls;
keep the scenario lab behind an accessible Create jobs dialog. Do not resurrect
removed Kind/Search/Due controls or change lifecycle/repair semantics.

Rerun current types/lint/build, affected application tests, keyboard/focus/mobile
browser checks and real local mutation/read-only-demo qualification. Follow the
current project review policy using existing UPVE-2485 history; do not invent
another blanket review of the old candidate merely for this snapshot push.

No fresh tests, build, automated Traits assessment or independent review was run
for this archival transfer. Historical review/evidence does not qualify a future
integration delta. No private configs, new logs/evidence, databases, node_modules
or generated output were added. No PR, merge, preview restart, migration,
publication or deployment is implied. Original local branches remain untouched.

Tracking: UPVE-2485.
