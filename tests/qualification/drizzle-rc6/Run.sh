#!/usr/bin/env bash
# Isolated source compatibility probe; no published peer ranges are overridden.
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
mkdir "$scratch/consumer" "$scratch/core" "$scratch/candidate"
cd "$scratch/consumer"
cp "$here"/*.mjs "$here"/package*.json .
npm ci --no-audit --no-fund
npm ls --all >/dev/null
# Build a candidate archive from current source with the proposed peer pins.
cp -R "$root/src" .
cp "$root/tsconfig"{,.build}.json .
./node_modules/.bin/tsc -p tsconfig.build.json --outDir "$scratch/candidate/dist"
node --input-type=module - "$root" <<'JS'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'
const root = process.argv[2]
const manifest = JSON.parse(readFileSync(`${root}/package.json`))
const { dependencies } = JSON.parse(readFileSync('package.json'))
manifest.version += '-rc6-probe'
manifest.peerDependencies.effect = dependencies.effect
manifest.peerDependencies['drizzle-orm'] = dependencies['drizzle-orm']
for (const path of manifest.files) {
  if (path !== 'dist') cpSync(join(root, path), join('../candidate', path), { recursive: true })
}
writeFileSync('../candidate/package.json', JSON.stringify(manifest))
writeFileSync('../core/package.json', JSON.stringify({ private: true, type: 'module', dependencies: { effect: dependencies.effect } }))
await build({entryPoints:['Migrations','ReportWorkflow'].map(p=>`${root}/apps/website/examples/docs/${p}.ts`),tsconfigRaw:{},outdir:'.',format:'esm',target:'es2022'})
JS
archive=$(cd "$scratch/candidate" && npm pack --silent --ignore-scripts --pack-destination "$scratch")
archive="$scratch/$archive"
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
import { Duration, Effect } from "effect"
import { DrizzlePostgresClient, makeWithDefaults } from "drizzle-orm/postgres/effect"
import * as Native from "effect-jobs/PostgreSqlNative"
export const compose = Effect.gen(function* () {
  const client = yield* DrizzlePostgresClient.DrizzlePostgresClient
  const db = yield* makeWithDefaults()
  return { db, adapter: Native.make({ client, operationTimeout: Duration.seconds(3) }) }
})
TS
node -e 'require("node:fs").writeFileSync("tsconfig.consumer.json", JSON.stringify({extends:"./tsconfig.json",include:["Integration.mts"]}))'
./node_modules/.bin/tsc -p tsconfig.consumer.json
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
    timeout 90 "$rt" --input-type=module -e 'import {qualify, drain} from "./Transaction.mjs"; import {qualifyRollback} from "./Rollback.mjs"; import {DrizzlePostgresClient as Pg} from "drizzle-orm/postgres/effect"; await qualify(process.env.PROBE_URL); await drain(process.env.PROBE_URL); await qualifyRollback(process.env.PROBE_URL, Pg, Pg.DrizzlePostgresClient)' || status=1
  fi
  sessions=$(docker exec "$id" psql -XAt -U postgres -d postgres -c "select count(*) from pg_stat_activity where datname='$rt'")
  if [[ "$sessions" != 0 ]]; then echo "$rt: $sessions database sessions left open" >&2; status=1; fi
done
exit "$status"
