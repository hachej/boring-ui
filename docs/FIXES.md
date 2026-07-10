# Fix ledger

Append production/runtime fixes here so recurring incidents have one searchable home. Keep each entry short: symptom, cause, fix, files, and verification.

## 2026-07-06 — Fly full-app `EACCES` creating `/data/pi-sessions/*`

**Symptom**

```txt
EACCES: permission denied, mkdir '/data/pi-sessions/<workspace>_<user>'
```

Seen on `app.enecaapi.ai` when opening/creating an agent chat session.

**Cause**

This path is the host-side Pi session transcript store, not the Vercel sandbox workspace. In `BORING_AGENT_MODE=vercel-sandbox`, shell/files run in the Vercel sandbox, but chat transcripts remain host app user data under `BORING_AGENT_SESSION_ROOT` (normally `/data/pi-sessions`).

The regression was caused by a deployment-hardening/storage interaction:

1. Older images either stored sessions under the container user's home or ran the web process as root, so session directory creation did not hit a mounted-volume ownership boundary.
2. Durable-session work moved Pi transcripts to the Fly volume (`BORING_AGENT_SESSION_ROOT=/data/pi-sessions`) so chat history survives restarts/redeploys.
3. The self-host/Fly image hardening then changed the web image to run as the unprivileged `boring` user (uid/gid `10001`) and attempted `chown -R boring:boring /data` at Docker build time.
4. On Fly, the runtime volume is mounted over `/data`, hiding the build-time `/data` directory and its ownership. The actual mounted volume can still be root-owned, so the unprivileged app cannot create `/data/pi-sessions/<namespace>`.

Per-user session namespaces such as `<workspace>_user_<hash>` made the failure visible at first chat/session creation, but they were not the underlying permission cause.

**Fix**

Add a web entrypoint that starts as root, creates/chowns the writable host roots, then drops privileges before starting Node:

- `apps/full-app/docker/web-entrypoint.sh`
- `apps/full-app/Dockerfile`

The entrypoint repairs:

```txt
BORING_AGENT_WORKSPACE_ROOT=/data/workspaces
BORING_AGENT_SESSION_ROOT=/data/pi-sessions
```

and then runs the app as uid/gid `10001`.

**Verification**

```bash
sh -n apps/full-app/docker/web-entrypoint.sh
```

After deploy, create/open an agent chat session and confirm no `EACCES mkdir /data/pi-sessions/...` appears in logs.

**Do not confuse with**

Missing files under `/data/workspaces/<workspaceId>` in `vercel-sandbox` mode. That host path is only the control-plane anchor; actual agent cwd/files are inside the Vercel sandbox at `/workspace`.
