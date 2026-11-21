# PostgreSQL driver replacement gate

Run `bun run qualify:drizzle:rc6` with Node 24.15.0, Bun 1.4.2, npm, Docker and GNU `timeout`. The gate creates and removes its own loopback-only PostgreSQL container. It does not accept an external database or Cloudflare credentials.

The isolated npm graph compiles the current `src` against Effect 4.1.3 and Drizzle rc.6 and exercises those bytes without `pg` or `@effect/sql-pg`. This is a source compatibility gate, not a test of the current release's packed peer ranges. Node, Bun and a bundled local `workerd` each get an empty database. Only the Durable Object alarm/status marker uses DO storage; the job and application rows live in PostgreSQL. The local Hyperdrive binding does not qualify managed Hyperdrive.

Cutover also requires an isolated managed Hyperdrive staging run, the normal packed consumer and repository gates, and migration of the maintained consumers and fixtures. Do not expose the local probe Worker as a public endpoint. No SQLite job storage or public driver-independent transaction interface is implied.
