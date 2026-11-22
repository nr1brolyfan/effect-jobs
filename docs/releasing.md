# Owner release procedure

## Prepared candidate

The current metadata targets **`effect-jobs@0.1.0-alpha.3`**. Treat alpha.3 as
unpublished until the owner completes registry publication and verification.
Alpha.2 is already published with Effect/sql-pg `4.0.5` and the two hash-suffixed
Drizzle snapshots; it is not the current source or a qualification substitute.
The prepared source must be reviewed and integrated before release; this page
does not authorize publishing, Git tags, a GitHub release or deployment.

The release handoff supplies the exact source commit/tree, tarball path, SHA256,
SHA512/integrity, gate results and known limits. Do not publish a different
tarball produced by a later checkout or an automatic version command. Any source
or packed-byte change requires rebuilding and repeating the affected gates.

## Local qualification

Use Node `24.15.0`, Bun `1.4.2`, the frozen dependency locks and disposable
PostgreSQL `16.15`. Follow [CI reproduction](./ci.md) and the full
[release qualification contract](../specs/release-qualification.md).

Build and pack once:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run build
# Set EFFECT_JOBS_ARTIFACT_DIRECTORY to a new stable candidate directory.
bun run release:pack
# Point to the resulting immutable archive; never overwrite it.
export EFFECT_JOBS_ARCHIVE=/absolute/path/to/effect-jobs-0.1.0-alpha.3.tgz
bun run verify
bun run check:postgresql
node scripts/check-release.mjs --metadata-only
```

Consume that same archive with `qualify:docs:readme`, `qualify:release`,
`check:docs:api`, `qualify:api:installed`, `qualify:postgresql:installed`,
`qualify:drizzle:native` and `qualify:drizzle:indexes`. Real-PG gates require
`D6_RESOURCE_DIRECTORY` describing an explicitly owned disposable database;
missing resources and skipped suites are not a passing qualification. Serialize
database fixtures. The only current supported Drizzle pin is `1.0.0-rc.6`;
leave `DRIZZLE_ORM_VERSION` unset or set it to that exact version. The old
hash-suffixed snapshot commands and declaration exceptions are historical only.

No publication command, even `npm publish --dry-run`, is part of the delegated
preparation. Local `npm pack`, installation and dependency-tree checks are used
only by the existing qualification fixtures; they do not publish to the registry.

## Commands reserved for the owner

These are instructions, not commands already executed by the preparation agent.
Only continue after the exact candidate's gates and hosted checks pass and you
have reviewed every NotTested/FAIL item in the handoff.

1. Download/copy the qualified archive and verify its handoff SHA256 locally.
2. Check your npm identity, ownership and whether the version is still free:

   ```sh
   npm whoami --registry=https://registry.npmjs.org
   npm owner ls effect-jobs --registry=https://registry.npmjs.org
   npm view effect-jobs versions dist-tags --json --registry=https://registry.npmjs.org
   ```

3. If authentication is needed, run `npm login` yourself. Do not share tokens or
   OTPs in logs/issues. Stop if `0.1.0-alpha.3` already exists; do not overwrite it
   or silently bump a qualified archive's version.
4. Publish the exact archive, explicitly selecting the prerelease tag:

   ```sh
   npm publish /absolute/path/to/effect-jobs-0.1.0-alpha.3.tgz --ignore-scripts --tag alpha --access public --registry=https://registry.npmjs.org
   ```

5. Verify registry metadata and compare `dist.integrity` to the handoff:

   ```sh
   npm view effect-jobs@0.1.0-alpha.3 version dist.integrity dist.tarball --json --registry=https://registry.npmjs.org
   npm dist-tag ls effect-jobs --registry=https://registry.npmjs.org
   ```

   Confirm `alpha` points to the candidate and `latest` has not changed. A fresh
   normal registry installation is a post-publication gate; a local tarball
   installation does not establish it. In a fresh empty directory, install the
   exact published version normally and import the portable public entrypoint:

   ```sh
   npm init -y
   npm install --ignore-scripts --save-exact effect-jobs@0.1.0-alpha.3 effect@4.1.3 --registry=https://registry.npmjs.org
   npm ls effect-jobs effect
   node --input-type=module -e 'await import("effect-jobs/Job"); console.log("registry import PASS")'
   ```

   Compare the installed version and registry integrity with the handoff. The
   import smoke is not a replacement for the qualified tarball's full gates.

Git tagging/GitHub release and changing documentation from “candidate” to
“published” are separate follow-ups after the actual result is confirmed. Do not
claim registry verification, npm provenance or deployment from a local build.
