# Workspace-local runtime provisioning

Boring UI provisions runtime resources inside the selected workspace. Opening a
workspace through the app shell or `npx @hachej/boring-ui-cli` is intended to be
zero setup: generated skills, package CLIs, SDKs, and starter files appear under
that workspace before the agent runtime is ready.

## Generated layout

All generated state lives under:

```text
$BORING_AGENT_WORKSPACE_ROOT/.boring-agent/
├── .gitignore
├── skills/          # generated mirror of plugin skills
├── node/            # npm prefix for runtime Node CLIs
├── venv/            # Python virtualenv for runtime Python CLIs/SDKs
├── sdk/             # staged local SDK/package sources (sdk/uv = workspace-local uv)
├── cache/           # npm/uv/pip caches
└── tmp/             # staged venvs, tarballs, temp files
```

Provisioning skip state is tracked via ownership markers and fingerprints stored
alongside managed directories (see `runtimeLayout.ts`), not a separate
`fingerprints/` directory.

`.boring-agent` is generated and disposable. Do not hand-edit it; delete it to
force a full local reprovision. The directory writes its own `.gitignore` and
should not be committed.

User-authored skills still belong in `.agents/skills`. Plugin-provided skills
are copied into `.boring-agent/skills/<plugin-id>/<skill-name>` so normal
workspace reads can inspect them. Provisioning never overwrites `.agents/skills`.

## When provisioning runs

Provisioning is synchronous and idempotent:

- workspace/app load runs provisioning before declaring the agent runtime ready;
- CLI project mode provisions the selected project workspace;
- CLI workspaces/global mode provisions the saved selected workspace, not the
  registry directory or home directory;
- `POST /api/v1/agent/reload` reruns provisioning, recopies edited skills,
  reseeds missing files, and refreshes prompt/resources;
- runtime installs are skipped when fingerprints and expected outputs still
  match.

Set `provisionWorkspace: false` to opt out. In that mode Boring UI does not write
`.boring-agent` and no package source copies or installs run.

There is no provisioning job/status/doctor endpoint in this first pass. Failures
surface synchronously with stable `PROVISIONING_*` error codes and structured
logs. Concurrent first-load/reload calls are not locked yet; avoid intentionally
starting multiple provisioning runs for the same workspace at once.

## Package authoring shape

Package metadata uses the existing public namespaces only:

```jsonc
{
  "name": "@example/macro",
  "pi": {
    "skills": ["src/server/workspace-template/.agents/skills/macro-transform"],
    "systemPrompt": "Use bm for macro transforms.",
    "packages": ["npm:pi-web-access"],
    "extensions": []
  },
  "boring": {
    "front": "src/front/index.tsx",
    "server": "src/server/index.ts"
  }
}
```

- `pi.skills` are mirrored into `.boring-agent/skills`.
- `pi.systemPrompt`, `pi.packages`, `pi.extensions`, and prompts remain Pi
  resources and flow through the Pi loader/prompt builder.
- `boring.front` discovers UI contributions.
- `boring.server` discovers trusted server code.

There is no third public manifest namespace for provisioning. Future
workspace-installed plugin declarations are deferred and are not first-pass
behavior.

## Trusted server provisioning

Trusted `boring.server` code can declare runtime provisioning for SDKs,
templates, and environment variables:

```ts
import { defineServerPlugin } from "@hachej/boring-workspace/server"

export default defineServerPlugin({
  id: "boring-macro",
  provisioning: {
    python: [{
      id: "macro-sdk",
      packageName: "boring-macro-sdk",
      projectFile: "src/server/sdk/pyproject.toml",
      expectedBins: ["bm"],
      env: { BORING_MACRO_API_URL: "http://localhost:3000/api/macro" },
    }],
    templateDirs: [{
      id: "macro-template",
      path: "src/server/workspace-template",
    }],
  },
  routes(app) {
    // Macro HTTP/API integration.
  },
  agentTools: [
    // Only trusted server-stateful tools that need DB/API clients/auth.
  ],
})
```

After provisioning, a macro-style workspace has:

```text
.boring-agent/skills/boring-macro/macro-transform/SKILL.md
.boring-agent/venv/bin/bm
.deck/intro.md                         # seeded only if missing
transforms/custom/.gitkeep             # seeded only if missing
```

The harness PATH includes `.boring-agent/venv/bin`, and runtime command env
includes `BORING_MACRO_API_URL`. Existing user files are preserved; templates
copy only missing files.

Regular portable package/runtime plugins should prefer `pi.extensions` or future
portable sandbox-tool declarations instead of `boring.server.agentTools`.

## Runtime-mode consistency

`direct`, `local`/bwrap, and `vercel-sandbox` use the same provisioning engine and
same runtime layout. Mode adapters own transport details:

- direct/local can use local package paths directly;
- Vercel-like adapters turn path-invisible local packages into workspace-visible
  artifact sources;
- adapters choose cache roots and enforce path-safety for workspace file writes.

The shared provisioning engine never calls Vercel APIs, `npm pack`, upload APIs,
or cloud credentials directly.

## Verification commands

Useful smoke/unit checks:

```bash
pnpm --filter @hachej/boring-ui-cli exec vitest run src/__tests__/runtimeProvisioning.test.ts
pnpm --filter @hachej/boring-workspace exec vitest run src/app/server/__tests__/macroRuntimeProvisioning.test.ts
pnpm --filter @hachej/boring-workspace exec vitest run src/server/__tests__/createWorkspaceAgentServer.test.ts --testNamePattern "runtime provisioning reload"
pnpm --filter @hachej/boring-agent exec vitest run src/server/sandbox/vercel-sandbox/__tests__/provisioningAdapter.test.ts
pnpm --filter @hachej/boring-agent exec vitest run src/server/workspace/provisioning/__tests__
```
