# Deployment Workflow

This doc describes the intended production deployment flow for app shells that compose
`@hachej/boring-core`, `@hachej/boring-workspace`, and `@hachej/boring-agent`.

Status: forward-looking design. Ownership boundaries and the workspace-provisioning
flow are implemented today. The deployment-snapshot release pipeline (`release.ts`,
core snapshot store) is a target shape — `apps/full-app/fly.toml` currently runs
`migrate.js` as its release command, not `release.js`. Sections marked "Target" /
"Recommended" / "milestones" are not shipped yet.

Example today: `apps/full-app` deploys to Fly.io with `BORING_AGENT_MODE=vercel-sandbox`.

## Ownership

- `@hachej/boring-agent` owns runtime execution primitives:
  - direct/local/vercel sandbox adapters
  - deployment snapshot provider adapters
  - workspace runtime provisioning execution
- `@hachej/boring-workspace` owns plugin interpretation:
  - server plugins declare provisioning needs
  - workspace normalizes plugin declarations into agent provisioning contributions
- `@hachej/boring-core` owns durable app/platform records:
  - workspaces, members, auth, settings
  - runtime/sandbox handle records
  - deployment snapshot records
- app shells own deployment composition:
  - CI workflow
  - provider secrets
  - release command wiring

## Current full-app deployment

`apps/full-app` currently ships with:

- `apps/full-app/Dockerfile`
- `apps/full-app/fly.toml`
- post-deploy smoke workflow: `.github/workflows/post-deploy-smoke.yml`

Runtime image:

```txt
node:20-slim
bubblewrap ca-certificates
BORING_AGENT_MODE=vercel-sandbox
FULL_APP_WORKSPACE_ROOT=/data/workspaces
```

Fly release command currently runs migrations:

```toml
[deploy]
release_command = "node apps/full-app/dist/server/migrate.js"
```

Target shape: replace that with one release entrypoint that runs all deploy-time work.

```toml
[deploy]
release_command = "node apps/full-app/dist/server/release.js"
```

## Target CI-driven flow

Deployment should ultimately be driven by CI, not a developer laptop.

```txt
GitHub Actions
  -> build/test/typecheck
  -> build Docker image
  -> deploy to Fly
  -> Fly release command runs deploy-time setup
  -> smoke deployed URL
```

Recommended steps:

1. Typecheck and test packages.
2. Build app image.
3. Deploy image to Fly.
4. Release command runs:
   - database migrations
   - Vercel deployment snapshot preparation
   - durable snapshot record update in core
5. App machines start.
6. Post-deploy smoke validates health/auth/workspace/agent.

## Deploy-time snapshot setup

Deployment snapshots are runtime base layers. They are not workspace content.

Use snapshots for things every sandbox should already have:

- `uv`
- Python runtime tooling
- common system tools (`git`, `ripgrep`, etc.)
- warm package caches, if useful

Do **not** use deployment snapshots for user workspace files:

- `.agents/skills`
- starter docs/decks
- plugin SDK source
- user-editable files

Those belong to workspace runtime provisioning.

### Snapshot build is command-list based

No tarball is needed for deploy-time snapshot builds.

The snapshot workflow is:

```txt
create provider sandbox from base runtime
run setup commands
snapshot sandbox
store snapshot id + recipe hash
```

Example target recipe shape:

```ts
const recipe = {
  runtime: "python3.13",
  includeUv: true,
  systemPackages: ["git", "ripgrep"],
  setupCommands: [
    "python3 -m pip install --upgrade uv",
    "uv --version",
  ],
}
```

Note: this is the desired release-script contract. The exact helper name/API may change while the snapshot workflow is implemented.

Provider adapter execution:

```ts
const sandbox = await vercel.create({ runtime: recipe.runtime })
for (const command of recipe.setupCommands) {
  await sandbox.runCommand("sh", ["-lc", command])
}
const { snapshotId } = await sandbox.snapshot()
```

The recipe hash should include runtime, system packages, Python packages, and setup commands.
The release entrypoint (`apps/full-app/src/server/release.ts`) should compute this hash, look up an existing ready core snapshot record, and skip provider snapshot creation when the hash already has a reusable snapshot.

## Workspace runtime provisioning

Workspace provisioning happens at app/runtime composition time, before the agent starts.

```txt
plugin declares provisioning
  -> workspace collects declarations
  -> agent executes provisioning
```

Example plugin declaration:

```ts
provisioning: {
  templateDirs: [
    { id: "macro-template", path: new URL("./workspace-template", import.meta.url) },
  ],
  python: [
    {
      id: "macro-sdk",
      projectFile: new URL("./sdk/pyproject.toml", import.meta.url),
      env: {
        BORING_MACRO_BUILTINS_ROOT: new URL("./transforms/builtins", import.meta.url),
      },
    },
  ],
}
```

Workspace server composition:

```ts
const pluginCollection = collectWorkspaceAgentServerPlugins({ plugins, workspaceRoot })

await provisionWorkspaceAgentServer({
  workspaceRoot,
  provisioningContributions: pluginCollection.provisioningContributions,
})
```

Agent execution:

```ts
await provisionRuntimeWorkspace({
  workspaceRoot,
  contributions,
})
```

Provisioning is conditional and idempotent:

- no plugin provisioning contributions: no-op
- matching `.boring-agent/state/provisioning.json` fingerprint: skip (legacy `.boring-agent/provisioning.json` is read during migration)
- changed fingerprint or forced provisioning: run setup again

## Core snapshot records

Core currently stores sandbox/runtime handle metadata such as `sandboxSnapshotId`. The target workflow needs a fuller durable deployment snapshot record so release jobs can reuse snapshots by recipe hash.

Target record shape:

```ts
interface RuntimeSnapshotRecord {
  id: string
  provider: "vercel-sandbox" | string
  recipeHash: string
  providerSnapshotId: string
  runtime: string
  status: "creating" | "ready" | "failed" | "retired"
  createdAt: string
  updatedAt: string
  metadata?: Record<string, unknown>
}
```

Workspace runtime/sandbox records should also remember which snapshot started them:

```ts
interface WorkspaceRuntimeRecord {
  workspaceId: string
  provider: string
  sandboxId: string
  snapshotRecordId?: string
  providerSnapshotId?: string
  provisioningFingerprint?: string
  createdAt: string
  lastUsedAt: string
}
```

This allows audit/debug questions like:

- Which snapshot did workspace `abc` boot from?
- Which deploy introduced snapshot `snap_x`?
- Which workspaces still run on a retired snapshot?

## Runtime startup with snapshots

At runtime, app/core should resolve the current ready snapshot and pass it into the agent's Vercel sandbox adapter.

```txt
core snapshot store
  -> current ready vercel-sandbox snapshot
  -> agent Vercel adapter creates sandbox from snapshot
  -> workspace plugin provisioning runs per workspace
```

Important distinction:

```txt
deployment snapshot = base runtime image
workspace provisioning = workspace-specific files/SDK/shims
```

## CI environment/secrets

CI/release needs provider credentials:

```txt
VERCEL_TOKEN or VERCEL_ACCESS_TOKEN or VERCEL_OIDC_TOKEN
VERCEL_TEAM_ID
VERCEL_PROJECT_ID optional but recommended
```

Vercel Blob / tarball credentials are not required for deploy-time snapshot builds. If a future app chooses bulk workspace template seeding through Blob tarballs, document that app-specific credential separately from the snapshot workflow.

Model eval/smoke jobs may need:

```txt
OPENROUTER_API_KEY
ANTHROPIC_API_KEY or OPENAI_API_KEY if using those providers
```

## Post-deploy smoke

After deploy, CI should run `apps/full-app/scripts/post-deploy-smoke.ts` and eventually add an agent runtime smoke.

Minimum checks:

1. `/health` returns ok.
2. auth/signup flow works.
3. workspace route loads.
4. agent capabilities endpoint works.
5. Vercel sandbox starts from the current snapshot.
6. In the sandbox, `uv --version` succeeds.
7. If the deployed app includes a concrete provisioned plugin, run that plugin's known smoke command (for example, macro's `bm list` should report builtin transforms).

`@hachej/boring-agent` already has package-level evals for fixture provisioning:

```sh
pnpm --filter @hachej/boring-agent eval:provisioning
pnpm --filter @hachej/boring-agent eval:provisioning:agent
pnpm --filter @hachej/boring-agent eval:provisioning:agent:vercel
```

The Vercel eval validates a live sandbox with fixture SDK/template setup and a real agent turn.

## Implementation milestones

1. Add `apps/full-app/src/server/release.ts`:
   - run migrations
   - prepare deployment snapshot
   - persist snapshot record
2. Add core snapshot store/table.
3. Add agent Vercel adapter option/env for startup snapshot id.
4. Wire `createCoreWorkspaceAgentServer` to resolve current snapshot and pass it to agent runtime.
5. Extend post-deploy smoke to verify snapshot-backed sandbox boot.
6. Move deployment to CI as the canonical path.

## Non-goals

- Do not put plugin/user workspace files into the deploy-time snapshot.
- Do not make core execute provider-specific snapshot commands directly.
- Do not make workspace install SDKs itself.
- Do not make agent understand full UI plugin objects.
