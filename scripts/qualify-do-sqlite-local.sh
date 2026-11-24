#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$*" >&2
  exit 2
}

[[ ${ALCHEMY_TEST_DEV:-} == true ]] || fail 'Qualification requires ALCHEMY_TEST_DEV=true'
[[ $(uname -s) == Linux ]] || fail 'Qualification requires Linux'

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
atomicity=tests/qualification/do-sqlite-atomicity
alchemy=tests/qualification/do-sqlite-alchemy

for file in bun.lock "$atomicity/package-lock.json" "$alchemy/package-lock.json" "$alchemy/Run.sh"; do
  [[ -f $file ]] || fail "Missing qualification input: $file"
done

for tool in bun node npm timeout unshare ip sh env dirname mktemp mkdir rm ln cp cat; do
  command -v "$tool" >/dev/null || fail "Missing required tool: $tool"
done

bun_dir=$(dirname -- "$(command -v bun)")
node_dir=$(dirname -- "$(command -v node)")
npm_dir=$(dirname -- "$(command -v npm)")
system_path=/usr/bin:/bin:/usr/sbin:/sbin
runtime_path=$node_dir:$npm_dir:$bun_dir:$system_path

bun_version=$(bun --version)
node_version=$(node --version)
npm_version=$(npm --version)
printf 'Qualification toolchain: Bun %s, Node %s, npm %s\n' "$bun_version" "$node_version" "$npm_version"
[[ $bun_version == 1.4.2 && $node_version == v24.15.0 && $npm_version == 11.12.1 ]] ||
  fail 'Expected Bun 1.4.2, Node v24.15.0 and npm 11.12.1'

# Use the same namespace flags and system tool paths as the Alchemy launcher.
PATH=$system_path timeout --verbose --kill-after=5s 5s unshare -Urnp --fork --kill-child \
  sh -ec 'ip link set lo up; ip -brief link show' ||
  fail 'Cannot create user/PID/network namespaces and enable loopback. Check host policy.'

bun install --frozen-lockfile --ignore-scripts
for fixture in "$atomicity" "$alchemy"; do
  npm ci --prefix "$fixture" --ignore-scripts --no-audit --no-fund --prefer-offline
done

sandbox=$(mktemp -d /tmp/effect-jobs-do-sqlite.XXXXXXXX)
cleanup() {
  if ! rm -rf -- "$sandbox" || [[ -e $sandbox ]]; then
    printf 'Failed to remove qualification scratch directory: %s\n' "$sandbox" >&2
    exit 1
  fi
  printf '%s\n' 'Removed isolated qualification home and native workerd scratch'
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -- "$sandbox/home" "$sandbox/tmp"

clean_env=(
  env -i "PATH=$runtime_path" "HOME=$sandbox/home" "TMPDIR=$sandbox/tmp" CI=true
  npm_config_globalconfig=/dev/null
)

for fixture in "$atomicity" "$alchemy"; do
  "${clean_env[@]}" npm run --prefix "$fixture" check
done

printf '%s\n' 'Qualifying native workerd via Miniflare'
"${clean_env[@]}" timeout --verbose --kill-after=5s 60s unshare -Urnp --fork --kill-child \
  sh -ec 'ip link set lo up; exec "$@"' sh npm test --prefix "$atomicity"

printf '%s\n' 'Qualifying local Alchemy Test.make'
"${clean_env[@]}" ALCHEMY_TEST_DEV=true npm test --prefix "$alchemy"
