# PostgreSQL driver replacement gate

Run `bun run qualify:drizzle:rc6` with Node 24.15.0, Bun 1.4.2, npm, Docker and GNU `timeout`. The gate creates and removes its own loopback-only PostgreSQL container. It does not accept an external database or Cloudflare credentials.

The gate compiles the current `src` against Effect 4.1.3 and Drizzle rc.6. It packs a local candidate with those proposed peer versions, prints the archive SHA-256, and installs the same tarball with normal, strict npm peer resolution into two isolated consumers. The core consumer imports jobs without Drizzle on Node and Bun. The PostgreSQL consumer typechecks its composition and runs transactions on Node, Bun and local `workerd`, each with an empty database. Neither consumer installs `pg`, `@types/pg` or `@effect/sql-pg`. Only the Durable Object alarm/status marker uses DO storage; the job and application rows live in PostgreSQL. The local Hyperdrive binding does not qualify managed Hyperdrive.

Cutover also requires an isolated managed Hyperdrive staging run, the normal packed consumer and repository gates, and migration of the maintained consumers and fixtures. Do not expose the local probe Worker as a public endpoint. No SQLite job storage or public driver-independent transaction interface is implied.

`Rollback.mjs` checks the control-failure contract on real PostgreSQL: an independent session witnesses idle-transaction expiry before the transaction body returns its typed error. The acknowledged-rollback control must return only the original error; the disconnected case must **also** report `PostgreSqlFailure` with `commitKnowledge: "Unknown"`. A missing rollback failure blocks replacement, even when the normal transaction and alarm tests pass.
