# Laptop handoff — API and documentation WIP

This branch is a source-preservation snapshot, **not merge-ready or newly qualified**.
It captures the current working files, including direct owner refinements made after
the historical Multica handoffs. Do not replace them with older issue attachments.

## Branches

- Latest integrated code: `origin/feat/dashboard-declutter-preview`, verified at
  `a467fc9e14c01d3d22a3dce7d516e3e5bd8b6a6a` on 2026-10-31.
- This candidate: `origin/wip/api-docs-laptop-20261031`.
- Separate dialog/filter candidate: `origin/wip/dashboard-dialog-laptop-20261031`.

## Snapshot and scope

The original candidate is based on `7a043ccb4a6419fd860792ba296759857910377b`.
The snapshot preserves 211 changed/new source, config, lockfile and documentation
files from the working tree without modifying or committing in the owner's worktree.
It includes public job `name`, typed producer slot bindings, definition default
policies, the documentation website, order tutorial, corrected import aliases,
email/domain examples and native SVG animations.

Useful paths:

- `src/Job.ts`, `src/JobProducer.ts`, `specs/api-refinements.md`
- `apps/website/src/content/docs/start/tutorial.mdx`
- `apps/website/examples/docs/orders/`
- `apps/website/src/components/docs/JobVisual*`
- `apps/website/src/components/docs/OrderFlow.astro`
- `apps/website/tests/order-tutorial/`, `apps/website/tests/site/JobVisuals.mjs`

## Continue safely

```sh
git fetch origin
git switch --track origin/wip/api-docs-laptop-20261031
```

Use a separate checkout/worktree for integration. This candidate still declares
Effect 4.0.5 and historical Drizzle prerelease pins; the integration branch uses
Effect 4.1.0 and Drizzle 1.0.0-rc.5. It also predates the current typed retry API,
creation timestamps and observability work. **Do not merge this snapshot wholesale**
or restore its old package pins over the integration branch. Adapt the intended
API/docs delta while preserving the latest integration contracts and all later
owner refinements, then qualify the combined result.

After adapting/installing the intended pinned toolchain, relevant scripts include
`site:check`, `site:build`, `site:test`, `check:docs:reference`,
`check:docs:snippets`, `qualify:docs:orders`, `qualify:docs:examples`, and `verify`.
These are entry points, **not claims of a fresh PASS on this snapshot**. Follow
the repository's current review and qualification policy before integration.

## Boundaries

No fresh runtime tests, build, automated Traits assessment or independent review
was performed for this archival push. Existing historical evidence is not a final
qualification of the current files. Source hashes and the committed file inventory
were checked during transfer; credential-pattern checks found only synthetic or
interpolated test URLs, not literal private credentials.

No `.env`, credentials, databases, preview state, node_modules, generated output,
new logs/evidence, local OpenCode override or owner-only Trait was added. Configure
Node/Bun, credentials and Traits locally on the laptop; do not copy the desktop's
absolute fnm path. The untracked owner documentation plan remains separate from
this source snapshot. No PR, merge, publication, migration or deployment is implied.

Tracking: UPVE-2611/2612, UPVE-2608/2609. The desktop sources were left unchanged.
