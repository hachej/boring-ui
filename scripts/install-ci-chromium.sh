#!/bin/bash
# CI host setup only: use the runner's Chrome libraries, not Playwright's full apt set on every cache hit.
set -euo pipefail

group=
sudo_pid=
apt_config=
cleanup_group() {
  if [[ -n "$group" ]]; then
    # timeout may return when npx exits on TERM while an apt child ignores it. Remove any survivors before retrying.
    kill -KILL -- "-$group" 2>/dev/null || true
    wait "$group" 2>/dev/null || true
    group=
  fi
}
cleanup() {
  if [[ -n "$sudo_pid" ]]; then
    # sudo forwards TERM to the root helper, whose own EXIT trap removes its privileged process group.
    kill -TERM "$sudo_pid" 2>/dev/null || true
    wait "$sudo_pid" 2>/dev/null || true
  fi
  cleanup_group
  if [[ -n "$apt_config" ]]; then rm -f -- "$apt_config"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

attempt() {
  local status=0
  # setsid puts timeout and all its children in one fresh group. Do not put setsid inside timeout: that lets children escape.
  setsid timeout --kill-after=10s 300 "$@" &
  group=$!
  wait "$group" || status=$?
  cleanup_group
  return "$status"
}
retry() {
  if attempt "$@"; then return 0; fi
  echo "::notice::Chromium install failed or timed out; retrying once."
  attempt "$@"
}

if [[ "${1:-}" = --install-deps ]]; then
  version=${2:?Playwright version is required}
  apt_config=$(mktemp -t ci-chromium-apt.XXXXXX)
  # Playwright runs apt-get itself. Its root invocation inherits this option for both initial install and retry.
  printf 'DPkg::Lock::Timeout "120";\n' > "$apt_config"
  retry env "APT_CONFIG=$apt_config" npx --yes "playwright@$version" install-deps chromium-headless-shell
else
  version=${1:?Playwright version is required}
  retry npx --yes "playwright@$version" install chromium-headless-shell
  libraries=$(ldd "${CHROMIUM:?CHROMIUM must name the pinned headless shell}")
  if grep -q 'not found' <<< "$libraries"; then
    printf '%s\n' "$libraries" | grep 'not found'
    # Run the fallback's timeout and cleanup as root too, so they can kill apt/dpkg rather than just their sudo parent.
    sudo -n env "PATH=$PATH" bash "$(realpath -- "${BASH_SOURCE[0]}")" --install-deps "$version" &
    sudo_pid=$!
    wait "$sudo_pid"
    sudo_pid=
    libraries=$(ldd "$CHROMIUM")
    if grep -q 'not found' <<< "$libraries"; then
      printf '%s\n' "$libraries" >&2
      exit 1
    fi
  fi
fi
