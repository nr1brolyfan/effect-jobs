# Local SQLite Durable Object qualification

Run `ALCHEMY_TEST_DEV=true scripts/qualify-do-sqlite-local.sh` from a checkout
containing the SQLite qualification fixtures. Use one checkout per invocation
because the runner installs dependencies there. The installs use the root Bun
lock and both fixture npm locks, disable lifecycle scripts and reuse local
package caches. A cold cache may require registry and locked artifact access.

The fixture type checks and tests run with a fresh home and an explicit
environment. The native Miniflare test and the Alchemy fixture's npm test
run their workloads in loopback-only network namespaces. The Alchemy npm
script calls its existing `Run.sh`.
Each runtime has a 60-second deadline with a five-second kill grace. On exit,
the runner removes its temporary home and scratch, including any remaining
Alchemy scratch from the invocation. The Alchemy fixture destroys its local
stack, checks that the HTTP listener closed and removes its own scratch.
The PID namespaces bound the lifetime of runtime descendants when a deadline
expires. An uncatchable kill of the outer cleanup shell can leave the top-level
temporary directory behind.

## Reproduce against alpha.4

Run this from a checkout of the runner commit with both Git objects available
locally. The disposable worktree starts at alpha.4 and receives only the four
frozen fixture directories and the runner. The JobStore and drain fixtures
supply source imported by the Alchemy fixture.

```bash
(
  set -euo pipefail
  root=$(git rev-parse --show-toplevel)
  base=6e91de0281b6c7ec036fad74a04c3a387a4b5b61
  fixtures=ffe5c63d5dc4760ff6fe8ca87548cd2b80091a8d
  scratch=$(mktemp -d)
  checkout=$scratch/checkout
  git worktree add --detach "$checkout" "$base"
  trap 'git -C "$root" worktree remove --force "$checkout" && rmdir "$scratch"' EXIT
  git archive "$fixtures" tests/qualification/do-sqlite-{atomicity,alchemy,drain,jobstore} |
    tar -x -C "$checkout"
  cp "$root/scripts/qualify-do-sqlite-local.sh" "$checkout/scripts/"
  cd "$checkout"
  ALCHEMY_TEST_DEV=true bash scripts/qualify-do-sqlite-local.sh
)
```

## Local host and hosted prerequisites

The local toolchain is Linux x86_64 (WSL2 kernel 6.6.87.2), Bash 5.2.21,
Node 24.15.0, npm 11.12.1, Bun 1.4.2, util-linux 2.39.3, GNU coreutils 9.4 and
iproute2 6.1.0. The locks pin native workerd 1.20261006.1 via Miniflare
5.20261006.1-alpha, and workerd 1.20261026.1 via Alchemy 2.0.0-beta.85.

The `DO SQLite qualification` job runs on every pull request and manual CI
dispatch on a [GitHub-hosted Ubuntu 24.04 x64 VM](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
It verifies that the launcher rejects an unset `ALCHEMY_TEST_DEV`, then runs
the same launcher with pinned tools, a writable checkout and temporary
directories, and access to locked artifacts for installation. The runtime
step is bounded by seven minutes and the job by ten. Namespace, guard and
runtime logs are retained as an artifact.

The job probes `unshare -Urnp --fork --kill-child` and brings up loopback
before checkout. [Ubuntu 24.04 can restrict unprivileged user namespaces](https://documentation.ubuntu.com/release-notes/24.04/#security-improvements).
If the probe fails with that restriction enabled, the job loads an AppArmor
profile granting `userns` to the system `/usr/bin/unshare` executable and
repeats the probe. The workflow removes the profile during teardown. The
sysctl stays at its original value, and checkout, installs and both workloads
run as the runner user. The launcher itself repeats the probe before
installing anything and fails if it cannot use the namespace.

Local WSL2 qualification uses the existing unprivileged namespace path.
The GitHub-hosted probe and the conditional AppArmor path require confirmation
from the integrated workflow's hosted run. The historical alpha.4 recipe passed
both fixture type checks, 9 native workerd cases and 1 Alchemy Test.make case.
