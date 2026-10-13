# Job details slice

These sources implement the frozen UPVE-2145 contract. They import the real
`JobDetail` type; they intentionally await serial registration of its new fields.
No duplicate production DTO or shared registrar is included.

## Serial wiring

1. Register the frozen `JobDetail` fields (`history`, `provider`, `lineage`,
   `problem`, `related`, `payload`, `result`, `createdAt`, `eligibility`) and extended
   `JobFilters` in contracts. Retain strict decoding and scoped server reads.
2. Serve the existing shell for `/jobs/:jobId` and `/demo/jobs/:jobId`. Recognize
   nested demo paths in Client/Worker before sandbox bootstrap. Trusted server
   configuration remains responsible for private admission; this adapter grants
   no server authority. Missing/invalid expected generation is an invalid route;
   mismatched generation is stale and must not request another job.
3. Provide `Navigation.make(runtime.registry, window, bindings)` in the existing
   Runtime Scope. Subscribe/render its `route` atom through the existing
   RegistryContext. For a Detail route, perform the existing revision-guarded
   selected-detail read only after checking current sandbox/generation. Stale or
   Invalid routes render an unavailable view; the adapter never reads a client.
4. Bind `capture` to current sandbox, filters, view, pageSize/pageNumber, actual
   `atoms.cursors`, scrollY and selected identity. Bind `restore` to one atomic
   registry update of these values before refreshing rows. Retain ordinary
   cursor repair: one bounded first-page fallback with an explanation when the
   anchor becomes invalid. The adapter retains at most 100 cursor anchors and
   explicitly reports fallback for deeper history. Hydrate only shareable
   URL filter/view metadata on direct list loads; cursors stay volatile.
5. Bind `relock` to clear selected detail and cancel/fence its in-flight reads
   before navigation. Call `scopeChanged` on expiry/reset/sandbox replacement;
   it clears the anchor and revokes the detail route, including same-generation
   sandbox replacement. Do not silently recover a stale job URL. Dispose with
   Runtime Scope before registry disposal. Pagehide clears/revokes detail state.
6. List selection mounts `JobDetailsDrawer` with its exact frozen slot props.
   `onClose` clears selection; `onOpenFull` calls `openFull`; related navigation
   calls `related`. The full route mounts `JobDetailsPage`; its close calls
   navigation `close`. Related details replace the current detail entry so Back
   returns to the original list. Direct-link Close falls back to same-mode list.
7. Compose the sibling payload/repair panels as slots. Key the containing surface
   by mode/sandbox/generation/job identity. Supply payload `identityKey` including
   mode; unmount all slots on expiry/unavailability/navigation. The components
   own no client or command state. Drawer Close/Escape/full navigation removes
   its slots immediately; identity changes remount page slots. `now` and
   `onOpenFull` remain in both exact interfaces for serial composition.
8. Add `data-job-id` to the selected row's focusable button and
   `data-jobs-focus-fallback` to the list fallback. Call `restoreViewport` once
   from useLayoutEffect after restored rows commit. Focus the full view's
   `[data-job-details-heading]` on route change. Preserve the list component's
   volatile local controls rather than rebuilding its registry.

History is rendered in the authoritative server order without inferred attempt
rows, sorting or deduplication. Operator keys use actual request/action identity.
The frozen Resolution item has no stable audit key; resolution rows therefore
use positional React keys and do not claim timestamp identity. If later history
pagination must append/deduplicate these items, serial contracts/read projection
must expose the real audit identity first. Current bounded pages explicitly label
additional unavailable-in-this-view history/related evidence. No load-more API or
callback was added to the frozen component interface.

## Bounded checks

Run the library build and refresh its local file dependency before contract build:

```sh
bun install --frozen-lockfile
bun run build
bun install --frozen-lockfile --ignore-scripts --force
bun run --filter @effect-jobs/playground-contracts build
bunx --no-install tsc -p apps/website/tests/ui/details/tsconfig.navigation.json
bunx --no-install vitest run apps/website/tests/ui/details/Navigation.test.ts
bun apps/website/tests/ui/details/Details.browser.mjs
bunx --no-install oxlint --deny-warnings apps/website/src/features/jobs/details apps/website/tests/ui/details
bunx --no-install oxfmt --config .oxfmtrc.json --check apps/website/src/features/jobs/details apps/website/tests/ui/details
```

The browser harness compiles actual components with production StyleX extraction
and pinned Base UI/React. Its synthetic test-only object follows frozen future
fields; it is not validated by current shared DTOs or served by the real API.
It checks modal focus, Escape/Close, slot unmount/relock, full/related links,
real browser Back and list filters/page/cursor/scroll/focus restoration,
direct demo/stale links and desktop/mobile WCAG axe/overflow. Navigation tests
and its scoped type check use real current shared types and an existing registry.

`playground:check` remains deferred until new DTOs exist. Existing app lint
failures are retained in the handoff. A successful app build extracts these
sources but does not register their reachable production entrypoints. The
integrator must rerun the full shared type gates and real browser/workerd/PG
flow, including authority, generation races, retained source deletion and real
payload crypto/repair behavior. The existing playground test script discovers
only contract suites: register this focused navigation/browser suite explicitly.
