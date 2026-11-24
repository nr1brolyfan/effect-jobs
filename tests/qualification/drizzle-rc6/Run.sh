#!/usr/bin/env bash
# Installed-archive qualification. Both consumers use exactly the same tarball.
# Each runtime gets an empty database on one fresh loopback-only container.
set -eu -o pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
scratch=$(mktemp -d)
id=
cleanup() {
  if [[ -n "$id" ]]; then docker rm -f "$id" >/dev/null; fi
  rm -rf "$scratch"
}
trap cleanup EXIT
if [[ -n "${EFFECT_JOBS_ARCHIVE:-}" ]]; then
  archive=$(realpath "$EFFECT_JOBS_ARCHIVE")
else
  (cd "$root" && bun run build)
  archive=$(EFFECT_JOBS_ARTIFACT_DIRECTORY="$scratch/artifact" node "$root/scripts/pack-release.mjs")
fi
EFFECT_JOBS_ARCHIVE="$archive" node "$root/scripts/check-release.mjs" --metadata-only
mkdir "$scratch/consumer" "$scratch/core"
cd "$scratch/consumer"
cp "$here"/*.mjs "$here"/package*.json .
npm ci --no-audit --no-fund
npm ls --all >/dev/null
cp "$root/tsconfig.json" .
node --input-type=module - "$root" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'
const root = process.argv[2]
const { dependencies } = JSON.parse(readFileSync('package.json'))
writeFileSync('../core/package.json', JSON.stringify({ private: true, type: 'module', dependencies: { effect: dependencies.effect } }))
// Bundle only authored fixtures; all package imports resolve in this consumer.
await build({entryPoints:[`${root}/tests/qualification/drizzle-rc6/Transaction.mjs`],bundle:true,packages:'external',platform:'neutral',tsconfigRaw:{},outfile:'Transaction.mjs',format:'esm',target:'es2022'})
JS
sha256sum "$archive"
for consumer in "$scratch/core" "$scratch/consumer"; do
  (cd "$consumer" && npm install --strict-peer-deps --ignore-scripts --no-audit --no-fund "$archive" && npm ls --all >/dev/null)
done
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
for (const [dir, hasDriver] of [['../core', false], ['.', true]]) {
  const installed = Object.keys(JSON.parse(readFileSync(`${dir}/package-lock.json`)).packages)
  assert(!installed.some(p => /node_modules\/(?:pg|@types\/pg|@effect\/sql-pg)$/.test(p)))
  assert.equal(installed.some(p => p.endsWith('node_modules/drizzle-orm')), hasDriver)
  assert.deepEqual(installed.filter(p => p.endsWith('node_modules/effect')), ['node_modules/effect'])
}
JS
for rt in node bun; do
  (cd "$scratch/core" && "$rt" --input-type=module -e 'import "effect-jobs"; import "effect-jobs/JobProducer"; import "effect-jobs/JobWorker"')
done
cat > Integration.mts <<'TS'
import { Context, Duration, Effect } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { DrizzlePostgresClient, makeWithDefaults } from "drizzle-orm/postgres/effect"
import * as Native from "effect-jobs/PostgreSqlNative"
export const compose = Effect.gen(function* () {
  const client = yield* DrizzlePostgresClient.DrizzlePostgresClient
  const db = yield* makeWithDefaults()
  return { db, adapter: Native.make({ client, operationTimeout: Duration.seconds(3) }) }
})
class Caller extends Context.Service<Caller, string>()("probe/Caller") {}
const ormTransaction = Effect.gen(function* () {
  const db = yield* makeWithDefaults()
  return yield* db.transaction(() => Effect.gen(function* () {
    const name = yield* Caller
    if (!name) return yield* Effect.fail("missing" as const)
    return name
  }))
})
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
export const typedError: Equal<Effect.Error<typeof ormTransaction>, "missing" | SqlError> = true
export const typedServices: Equal<Effect.Services<typeof ormTransaction>, Caller | DrizzlePostgresClient.DrizzlePostgresClient> = true
// @ts-expect-error -- the ORM boundary must not silently widen its error channel to any/unknown.
export const unrelatedError: Effect.Error<typeof ormTransaction> = 0
TS
node -e 'require("node:fs").writeFileSync("tsconfig.consumer.json", JSON.stringify({extends:"./tsconfig.json",include:["Integration.mts"]}))'
./node_modules/.bin/tsc -p tsconfig.consumer.json
sed -e 's|import \* as Pg from "@effect/sql-pg/PgClient"|import { DrizzlePostgresClient as Pg } from "drizzle-orm/postgres/effect"|' -e 's|drizzle-orm/effect-postgres|drizzle-orm/postgres/effect|g' -e 's/Pg\.PgClient/Pg.DrizzlePostgresClient/g' "$here/../drizzle-native/ContractProbes.mts.txt" > Contract.mts
node "$here/CheckContracts.mjs" "$PWD"
export DRIVER_VERSION=$(node --input-type=module -e 'import fs from "node:fs";console.log(JSON.parse(fs.readFileSync(new URL("./package.json",import.meta.resolve("drizzle-orm")))).version)')
pass=$(node -p 'crypto.randomUUID()')
id=$(docker run --rm -d -p 127.0.0.1::5432 -e POSTGRES_PASSWORD="$pass" postgres:16.15-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea -c statement_timeout=5000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=7000)
port=$(docker port "$id" 5432/tcp | cut -d: -f2)
for i in {1..80}; do
  if docker exec "$id" pg_isready -h 127.0.0.1 -U postgres >/dev/null; then break; fi
  sleep 0.25
done
status=0
for rt in node bun workerd; do
  docker exec "$id" createdb -U postgres "$rt"
  export PROBE_URL="postgres://postgres:$pass@127.0.0.1:$port/$rt"
  echo "Testing $rt"
  if [[ "$rt" == workerd ]]; then
    timeout 90 node Workerd.mjs || status=1
  else
    timeout 90 "$rt" --input-type=module -e 'import {qualify, drain} from "./Transaction.mjs"; import {qualifyRollback} from "./Rollback.mjs"; import {DrizzlePostgresClient as Pg} from "drizzle-orm/postgres/effect"; await qualify(process.env.PROBE_URL); await drain(process.env.PROBE_URL); await qualifyRollback(process.env.PROBE_URL, Pg, Pg.DrizzlePostgresClient, process.env.DRIVER_VERSION)' || status=1
  fi
  sessions=$(docker exec "$id" psql -XAt -U postgres -d postgres -c "select count(*) from pg_stat_activity where datname='$rt'")
  if [[ "$sessions" != 0 ]]; then echo "$rt: $sessions database sessions left open" >&2; status=1; fi
done
exit "$status"
