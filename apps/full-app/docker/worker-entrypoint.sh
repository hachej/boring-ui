#!/bin/sh
set -eu

worker_uid="10001"
worker_gid="10001"
workspace_root="${BORING_WORKER_WORKSPACE_ROOT:-/data/workspaces}"

mkdir -p "$workspace_root"
chown -R "$worker_uid:$worker_gid" "$workspace_root"

exec setpriv --no-new-privs --reuid="$worker_uid" --regid="$worker_gid" --clear-groups --reset-env \
  /usr/bin/env \
    NODE_ENV="${NODE_ENV:-production}" \
    HOST="${HOST:-::}" \
    PORT="${PORT:-3000}" \
    BORING_WORKER_WORKSPACE_ROOT="$workspace_root" \
    BORING_WORKER_INTERNAL_TOKEN="${BORING_WORKER_INTERNAL_TOKEN:?BORING_WORKER_INTERNAL_TOKEN is required}" \
    BORING_WORKER_EXEC_CONCURRENCY="${BORING_WORKER_EXEC_CONCURRENCY:-2}" \
    BORING_WORKER_BWRAP_NETWORK="${BORING_WORKER_BWRAP_NETWORK:-isolated}" \
    BORING_WORKER_EXEC_CPU_SECONDS="${BORING_WORKER_EXEC_CPU_SECONDS:-30}" \
    BORING_WORKER_EXEC_FILE_SIZE_MIB="${BORING_WORKER_EXEC_FILE_SIZE_MIB:-64}" \
    BORING_WORKER_EXEC_MAX_PROCESSES="${BORING_WORKER_EXEC_MAX_PROCESSES:-512}" \
    BORING_WORKER_EXEC_OPEN_FILES="${BORING_WORKER_EXEC_OPEN_FILES:-256}" \
    BORING_WORKER_EXEC_VIRTUAL_MEMORY_MIB="${BORING_WORKER_EXEC_VIRTUAL_MEMORY_MIB:-1024}" \
    "$@"
