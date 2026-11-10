# Website build contract

The website has two independent renderers. Astro/Starlight builds public pages to
`dist/site`; the existing Babel/StyleX/Bun build produces `dist/Client.js`,
`dist/Jobs.css` and `dist/build-receipt.json` for the React dashboard. Site styles
are loaded by Starlight and the landing page, never by the dashboard shell.

From the repository root:

- `bun run site:build` builds static documentation without database configuration.
- `bun run site:check` syncs Astro content and checks the authored site TypeScript.
  Astro templates are compiled by the build. This is not an `astro check` result:
  the current `@astrojs/check` peer range excludes the repository's TypeScript 7.
- `bun run site:test` checks source extraction and static asset boundaries.
- `bun run site:browser` checks built docs at desktop/mobile sizes, keyboard
  navigation, reduced motion, no-JS readability and Pagefind search.
- `bun run site:routes` checks the actual local workerd routing with synthetic
  configuration and an unreachable database address; static docs must succeed.
- `bun run playground:build` preserves the existing application build and also
  builds the public site through the website workspace's `build` script.

The existing local integration server's `ASSETS` binding serves the built site
through `StaticAssets.mjs`. The worker still owns origin admission, private
`/jobs` and `/api` guards, and read-only `/demo` activation. Dashboard shell and
asset responses retain their existing CSP. Public site HTML uses hashes of its
final inline scripts, enables Pagefind's WebAssembly, and permits Starlight's
inline styles. No private API is provided by the static asset adapter.

Content stays in `src/content/docs`; the loader prefixes IDs with `docs/` so
`start/installation.mdx` becomes `/docs/start/installation`, while
`src/pages/index.astro` owns `/`. Starlight normalizes index pages. Pagefind indexes
built public content. The preview has no canonical public hostname, so a production
sitemap requires a future authorized hosting configuration.

Shared colors live in `src/styles/site/tokens.css`. Landing authors import that
file directly; Starlight loads it through `docs.css`. Standard Markdown/MDX and
Starlight components need no custom imports.

`src/components/docs/index.ts` exports `CodeExample`. Its required `sourcePath`
is a filename relative to `examples/docs`, e.g. `orders/packages/orders/src/contracts/jobs.ts`; `region` is
optional. `role` supplies an accessible role label; order source panels display
the actual path relative to the example root. Matching `// #region NAME` and `// #endregion NAME` lines delimit a
region and are omitted from its rendered text. Missing, duplicate, reversed or
unclosed markers fail the build. Paths are confined to the real example directory,
including symlink resolution. Snippet extraction renders source without importing
or executing it. The example owner's qualification remains responsible for types,
public API compatibility and runtime behavior.

Example/reference qualification hooks are registered at the repository root:
`qualify:docs:orders`, `qualify:docs:examples`, `check:docs:reference`, and `check:docs:snippets`. They run
the reference owner's dedicated scripts after that scope has been integrated.
