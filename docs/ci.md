# CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on pull requests to
any branch and supports manual dispatch once available on the default branch.
It does not publish, deploy, push changes or modify branch protection. Repository
owners can make `Verify` and `PostgreSQL crash recovery` required checks separately.

## Jobs

- **Verify** installs with the frozen Bun lockfile, then runs `bun run verify`
  (including workspace preparation, types, lint, format, tests, release-import
  checks and API examples). It also runs `playground:check` and `playground:lint`.
  Existing opt-in backend tests remain separate; a green Verify is not evidence
  that every PostgreSQL qualification matrix ran.
- **PostgreSQL crash recovery** installs the isolated fixture with `npm ci`, pulls
  `postgres:16.15-alpine` explicitly, then runs the real-PG Vitest suite with JUnit.
  The suite owns its random loopback-only container and removes it on teardown.
  Missing infrastructure and failed assertions fail the job, not skip it.

Both jobs use ephemeral Ubuntu 24.04 runners, Node **24.15.0** and Bun **1.4.2**.
Third-party actions are pinned to full commit SHAs; comments identify releases.
No repository/application secrets or existing database URLs are required.
The workflow uses `pull_request`, not `pull_request_target`, read-only contents
permission, and checkout without persisted credentials. New runs cancel older
runs for the same PR/ref. Timeouts are 15 minutes for Verify and 10 for integration.

The **30-minute soak is deliberately not part of this PR workflow**. Its
[development harness](../tests/benchmarks/postgresql/README.md) is available through
`bun run soak:postgresql` (plan only) or `bun run soak:postgresql --run` after its
documented setup. No scheduled soak job or manual soak workflow is added here.
Manual dispatch of CI runs the same two jobs. The fast, database-free harness
support tests run through `test:soak` as part of the normal `verify` gate.

## Reports

Verify uploads captured command logs on failure. The integration job uploads its
JUnit report, captured command logs, and available non-secret fixture
`metadata.json`/`resource.json` receipts even on failure. Artifacts expire after
seven days. GitHub's normal step logs remain available for setup failures before
file capture begins; a report cannot be guaranteed if the runner is lost.

Artifact paths are an explicit allowlist under `/tmp/opencode/ci-evidence`.
Never upload entire `/tmp/opencode/effect-jobs-worker-crash-*` directories:
interrupted teardown can leave `postgres.env` or `private.json` credentials there.
JUnit generation does not convert failures into success: all command steps use
Bash `-e -o pipefail`, including pipelines through `tee`.

## Local reproduction

With the pinned tools installed, the Verify job's commands are:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run verify
bun run playground:check
bun run playground:lint
```

For integration, a Linux Docker host is also required:

```sh
bun install --frozen-lockfile --ignore-scripts
npm ci --prefix tests/integration/worker-crash --ignore-scripts --no-audit --no-fund
docker pull postgres:16.15-alpine
mkdir -p /tmp/opencode/ci-evidence
bun run test:postgresql:crash --reporter=default --reporter=junit --outputFile.junit=/tmp/opencode/ci-evidence/worker-crash.junit.xml
```

Do not run other builds/tests in the same checkout while `verify` refreshes its
Bun-installed workspace copies. A local PASS validates these commands, not GitHub
runner setup, permissions or artifact upload. Those need the first hosted run;
adding this file does not authorize a push or workflow dispatch.
