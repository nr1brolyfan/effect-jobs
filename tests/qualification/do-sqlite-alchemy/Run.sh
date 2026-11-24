#!/bin/sh
set -eu

if [ "${ALCHEMY_TEST_DEV:-}" != true ]; then
  echo 'Qualification requires ALCHEMY_TEST_DEV=true' >&2
  exit 2
fi

fixture=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
bun=$(command -v bun)
sandbox=$(mktemp -d /tmp/effect-jobs-alchemy.XXXXXXXX)
cleanup() {
  rm -rf -- "$sandbox"
  test ! -e "$sandbox"
  echo 'Removed isolated Alchemy state and workerd storage'
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

mkdir "$sandbox/home" "$sandbox/tmp"
ln -s "$fixture/node_modules" "$sandbox/node_modules"
cp "$fixture/package.json" "$sandbox/package.json"
cd "$sandbox"

status=0
env -i PATH="$(dirname -- "$bun"):/usr/bin:/bin:/usr/sbin:/sbin" HOME="$sandbox/home" TMPDIR="$sandbox/tmp" \
  CI=true ALCHEMY_TEST_DEV=true ALCHEMY_TELEMETRY_DISABLED=1 \
  JOBS_QUALIFICATION_ROOT="$sandbox" JOBS_QUALIFICATION_FAIL="${JOBS_QUALIFICATION_FAIL:-}" \
  timeout --kill-after=5s 60s unshare -Urnp --fork --kill-child sh -ec 'ip link set lo up; exec "$@"' sh \
  "$bun" --no-env-file "$fixture/node_modules/@alchemy.run/test/bin/alchemy-test.ts" \
  --concurrency 1 --retry 0 "$fixture/Qualification.mts" || status=$?

for log in .alchemy/log/test/*.log; do
  if [ -f "$log" ]; then
    cat "$log"
  fi
done
exit "$status"
