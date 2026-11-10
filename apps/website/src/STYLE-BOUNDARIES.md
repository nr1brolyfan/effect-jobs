# Public site styling and lifecycle

Landing, documentation shell and illustration layout use StyleX. Atomic CSS is
extracted by the foundation's Astro/Vite integration with runtime injection off.
Stable classes and data attributes are behavior/test hooks. They are not a
parallel component stylesheet.

The small `Landing.css` file contains inherited token aliases and document-level
box sizing, hidden-control and keyboard-focus resets. `JobVisual.css` contains
inherited diagram palette aliases and the hidden-control reset. The landing page
also imports that palette stylesheet so the extracted shared illustration asset
is linked on both the landing and documentation routes. Check the actual built
pages: a successful compiler exit alone does not establish that the CSS is linked.

`styles/site/docs.css` uses Starlight's global customization boundary for its
framework-owned grid, sidebar, search modal, table of contents, code rendering
and MDX typography. MDX callouts and outcome rows remain prose styling. Header,
sidebar content, page context and visualizations own their StyleX styles instead.
Unused transaction-diagram selectors were removed after checking source consumers.
No operator application styles are imported into the public site.

Each React island has its own Effect Atom `RegistryProvider`; module-level atoms
are definitions, not a shared registry. The official provider disposes its local
registry after unmount, including React's development remount grace period. The
landing storyboard and documentation presentations are deterministic and pure.
No network, database, live job telemetry or private payload enters these islands.

Native browser adapters own observers, document/media listeners and one pending
timeout or animation frame. They release them on React cleanup and suspend work
while hidden, offscreen or reduced motion is selected. The small custom host only
signals native disconnect/reconnect; it contains no UI state or rendering. If
external code reinserts only the host, it restores the Astro/React owner container
so React's delegated events keep working. Reconnect resets the illustration.
Geometry uses native SVG measurement; React owns SVG nodes and semantic state.

The legacy `/docs/jobs` static page redirects to canonical `/docs/playground`,
with a visible anchor for clients that ignore refresh metadata. The old
`content/docs/Jobs.html` is retained until its integration-server/test consumers
are updated by their owners. The existing `ExtractExample.mjs` file is a temporary
compatibility re-export for those test consumers. New site source uses the typed
implementation, retaining realpath confinement and marker validation.
