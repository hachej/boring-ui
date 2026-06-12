> The boring-ui agent supports multiple runtime modes. Ask it to configure the right one for your deployment.

# Runtime Modes and Provisioning

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

## Runtime cwd contract

Every adapter must preserve this invariant:

```txt
file tree root == shell cwd == model-visible cwd == BORING_AGENT_WORKSPACE_ROOT
```

The shared runtime context is intentionally small:

```ts
interface WorkspaceRuntimeContext {
  runtimeCwd: string
}
```

Adapter rules:

- `Workspace.root` must equal `runtimeContext.runtimeCwd`.
- `Sandbox.runtimeContext.runtimeCwd` must equal the same value.
- Shell tools should default `cwd` to `runtimeCwd`.
- `BORING_AGENT_WORKSPACE_ROOT` and `PWD` should be the same value seen by the model.
- Do **not** rewrite user command strings. Adapters own cwd, env, and mounts; commands must pass through literally.
- Generic agent/provisioning code must not depend on host storage paths or sandbox-internal roots.

Mode-specific roots:

- `direct`: `runtimeCwd` is the real host workspace path.
- `local`/bwrap: `runtimeCwd` is `/workspace`; the host workspace is adapter-private.
- `vercel-sandbox`: `runtimeCwd` is `/workspace`; `/vercel/sandbox` is adapter-private.

Never expose adapter-private paths (host workspace roots for bwrap, `/vercel/sandbox` for Vercel) in model-facing prompts, tool descriptions, or observations.

## `.boring-agent/` runtime layout

Provisioned runtime artifacts live under the workspace-local `.boring-agent/` directory:

```txt
.boring-agent/
  node/      # npm prefix for provisioned node packages (bins at node/node_modules/.bin)
  venv/      # Python virtualenv (console scripts at venv/bin)
  sdk/       # staged local SDK/package sources; sdk/uv holds the workspace-local uv
  skills/    # mirror of plugin skills
  cache/     # npm/uv/pip caches
  tmp/       # staged venvs, tarballs, temp files
```

PATH entries exposed to the harness are `node/node_modules/.bin`, `venv/bin`,
and `sdk/uv/bin` (see `getBoringAgentPathEntries` in
`src/server/workspace/runtimeLayout.ts`). The provisioner writes ownership
markers (`.boring-agent-owned.json`) for managed runtime directories. Do not
hand-edit managed files as an app integration mechanism; declare provisioning
contributions instead.

## Runtime provisioning

Plugins and host apps can contribute runtime setup through `templateDirs[]`, `python[]`, and `nodePackages[]`. Provisioning is fingerprinted and skipped when already materialized; broken or stale runtime artifacts are lazily repaired on the next provision pass. Force reprovision by calling the provisioning API with `force: true` from host code/tests.

### Template files

Use `templateDirs[]` for skills, docs, seeds, starter files, and app-owned workspace content:

```ts
provisioning: {
  templateDirs: [
    {
      id: 'app-template',
      path: new URL('./workspace-template', import.meta.url),
      target: '.',
    },
  ],
}
```

Templates are copied into the runtime workspace. They should not include generated `.boring-agent/` shims or SDK copies.

### Python SDKs and CLIs

Use `python[]` for local Python projects that provide console scripts:

```ts
provisioning: {
  python: [
    {
      id: 'app-sdk',
      projectFile: new URL('./sdk/pyproject.toml', import.meta.url),
      env: {
        APP_API_URL: 'https://example.test/api',
        APP_ASSETS_ROOT: new URL('./sdk/assets/', import.meta.url),
      },
    },
  ],
}
```

The provisioner stages each project under `.boring-agent/sdk/python/<id>`, installs it into `.boring-agent/venv`, and exposes console scripts from `.boring-agent/bin`. File URL env values must point inside the Python project and are converted to runtime-visible SDK paths.

Reserved env keys (`BORING_AGENT_WORKSPACE_ROOT`, `VIRTUAL_ENV`, `HOME`, `PYTHONHOME`) cannot be set by plugins.

### Node packages and CLIs

Use `nodePackages[]` for npm packages or local package roots that should expose bins on PATH:

```ts
provisioning: {
  nodePackages: [
    {
      id: 'boring-ui-cli',
      packageName: '@hachej/boring-ui-cli',
      packageRoot: new URL('../../cli', import.meta.url),
      bins: { 'boring-ui': 'dist/index.js' },
    },
  ],
}
```

Local packages are packed/installed into `.boring-agent/node`; managed bin shims are written to `.boring-agent/bin`. Multiple node packages are installed together so later packages do not prune earlier ones.

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

Vercel model-facing paths should be `/workspace`. Do not expose `/vercel/sandbox` in prompts or observations.

## local (bwrap)

Linux only. Wraps tool execution in a `bubblewrap` sandbox. The workspace root is mounted read-write at `/workspace`; the rest of the filesystem is read-only.

```bash
BORING_AGENT_MODE=local
BORING_AGENT_WORKSPACE_ROOT=/home/ubuntu/projects/my-app
```

The host workspace path is adapter-private. Model-facing cwd, file-tree root, and `BORING_AGENT_WORKSPACE_ROOT` should all be `/workspace`.

## direct

Direct mode runs tools in the host workspace and is intended for trusted local development.

```bash
BORING_AGENT_MODE=direct
BORING_AGENT_WORKSPACE_ROOT=/absolute/path/to/workspace
```

In direct mode, host paths are expected: `runtimeCwd` is the real `BORING_AGENT_WORKSPACE_ROOT`.

## Workspace root

```bash
BORING_AGENT_WORKSPACE_ROOT=/absolute/path/to/workspace
```

When unset, defaults to the current working directory at server start.
