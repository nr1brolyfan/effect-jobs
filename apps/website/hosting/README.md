The docs use the pinned Alchemy beta.85 native `Cloudflare.Website.Astro`
provider in static mode. Run all hosting commands under Node 24.15.0: the
existing StyleX media-query parser does not support the Bun build child.

From the repository root:

```sh
bun run --cwd apps/website hosting:build
bun run --cwd apps/website hosting:check
bun run --cwd apps/website hosting:test
```

`hosting:build` invokes the same native source provider as the stack and asserts
that it produces no runtime bundle. Only `apps/website/dist/hosting/client` is
public. The sibling server build, source, configuration and evidence are never
uploaded. The ordinary `site:build` continues to produce `dist/site` for the
existing site qualification. The hosting build uses a separate output directory so these checks do not replace
its qualified assets.

The build integration links the existing shared StyleX extraction stylesheet on
every page, including pages without illustrations, then derives the script CSP
hashes from final HTML. Pagefind
requires `wasm-unsafe-eval`; Starlight/Expressive Code require inline styles.
No inline script wildcard or JavaScript `unsafe-eval` is permitted. HTML and
search assets revalidate; hashed Astro assets have immutable caching. Unknown
paths use the generated 404, including private/API routes.

After local qualification and independent review, the authorized operator runs
from `apps/website` using the explicit production stage and default profile:

```sh
node ../../node_modules/alchemy/bin/cli.js deploy --stage production --profile default
```

Invoke this directly from the shell, not through a Bun script: Alchemy's CLI
otherwise hands its process back to Bun. Deployment state and logs remain in
`apps/website/.alchemy` inside this worktree. Protect and retain that state;
do not attach it blindly or put it in the public asset directory.

The stack owns one assets-only Worker, `effect-jobs-docs-production`, and its
`effect-jobs.dev` custom-domain binding. It verifies the connected account and
rejects other stages. It disables workers.dev URLs and previews, creates no
zone, sessions, database or other service. Recheck exact zone, apex DNS, routes,
Worker name and domain collisions immediately before the first deployment.
Do not adopt an existing resource or overwrite unrelated DNS.

After a first deployment, record exact created IDs and a sanitized DNS inventory.
If rollback is necessary, inspect the same stack's destroy plan, verify that it
contains only this Worker and its new domain binding, then destroy using the
same directory, profile and production stage. Keep state until completion and
verify removal of only those IDs. Never delete/adopt the zone or clear state as
a rollback shortcut. For an update, restore the prior qualified source/assets
and redeploy that exact stack; retain the prior artifact before changing it.
