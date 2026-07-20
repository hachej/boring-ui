#!/bin/sh
set -eu

app_uid="10001"
app_gid="10001"
workspace_root="${BORING_AGENT_WORKSPACE_ROOT:-/data/workspaces}"
session_root="${BORING_AGENT_SESSION_ROOT:-/data/pi-sessions}"

# A host may mount a volume over /data at runtime, so Dockerfile-time chown
# does not apply to the mounted filesystem. Repair the writable agent roots before
# dropping privileges; otherwise Pi session creation fails with EACCES.
mkdir -p "$workspace_root" "$session_root"
chown -R "$app_uid:$app_gid" "$workspace_root" "$session_root"

exec setpriv --no-new-privs --reuid="$app_uid" --regid="$app_gid" --clear-groups "$@"
