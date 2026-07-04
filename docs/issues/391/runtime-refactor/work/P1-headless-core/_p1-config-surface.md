# P1 config-surface inventory

Bead: BBP1-001. Scope: ambient env, cwd, home-dir, and file-discovery reads in
`packages/agent/src/server/**`, with adjacent CLI/bin reads called out only when
they explain host ownership. This is an inventory only; no product behavior is
changed in this PR.

## Reproducers

Run from the repo root:

```bash
rtk rg -n "process\\.cwd\\(|process\\.env|getEnv\\(|getEnvSnapshot\\(|setEnvDefault\\(|homedir\\(|tmpdir\\(|workspaces\\.yaml|loadPlugins\\(|SettingsManager\\.create|AuthStorage\\.create|getAgentDir\\(|DefaultResourceLoader" packages/agent/src/server --glob '!**/__tests__/**' --glob '!**/*.test.ts'
rtk rg -n "BORING_[A-Z0-9_]*|VERCEL_[A-Z0-9_]*|INFOMANIAK_[A-Z0-9_]*" packages/agent/src/server --glob '!**/__tests__/**' --glob '!**/*.test.ts'
rtk rg -n "workspaces\\.yaml|BORING_UI_WORKSPACES_PATH|workspacesPath" packages/cli/src packages/cli/README.md packages/agent/src/server --glob '!**/__tests__/**' --glob '!**/*.test.ts'
rtk rg -n "registerAgentRoutes|createAgentApp" packages/cli/src packages/core/src packages/workspace/src packages/agent/src packages/agent/examples
```

False positives in the first command:

- `packages/agent/src/server/runtimeEnvContributions.ts:14,26` names a host-supplied
  `getEnv` callback method; it does not read process env itself.
- `packages/agent/src/server/workspace/provisioning/packArtifact.ts:101` uses
  `tmpdir()` for a temporary archive scratch directory; it is not a config,
  cwd, or discovery input for `createAgent()`.

## Classification

- **A - createAgent config/input:** must become an explicit input to the
  Fastify-free facade or to the adapter-built values passed to it. The facade
  must not read it ambiently.
- **B - host/provider/harness composition:** remains outside the facade. The
  HTTP/CLI/core host, runtime provider, or Pi harness owns the read until the
  later bead that moves/seals that owner.
- **C - test-only/ignore:** not part of the product facade surface.

## Inventory

| File:line | Ambient read / discovery | Current use | Class | Target field or owner |
| --- | --- | --- | --- | --- |
| `packages/agent/src/server/createAgentApp.ts:123` | `opts.workspaceRoot ?? process.cwd()` | Standalone HTTP app workspace/runtime root. | A | HTTP adapter resolves `workspaceRoot`; facade receives explicit runtime/workdir values and never calls `process.cwd()`. |
| `packages/agent/src/server/registerAgentRoutes.ts:352` | `opts.workspaceRoot ?? process.cwd()` | Host-mounted HTTP adapter fallback root. | A | Host/adapter resolves `workspaceRoot`; request-scoped workspaces stay adapter-owned. |
| `packages/agent/src/server/config/workspaceRoot.ts:3-4` | `process.cwd()` default plus `process.env.BORING_AGENT_WORKSPACE_ROOT` | Helper for workspace-root defaults. | B | Host/CLI config parser only; target value is explicit `workspaceRoot`. Do not import this helper from `createAgent()`. |
| `packages/agent/src/server/sandbox/direct/createDirectSandbox.ts:74` | `opts.runtimeContext ?? { runtimeCwd: process.cwd() }` | Direct sandbox fallback runtime cwd. | B | Runtime provider option `runtimeContext`; pure mode must not construct this provider. |
| `packages/agent/src/server/createAgentApp.ts:125` | `opts.templatePath ?? getEnv('BORING_AGENT_TEMPLATE_PATH')` | Template passed to `modeAdapter.create(...)`. | A | Adapter-resolved `templatePath`; facade takes resolved config only. |
| `packages/agent/src/server/registerAgentRoutes.ts:354` | `opts.templatePath ?? getEnv('BORING_AGENT_TEMPLATE_PATH')` | Same template fallback for host-mounted routes. | A | Adapter/host-resolved `templatePath` or request-scoped `getTemplatePath`; no facade env read. |
| `packages/agent/src/server/runtime/resolveMode.ts:26` | `getEnv('BORING_AGENT_MODE')`; also probes `bwrap` in `hasBwrap()` | Built-in runtime auto-detection. | B | Host/adapter supplies `runtime: RuntimeModeAdapter | 'none'` or `runtimeModeAdapter`; P2 moves runtime-mode resolution out of agent. |
| `packages/agent/src/server/config/loadEnv.ts:15,21` | Default `env = process.env` over `EnvSchema` | Generic env parser; no production callers found. | B | Host/bin config parser. If revived, it must stay outside `createAgent()`. |
| `packages/agent/src/server/config/env.ts:1-35` | Central `process.env` helper (`getEnv`, `getEnvSnapshot`, `setEnvDefault`, test mutators) | Existing adapter/provider env access point. | B | Allowed only in hosts/adapters/providers/tests. `createAgent()` must not import this module. |
| `packages/agent/src/server/harness/pi-coding-agent/sessions.ts:44-45,55` | `BORING_AGENT_SESSION_ROOT`; fallback `homedir()/.pi/agent/sessions` | File-backed Pi session root. | A | `sessionStorageRoot` / harness `sessionRoot`; BBP1-004 also makes `SessionCtx.workspaceId` optional and prevents synthetic workspace ids. |
| `packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts:10-12,145,169,173` | Global `~/.pi/agent/extensions`, local `.pi/extensions`, `.pi/extensions.json`, and `node_modules/pi-plugin-*` under `cwd` | Pi plugin/tool discovery. | B | Host/adapter plugin composition. Pure mode skips discovery; discovered tools, when allowed, become explicit `tools` passed to the facade. |
| `packages/agent/src/server/createAgentApp.ts:157` | `loadPlugins({ cwd: workspaceRoot })` gated by `externalPlugins !== false` and strong fs capability | Standalone app Pi plugin discovery. | B | Adapter-owned. Target facade input is explicit `tools`; no facade file discovery. |
| `packages/agent/src/server/registerAgentRoutes.ts:618` | `loadPlugins({ cwd: root })` gated by `externalPlugins !== false` and strong fs capability | Request/workspace-scoped plugin discovery. | B | Adapter-owned, request-scoped. Target facade input is explicit per-binding `tools`. |
| `packages/agent/src/server/registerAgentRoutes.ts:78` | `AuthStorage.create()` through `getAvailableModelProviders()` | Capability metadata for available model providers. | B | Pi/model provider ownership; exposed through adapter readiness/capabilities, not facade env access. |
| `packages/agent/src/server/http/routes/models.ts:48` | `AuthStorage.create()` plus configured model provider reads | `/api/v1/agent/models` model list. | B | HTTP adapter/model route. Pure core should surface model data only through explicit facade/harness state. |
| `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts:444` | `AuthStorage.create()` | Pi-owned auth/model credential discovery. | B | Harness-owned credential source. BBP1-005 decides/seals what pure mode permits. |
| `packages/agent/src/server/models/modelConfig.ts:123-255` | `BORING_AGENT_INFOMANIAK_*`, `INFOMANIAK_API_TOKEN`, `BORING_AGENT_CUSTOM_MODEL_*`, `BORING_AGENT_DEFAULT_MODEL*`; API-key env names can be indirect via `*_API_KEY_ENV` | Registers OpenAI-compatible model providers and default model. | B | Harness/model configuration owner. Do not add facade env fallbacks; pass any non-Pi model config explicitly through host/harness seams if needed. |
| `packages/agent/src/server/models/modelConfig.ts:236` | `SettingsManager.create(process.cwd(), getAgentDir())` | Pi settings fallback for default model. | B | BBP1-005 seal: avoid host cwd leakage in pure mode; likely harness/model-settings option, not an ambient facade read. |
| `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts:220` | `SettingsManager.create(cwd, agentDir)` | Resource settings manager when no Pi packages are configured. | B | Pi resource-loader ownership; pure mode must pass sealed/absent cwd and appropriate Pi options. |
| `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts:490,502` | `getAgentDir()` and `new DefaultResourceLoader({ cwd: opts.cwd, agentDir, ... })` | Pi resources, context files, skills, prompt extensions. | B | BBP1-005 seal via Pi options (`noContextFiles`, `noSkills`, explicit resource paths) and sealed cwd. |
| `packages/agent/src/server/http/routes/skills.ts:78` | `getAgentDir()` with package skill resolution under workspace root | `/api/v1/agent/skills` route package skill listing. | B | HTTP adapter/Pi resource route. Pure mode should expose only host-configured resources. |
| `packages/agent/src/server/sandbox/workspacePythonEnv.ts:30` | `getEnvSnapshot()` | Builds runtime env, PATH, HOME, `BORING_AGENT_WORKSPACE_ROOT`. | B | Runtime/provider env composition. Pure mode does not create a workspace runtime env. |
| `packages/agent/src/server/runtime/modes/provisioningAdapter.ts:86` | `{ ...process.env, ...opts.env }` | Spawn env for provisioning exec. | B | Runtime provisioning adapter; target explicit `env` from host/provider. |
| `packages/agent/src/server/workspace/provisionRuntime.ts:71` | `env: process.env` | Runs provisioning commands with host env. | B | Workspace provisioning owner; not facade-owned. |
| `packages/agent/src/server/workspace/nodeWatcher.ts:77` | `getEnv('BORING_MAX_WATCHED_ENTRIES')` | File watcher entry cap. | B | Workspace/watch adapter config. Pure mode registers no watcher. |
| `packages/agent/src/server/workspace/provisioning/provisionWorkspaceRuntime.ts:217` | `getEnv('BORING_AGENT_UV_BIN')` | Explicit uv binary for Python provisioning. | B | Provisioning/runtime option (`explicitUvBin`); provider/host supplies it. |
| `packages/agent/src/server/runtime/modes/vercel-sandbox.ts:423-426,545-560,653-660` | `VERCEL_OIDC_TOKEN`, `VERCEL_ACCESS_TOKEN`, `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, `BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS`, `BORING_AGENT_VERCEL_SANDBOX_RUNTIME` through `getEnvVar` defaulting to `getEnv` at line 568 | Vercel sandbox provider auth/runtime config. | B | Provider options / P2 `@hachej/boring-sandbox` move. Pure mode never constructs this provider. |
| `packages/agent/src/server/runtime/modes/vercel-sandbox.ts:276` | `setEnvDefault('BORING_AGENT_UV_BIN', VERCEL_UV_BIN)` | Seeds uv path after Vercel runtime bootstrap. | B | Provider/provisioning composition. Should become explicit provider/runtime env output in P2/P5. |
| `packages/agent/src/server/sandbox/vercel-sandbox/periodicSnapshot.ts:4,59` | `BORING_AGENT_SNAPSHOT_KEEP` through `getEnv` default | Snapshot retention count. | B | Vercel provider option; later sandbox package owner. |
| `packages/agent/src/server/sandbox/vercel-sandbox/FileHandleStore.ts:10` | Default store path under `homedir()/.config/boring-agent/sandboxes.json` | Vercel sandbox handle persistence. | B | Provider/store option (`storePath`); later sandbox package owner. |
| `packages/agent/src/server/sandbox/vercel-sandbox/bake.ts:8` | Default cache path under `homedir()/.config/boring-agent/vercel-snapshot-cache.json` | Vercel snapshot bake cache. | B | Provider/cache option; later sandbox package owner. |
| `packages/agent/src/server/runtime/modes/remote-worker.ts:28-29` | `BORING_WORKER_BASE_URL`, `BORING_WORKER_INTERNAL_TOKEN` | Remote-worker runtime adapter config. | B | Existing provider options `baseUrl`/`token`; host must pass values when composing runtime. |
| `packages/agent/src/server/logging.ts:64` | `process.env?.BORING_AGENT_VERBOSE === '1'` | Debug logging verbosity. | B | Host/logger option. The facade should accept configured telemetry/logger state, not read env. |
| `packages/agent/src/server/testing/scriptedPiHarness.ts:339-351` | `BORING_AGENT_E2E_SCRIPTED_PI_TICK_MS`, `BORING_AGENT_E2E_SCRIPTED_PI_TOOL_DELAY_TICKS`, `BORING_AGENT_E2E_SCRIPTED_PI_REASONING_PARTS` | Scripted Pi harness timing for e2e tests. | C | Test-only. |

## Adjacent host-owned reads

These are not `packages/agent/src/server/**` facade leaks, but they explain where
composition already belongs:

| File:line | Read / discovery | Owner |
| --- | --- | --- |
| `packages/agent/src/bin/boring-agent.ts:31,131` | `process.cwd()` default workspace root; `BORING_AGENT_E2E_SCRIPTED_PI` test harness toggle. | Agent CLI/bin host composition. |
| `packages/cli/src/server/localWorkspaces.ts:27-31` | Default `~/.boring-ui/workspaces.yaml`; optional `BORING_UI_WORKSPACES_PATH`. | CLI workspace registry. Confirmed not read by agent server. |
| `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:703-707` | Core app resolves plugin/workspace/session roots and runtime mode from `process.cwd()` / `BORING_AGENT_*`. | Core host composition. |
| `packages/workspace/src/app/server/createWorkspaceAgentServer.ts:827` | Workspace app calls `createAgentApp(...)` with resolved host options. | Workspace host composition. |

## Current HTTP consumers to keep unchanged through P1

`rg -n "registerAgentRoutes|createAgentApp" packages/cli/src packages/core/src packages/workspace/src packages/agent/src packages/agent/examples`
confirms the in-repo runtime composers:

- `packages/cli/src/server/modeApps.ts:671` uses `registerAgentRoutes`.
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:870` uses `registerAgentRoutes`.
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts:827` uses `createAgentApp`.
- `packages/agent/src/bin/boring-agent.ts:125`, `packages/agent/src/server/dev.ts:11`, and
  `packages/agent/examples/with-custom-tool/server.ts:31` use `createAgentApp`.

## BBP1-002/003 config checklist

The facade must receive typed values; it must not import `config/env.ts`,
`config/workspaceRoot.ts`, `runtime/resolveMode.ts`, or the Pi plugin loader.
The first implementation pass should account for these explicit inputs:

- `runtime: RuntimeModeAdapter | 'none'`
- `tools?: AgentTool[]`
- `readinessRequirements?: string[]`
- `harnessFactory?`
- `sessions?`
- `systemPromptAppend?`
- `systemPromptDynamic?`
- `telemetry?`
- `metering?`
- `sessionStorageRoot?`
- adapter/provider-resolved `workspaceRoot` / `workdir` / runtime bundle values when
  `runtime !== 'none'`
- adapter/provider-resolved `templatePath` where the selected runtime needs it

No unknown ambient read remains from the non-test server-source scan above. The
provider/harness rows marked **B** are intentionally not facade config unless the
owning later bead (BBP1-005, P2, or P5) turns them into explicit provider/harness
options.
