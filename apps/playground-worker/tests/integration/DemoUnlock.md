The finite synthetic unlock qualification uses one disposable PostgreSQL 16.15
container, real workerd, production browser assets and recorded encrypted payloads.
It never reads the existing preview's private configuration or changes its port.

Build the library, refresh the file dependency, then build contracts/apps:

```sh
bun install --frozen-lockfile
bun run build
bun install --frozen-lockfile
bun run playground:build
mkdir -p .toolchain/demo-unlock
apps/playground-worker/node_modules/.bin/esbuild apps/playground-worker/tests/integration/RepairPg.ts --bundle --platform=node --format=esm --external:effect '--external:effect/*' '--external:effect-jobs/*' --external:pg '--external:node:*' --outfile=.toolchain/demo-unlock/RepairPg.mjs
```

Quote wildcard arguments when entering these commands in shells that expand them.
For the one-time original complaint reproduction, set `DEMO_UNLOCK_BASELINE_ROOT`
to an isolated checkout at accepted base
`a5e7522e54a323c4342cd790c744ad89d7917c19` with its qualified browser/worker
assets and dependencies. Bundle that checkout's `RepairPg.ts` with the same
externals into `.toolchain/demo-unlock/BaselinePg.mjs`. The baseline phase creates
its own schema and private starter, observes both hex fields, and proves `123`
fails. It does not use the baseline preview's database.

```sh
DEMO_UNLOCK_BASELINE_ROOT=/path/to/accepted-checkout python3 apps/playground-worker/tests/integration/DemoUnlockRunOwned.py
```

An already completed baseline reproduction can be consumed by setting
`DEMO_UNLOCK_BASELINE_RECEIPT` to its saved `demo-unlock-receipt.json`; both
baseline asset hashes must still match. This avoids rerunning that completed
reproduction during a focused continuation. Preserve prior receipts before
reusing an output directory. `DEMO_UNLOCK_OUTPUT_DIRECTORY` selects a new one;
place the two bundles there too. WSL uses `docker.exe`; `REPAIR_WSL_INTEROP`
can select an existing working interop socket for this process only.

The final phase covers the initial private encrypted starter, a new private
scenario export, a regular public seeded export and the trusted public showcase.
Stored bytes must equal HTTP encoded payloads; real browser decryption must
match an independent opening of that stored envelope. It checks one **Demo
unlock code** field, `123`, wrong code, collapsed encoded disclosure, drawer close
and navigation relock, empty local/session storage, no plaintext or runtime key
transmission/logging, encrypted plain redrive and immutable source bytes,
encrypted-correction refusal, public mutation refusal and cross-sandbox reads.
The component browser suite additionally covers held decrypt completions,
expiry signals, tampering, generic keys, mobile layout and accessibility.

The wrapper records hashes, versions, exact owned container ID, cleanup and
bounded logs. It removes only its own container and private configuration, and
the browser test disposes its own workerd instances before returning. There is
no production, hosted, crash or soak qualification, and aggregate CI is not implied.

For an owner-invoked fresh preview after handoff, bundle `SchemaEntry.ts` into
`.multica/integration/Migrations.mjs` using the same externals, then run
`DOCKER_BIN=docker.exe PLAYGROUND_PORT=8788 bun run playground:preview` in the
foreground. The owner chooses the final port and switches the existing preview.
Ctrl-C stops the preview and its wrapper removes the exact temporary PG container.
No existing generic encrypted artifacts are rewritten; only newly produced
synthetic examples use the demo catalog.
