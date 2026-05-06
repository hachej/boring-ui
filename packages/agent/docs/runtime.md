> The boring-ui agent supports multiple runtime modes. Ask it to configure the right one for your deployment.

# Runtime Modes

The agent supports three execution modes controlling how `bash` and filesystem tools run.

## Modes

| mode | description | use when |
|---|---|---|
| `direct` | tools run directly in the host process | local dev, trusted environments |
| `local` | tools run in a `bwrap` sandbox (Linux only) | self-hosted, untrusted input |
| `vercel-sandbox` | tools run in Vercel Firecracker microVMs | production on Vercel |

Set via env var:

```bash
BORING_AGENT_MODE=vercel-sandbox
```

Defaults to `direct` when unset.

## vercel-sandbox

Each workspace session gets its own Firecracker microVM. Files and shell state persist across turns within a session. Snapshots are taken every 10 minutes.

```bash
BORING_AGENT_MODE=vercel-sandbox
VERCEL_TEAM_ID=team_...
VERCEL_PROJECT_ID=prj_...
# production: uses Vercel OIDC automatically
# local emulation: set VERCEL_TOKEN
```

Sandbox lifetime:
```bash
BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS=2700000  # max 2700000ms (Vercel limit)
BORING_AGENT_SNAPSHOT_KEEP=2                    # retained snapshots per workspace
```

## local (bwrap)

Linux only. Wraps tool execution in a `bubblewrap` sandbox. The workspace root is mounted read-write; the rest of the filesystem is read-only.

```bash
BORING_AGENT_MODE=local
BORING_AGENT_WORKSPACE_ROOT=/home/ubuntu/projects/my-app
```

## Workspace root

```bash
BORING_AGENT_WORKSPACE_ROOT=/absolute/path/to/workspace
```

When unset, defaults to the current working directory at server start.
