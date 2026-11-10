# Website and playground boundaries

The public site and browser playground build independently. Their HTTP paths,
cookie policy, CSRF checks and content security policies remain owned by the
worker and its asset adapter. Moving a source file does not change a public URL.

| Responsibility                               | Source                                                    | Build output                                         |
| -------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| Public landing and documentation             | `apps/website/src/{pages,components,content,styles/site}` | `apps/website/dist/site`                             |
| React playground                             | `apps/playground/src`                                     | `apps/playground/dist/Client.js`, `Jobs.css`         |
| HTTP admission, reads, commands and upgrades | `apps/playground-worker/src/server`                       | Worker bundle                                        |
| Origin policy                                | `apps/playground-worker/src/OriginPolicy.ts`              | Worker bundle                                        |
| Portable HTTP route map                      | `packages/playground-contracts/src/Routes.ts`             | `@effect-jobs/playground-contracts/Routes`           |
| Portable WebSocket schemas and bounds        | `packages/playground-contracts/src/LiveProtocol.ts`       | `@effect-jobs/playground-contracts/LiveProtocol`     |
| Scenario payload schemas                     | `packages/playground-contracts/src/ScenarioPayloads.ts`   | `@effect-jobs/playground-contracts/ScenarioPayloads` |
| Scenario catalog identities                  | `packages/playground-contracts/src/ScenarioCatalogs.ts`   | `@effect-jobs/playground-contracts/ScenarioCatalogs` |
| UI fixture entry, client and HTML            | `apps/playground/tests/fixtures`                          | Explicit fixture build only                          |

The existing `Definitions` contract export still describes the original scenario
command job. It is distinct from `ScenarioPayloads` and `ScenarioCatalogs`.
Worker execution definitions stay in `apps/playground-worker/src/scenarios/Definitions.ts`;
private document keys and codecs stay in the adjacent `PrivateDocument.ts`.
The browser imports portable schemas and catalog identities, never worker source.

Browser module paths under `src` retain their original suffixes: `Client.ts`,
`integration/HttpClient.ts`, `live/BrowserLive.ts`, `features/jobs/**`, `ui/**`
and `styles/Jobs.css`. Fixture modules use their new location under `tests`.
Server module paths retain the suffix beneath `server`, except `Routes.ts`,
which is now a portable package export. All previous contract exports remain.

## Commands and compiler contract

From the repository root, install locked dependencies and prepare the library
and private contracts:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run workspace:prepare
```

```sh
bun run --cwd apps/playground build
bun run site:build
bun run playground:build
bun run playground:fixtures
bun run playground:check
bun run playground:lint
bun run site:check
bun run site:test
bun run site:routes
node apps/website/tests/ui/Production.mjs
```

The first two build commands are independent; `playground:build` assembles
contracts, browser, worker and site for local integration. Fixture compilation
uses the same Vite configuration with explicit modes and produces independent
`FixtureEntry.js` and `BrowserEntry.js` bundles. `UI_BUILD_DIRECTORY` selects an
isolated output directory for existing browser fixtures.

`apps/playground/vite.config.ts` compiles original TypeScript through Vite and
the official StyleX unplugin. It extracts static CSS with runtime injection
disabled, resolving the existing `.js` theme imports directly to TypeScript.
There is no production Babel source mirror or Bun compiler. `build.ts` is a
fixture orchestration entrypoint using Vite's build API. The build rejects worker
imports and production test imports and emits a module inventory for each entry.

The existing app-owned document resets in `Jobs.css` are carried forward.
Component styles remain StyleX. Legacy test compilers retain their dependencies
until the separate test modernization replaces them; those compilers do not
participate in the production browser build.

The site uses `astro.config.ts`, Astro 7.4.2, Starlight 0.42.6 and React 19.3.0.
The compatible React integration is 7.1.5 with `oxc-transform-react` 0.156.0.
Prerendering bundles the React renderer using Vite’s supported environment
configuration, so its virtual options are resolved. An actual SSR/hydration
probe verifies this with extracted StyleX variables. React integration 7.1.6 failed its real config-load probe because its released
helper dependency lacks the requested `renderer` export. No installed baseline
dependency was downgraded to accommodate it. Vite is 8.3.4 and StyleX remains
0.19.1. Library Effect and its peers remain unchanged.

Integration references: [official StyleX Vite guide](https://stylexjs.com/docs/learn/installation/vite/)
and [official Astro React guide](https://docs.astro.build/en/guides/integrations-guide/react/).

## Ownership for subsequent slices

- Runtime/state work owns `apps/playground/src/{Client.ts,live/BrowserLive.ts,integration/HttpClient.ts}`
  and `features/jobs/{Adapter.ts,Atoms.ts,Runtime.ts,Mount.tsx}`.
- Dashboard/UI work owns the remaining `apps/playground/src/{features,ui,styles}`.
  Detail plaintext state remains scoped to its detail component.
- Site work owns public site content/components/styles, retaining no-JS docs.
- Test modernization owns existing `apps/website/tests/**`, worker tests and
  playground fixtures after the foundation handoff. Mechanical path migration
  here preserves their assertions; behavioral test changes belong to that slice.
- Native Alchemy work owns worker runtime composition, including relocated
  `server/live/{PostCommit,Upgrade}.ts`. Foundation moves do not qualify the
  existing platform wrappers as native Alchemy. Native implementation and local
  runtime proof remain prerequisites for the complete integrated delivery.
- Foundation/integration is the sole writer for manifests, lockfiles, root
  scripts, TypeScript/Vite/Astro configuration and CI. Other authors request
  finite edits through their assigned issues.

The typed local asset adapter is `apps/playground-worker/src/assets/StaticAssets.ts`.
Its CSP and reserved-route behavior are unchanged. The legacy guide remains at `apps/website/content/docs/Jobs.html`
because active consumers still serve it. Removing it requires updating those
consumers in the site/test slices.

No source moves authorize a cloud deployment, provisioning, publication or
remote Git operation. Review is performed once on the complete integrated diff,
after all implementation slices and their local gates.
