#!/bin/sh
set -eu

if [ "${ALCHEMY_TEST_DEV:-}" != true ]; then
  echo 'Packed example requires ALCHEMY_TEST_DEV=true' >&2
  exit 2
fi
if [ "$#" -ne 1 ]; then
  echo 'Pass one local effect-jobs .tgz' >&2
  exit 2
fi

fixture=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
archive=$(realpath -- "$1")
node=$(command -v node)
npm=$(command -v npm)
bun=$(command -v bun)
[ "$("$node" --version)" = v24.15.0 ]
[ "$("$npm" --version)" = 11.12.1 ]
[ "$("$bun" --version)" = 1.4.2 ]
timeout --kill-after=2s 5s unshare -Urnp --fork --kill-child ip link set lo up

scratch=$(mktemp -d /tmp/effect-jobs-packed-sqlite.XXXXXXXX)
cleanup() {
  rm -rf -- "$scratch"
  test ! -e "$scratch"
  echo 'Removed packed consumer, isolated home and workerd state'
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

mkdir "$scratch/home" "$scratch/tmp"
for file in package.json package-lock.json tsconfig.json Exports.mts Qualification.mts Worker.mts; do
  cp "$fixture/$file" "$scratch"
done
cp "$archive" "$scratch/candidate.tgz"
cd "$scratch"
sha256sum candidate.tgz
node --version
npm --version
bun --version

clean() {
  env -i PATH="$(dirname -- "$node"):$(dirname -- "$npm"):$(dirname -- "$bun"):/usr/bin:/bin" \
    HOME="$scratch/home" TMPDIR="$scratch/tmp" CI=true "$@"
}

# Add just the candidate to the fixture's locked toolchain. Verify the overlay
# before installation and use npm ci to check the archive's recorded integrity.
cp package-lock.json toolchain-lock.json
clean timeout --kill-after=5s 120s "$npm" install --package-lock-only --save-exact \
  --strict-peer-deps --ignore-scripts --no-audit --no-fund ./candidate.tgz
clean "$node" --input-type=module <<'JS'
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { isDeepStrictEqual } from "node:util"

const read = (path) => JSON.parse(readFileSync(path, "utf8"))
const original = read("toolchain-lock.json")
const lock = read("package-lock.json")
const { resolved, integrity } = lock.packages["node_modules/effect-jobs"]
assert.equal(resolved, "file:candidate.tgz")
assert.equal(integrity, "sha512-" + createHash("sha512").update(readFileSync("candidate.tgz")).digest("base64"))
delete lock.packages["node_modules/effect-jobs"]
delete lock.packages[""].dependencies["effect-jobs"]
assert(isDeepStrictEqual(lock, original), "candidate changed the pinned toolchain")
JS
clean timeout --kill-after=5s 120s "$npm" ci --strict-peer-deps --ignore-scripts --no-audit --no-fund
clean "$npm" ls --depth=0
clean timeout --kill-after=5s 60s "$node" node_modules/typescript/bin/tsc -p tsconfig.json
clean timeout --kill-after=5s 60s "$node" node_modules/typescript/bin/tsc --ignoreConfig \
  --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --verbatimModuleSyntax \
  --noEmit --target es2022 --module nodenext --types node Exports.mts
echo 'Strict Worker and Alchemy types PASS. Packed export declarations checked with skipLibCheck=false.'
clean timeout --kill-after=5s 15s unshare -Urnp --fork --kill-child "$node" Exports.mts

status=0
clean ALCHEMY_TEST_DEV=true ALCHEMY_TELEMETRY_DISABLED=1 \
  timeout --kill-after=5s 60s unshare -Urnp --fork --kill-child sh -ec 'ip link set lo up; exec "$@"' sh \
  "$bun" --no-env-file node_modules/@alchemy.run/test/bin/alchemy-test.ts \
  --concurrency 1 --retry 0 ./Qualification.mts || status=$?
for log in .alchemy/log/test/*.log; do
  if [ -f "$log" ]; then
    cat "$log"
  fi
done
exit "$status"
