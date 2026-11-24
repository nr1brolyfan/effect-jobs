# Local Alchemy SQLite Durable Object qualification

Use Linux with user, network and PID namespaces enabled, `unshare`, `ip` and GNU
`timeout`. The tested toolchain is Node 24.15.0, npm 11.12.1 and Bun 1.4.2.
Install from the repository root, then run:

```sh
bun install --frozen-lockfile --ignore-scripts
fixture=tests/qualification/do-sqlite-alchemy
npm ci --prefix "$fixture" --ignore-scripts --no-audit --no-fund
npm run --prefix "$fixture" check
ALCHEMY_TEST_DEV=true npm test --prefix "$fixture"
ALCHEMY_TEST_DEV=true npm test --prefix "$fixture"
```

Each invocation uses a new process, working directory, home, Alchemy file state
and workerd storage. The runner admits only its explicit environment, disables
telemetry and Bun dotenv loading, and enables only loopback in the child network
namespace. The PID namespace bounds the lifetime of the sidecar and workerd even
if the outer deadline terminates the run. Package installation is a separate
step. The fixture lock pins Alchemy, `@alchemy.run/test`, the Cloudflare provider
and its runtime to 2.0.0-beta.85, Effect to 4.1.3, and workerd to 1.20261026.1.

The harness uses `Test.make` with the default RPC sidecar and the real provider.
The pinned provider's local account lookup uses its built-in fallback under
`CI=true` when no account ID is supplied. The Worker uses Alchemy's built-in
Rolldown pipeline and a native SQLite namespace. The host validates the provider
URL and sends HTTP to the literal loopback address with redirects disabled.
HTTP requests have a five-second deadline. The test and destroy hook are bounded
separately, with a 60-second process deadline and five-second kill grace.

One deployment starts with empty domain and job tables. The producer's joined
native transaction inserts the invoice, job and payload. Separate requests
observe the Pending job and confirm that Layer assembly alone invokes no
handler. One explicit drain allows one claim and one recovery candidate. An
independent state request checks the actual handler input, a separate SQLite
delivery row, and the fenced Complete transition with one finalized attempt.

The following controls should exit nonzero. The first exits at the launcher
guard. The second fails after the state assertions and still reports successful
stack destruction, a closed listener and removal of the temporary directory.

```sh
ALCHEMY_TEST_DEV=false npm test --prefix "$fixture"
ALCHEMY_TEST_DEV=true JOBS_QUALIFICATION_FAIL=true npm test --prefix "$fixture"
```

The fixture owns the domain schema and uses the shared internal SQLite adapter. The delivery writes a
synthetic row without calling an external provider. This probe covers one local
success path and graceful teardown. Hosted provisioning, remote bindings, crash
durability, concurrency, recovery of an expired lease, exactly-once effects and
production receipt policy are outside its scope. The dependent SQLite suites
exercise their own atomicity, storage and restart boundaries.
