## Jobs UI integration handoff

The feature exports `mount(root, client, sandbox)` from
`apps/website/src/features/jobs/View.ts`. It returns `{ controller, dispose }`;
the browser registrar owns mounting and calls `dispose()` when leaving the page.
Cleanup removes listeners, stops reconciliation and aborts outstanding Effects.
The adapter is the browser `Client` port in `Adapter.ts`, backed by `JobsClient`.
It receives sandbox references, never `SandboxAccess` or credentials. Supply the
server-described `SandboxView` and a real HTTP client for hosted use. Mounting
starts a fresh describe/list read and visible-page five-second reconciliation.
Operations time out after ten seconds; reads are replaceable, commands are never
automatically retried. The UI uses a five-item page to keep the demo compact.

### Exact requests to the serial registrar

- In `apps/website/src/Client.ts`, import `mount` from `./features/jobs/View.js`;
  on `/jobs`, invoke it with the existing page's main element, the independently
  integrated browser transport client and its server-described sandbox. Retain
  the cleanup handle. Do not import `FixtureEntry.ts` in hosted code.
- Include `apps/website/src/styles/Jobs.css` in browser assets and serve it with
  a CSS content type; the fixture/guide HTML uses `/Jobs.css`.
- Register `/jobs` using the app's real HTML shell, containing `<main id="jobs">`
  and the browser asset entry. Register `/docs/jobs` as the static English page
  `apps/website/content/docs/Jobs.html`, with HTML content type. The feature links
  to that guide. `Jobs.md` is the repository-readable companion.
- Provide describe/list/detail/run/reset and both exact receipt-read adapters
  using the frozen DTOs. Enforce cookie authority, origin/CSRF, budgets and strict
  Schema boundaries at the HTTP layer. No endpoint URL is guessed by this slice.
- Connect the live slice's reconciliation notifications to
  `controller.refresh`. Hints do not patch authoritative data. External resets
  are detected by describe; old data/selection are revoked explicitly. Default
  polling remains the convergence fallback. Preserve current filters/cursor.
- Add `vitest run apps/website/tests/ui/Controller.test.ts` to the app test gate.
  Existing `playground:test` selects only the contracts tests and currently does
  not discover the UI tests. Root/app manifests and registrars remain unchanged.

### Reproduce local checks

Use the frozen foundation's install/build steps first. Then:

```sh
bun run playground:check
bun run playground:lint
bun run playground:build
bun node_modules/vitest/vitest.mjs run apps/website/tests/ui/Controller.test.ts
bunx oxfmt --config .oxfmtrc.json --check apps/website/src/features/jobs apps/website/src/styles apps/website/content/docs apps/website/tests/ui
node apps/website/tests/ui/Packed.mjs
npm install --prefix .multica/browser --ignore-scripts --no-audit --no-fund --save-exact playwright@1.61.1 axe-core@4.11.1
node .multica/browser/node_modules/playwright/cli.js install chromium
node apps/website/tests/ui/Browser.mjs
```

For a preinstalled Chromium, set `UI_CHROMIUM_PATH` to that exact executable and
record the version from the receipt. The browser runner creates a loopback-only
ephemeral server, collects desktop/mobile/unknown screenshots, checks keyboard,
WCAG A/AA, filters, pagination updates, reconnect, scenario/reset presentation
and the five-second timer, then closes its server and browser. It installs no
shared dependencies and leaves no running service. Scripted command results are
test observations only. Receipts bind bundle/source/archive hashes; packed types,
Node/Bun UI-state smoke and actual browser bundles run outside the repository
ancestry with the real installed library archive and no aliases/backend peers.

The production entry/router is not integrated by this author because those paths
belong to the serial registrar. PG, workerd, hosted behavior, durable commands,
authority, public shared feed and unsupported lifecycle commands are unqualified.
Unknown request memory is mount-local and does not survive reload. No push, PR,
merge, deployment, resource provisioning or library runtime edit is included.
