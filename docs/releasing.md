# Owner release procedure

## Prepared candidate

The current metadata targets **`effect-jobs@0.1.0-alpha.6`**. Treat alpha.6 as
unpublished until the owner completes registry publication and verification.
The candidate refreshes the npm README and retains the public runtime and peer
pins from alpha.5. Review and integrate the qualified source before release.
Publication, tagging and deployment require separate authorization.

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
export EFFECT_JOBS_ARCHIVE=/absolute/path/to/effect-jobs-0.1.0-alpha.6.tgz
bun run verify
bun run check:postgresql
node scripts/check-release.mjs --metadata-only
```

Run the [full release qualification](../specs/release-qualification.md).
Use the same archive for all installed checks, including the documented Bun
install, separate npm core and strict declarations, native Drizzle, and the
strict public DO SQLite import and packed Alchemy Worker:

```sh
bun run qualify:docs:readme
bun run qualify:release
ALCHEMY_TEST_DEV=true sh examples/cloudflare-do-sqlite/Run.sh "$EFFECT_JOBS_ARCHIVE"
```

The [Worker example](../examples/cloudflare-do-sqlite/README.md) verifies
same-object commit, rollback with zero partial writes and an explicit drain
that reaches Completed and then Idle. Record strict core, Drizzle same-client
runtime and Drizzle full-declaration results separately. Use only owned,
disposable local PG resources for database qualification.

For the local handoff, compare the shipped JS and declarations, package runtime
metadata, hosted Worker and pinned fixture graph with the inputs of the previous
smoke. If they match, record the original archive digest and the scope of its
historical evidence. Record the actual hosted result for the exact candidate.
A local handoff can be complete with hosted status **NOT RUN**, which is the
current status for alpha.6. UPVE-2890 records the exact alpha.5 hosted PASS.
Alpha.6 requires its own
[hosted smoke](../examples/cloudflare-do-sqlite/README.md#hosted-smoke-before-publication)
under separate authorization, unless the owner explicitly accepts an exception.

No publication command, even `npm publish --dry-run`, is part of the delegated
preparation. Local `npm pack`, installation and dependency-tree checks are used
only by the existing qualification fixtures; they do not publish to the registry.

## Commands reserved for the owner

The owner decides whether to publish after the exact candidate has a hosted
PASS, the remaining required gates are satisfied, and every NotTested/FAIL item
in the handoff has been reviewed. Accepting historical hosted evidence as
equivalent for publication requires a separate, explicit owner decision to
change the exact-candidate hosted PASS requirement.

1. Download/copy the qualified archive and verify its handoff SHA256 locally.
2. Check your npm identity, ownership and whether the version is still free:

   ```sh
   npm whoami --registry=https://registry.npmjs.org
   npm owner ls effect-jobs --registry=https://registry.npmjs.org
   npm view effect-jobs versions dist-tags --json --registry=https://registry.npmjs.org
   ```

3. If authentication is needed, run `npm login` yourself. Do not share tokens or
   OTPs in logs/issues. Stop if `0.1.0-alpha.6` already exists; do not overwrite it
   or silently bump a qualified archive's version.
4. Publish the exact archive, explicitly selecting the prerelease tag:

   ```sh
   npm publish /absolute/path/to/effect-jobs-0.1.0-alpha.6.tgz --ignore-scripts --tag alpha --access public --registry=https://registry.npmjs.org
   ```

5. Verify registry metadata and compare `dist.integrity` to the handoff:

   ```sh
   npm view effect-jobs@0.1.0-alpha.6 version dist.integrity dist.tarball --json --registry=https://registry.npmjs.org
   npm dist-tag ls effect-jobs --registry=https://registry.npmjs.org
   ```

   Confirm `alpha` points to the candidate and `latest` still points to alpha.3. A fresh
   normal registry installation is a post-publication gate; a local tarball
   installation does not establish it. In a fresh empty directory, install the
   exact published version normally and import the portable public entrypoint:

   ```sh
   npm init -y
   npm install --ignore-scripts --save-exact effect-jobs@0.1.0-alpha.6 effect@4.1.3 --registry=https://registry.npmjs.org
   npm ls effect-jobs effect
   node --input-type=module -e 'await import("effect-jobs/Job"); console.log("registry import PASS")'
   ```

   Compare the installed version and registry integrity with the handoff. The
   import smoke is not a replacement for the qualified tarball's full gates.

Git tagging/GitHub release and changing documentation from “candidate” to
“published” are separate follow-ups after the actual result is confirmed. Do not
claim registry verification, npm provenance or deployment from a local build.
