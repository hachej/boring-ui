# P1 Pi Harness Audit - BBP1-005

Scope: `createPiCodingAgentHarness`, Pi session storage, resource loading, plugin discovery, and prompt construction for `runtime: 'none'`.

Decision: sealed Pi harness, not a second harness. Pure mode still uses `createPiCodingAgentHarness`, but it receives only a sealed virtual cwd and headless Pi defaults. If a host wants workspace resources, it must use a workspace runtime path, not pure mode.

## Seals Landed

- `createAgent({ runtime: 'none' })` builds a sealed cwd through `createPureRuntimeCwd(sessionStorageRoot)` and passes it as both `cwd` and `runtimeCwd`; transcript storage receives `sessionStorageCwd: ''` plus `sessionRoot` so it does not derive storage from a host cwd (`packages/agent/src/server/createAgent.ts`).
- Pure-mode default Pi construction uses `withPurePiHarnessDefaults()`, which forces `noExtensions: true`, `noContextFiles: true`, `noSkills: true`, `noPromptTemplates: true`, `noThemes: true`, and `systemPromptMode: 'headless'` (`packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`).
- Headless `systemPromptMode` bypasses Pi's `DefaultResourceLoader` entirely and uses an in-memory resource loader with empty skills, prompts, themes, context files, and path extensions. It loads only trusted in-process extension factories already supplied by the harness code or host.
- Pure HTTP adapters (`createAgentApp`, `registerAgentRoutes`) also use `withPurePiHarnessDefaults()`, so request-scoped pure bindings cannot opt into ambient AGENTS.md or global skill discovery by accident.
- Headless prompt mode replaces Pi's ambient/default base prompt with a minimal pure prompt, suppresses Boring's workspace/file/Python prompt addenda, ignores Pi-discovered append prompts, and installs a `before_agent_start` extension that removes Pi's final `Current working directory:` line from the model-visible prompt. Workspace runtimes keep the old guidance.

## Findings

| Suspect | Verdict | Evidence / seal |
| --- | --- | --- |
| Session JSONL location | Sealed for pure mode. | `PiSessionStore` still supports `BORING_AGENT_SESSION_ROOT` for legacy/default storage, but pure mode passes explicit `sessionRoot` and `sessionStorageCwd: ''`; with an explicit root and empty storage cwd, the store roots directly under `sessionStorageRoot` instead of a cwd-derived directory. |
| `SessionManager.create(runtimeCwd, nativeSessionDir)` | Sealed for pure mode. | `runtimeCwd` is the sealed `.runtime-none` directory, not `ctx.workdir`; the BBP1-005 spy test passes `ctx.workdir = process.cwd()` and asserts Pi receives the sealed cwd. |
| `.pi` extension loading | Gated off in pure mode. | Plugin discovery remains in `pluginLoader.ts` for workspace modes, but pure-mode adapter paths do not call `loadPlugins({ cwd })`. Headless mode does not instantiate `DefaultResourceLoader`, so it does not run Pi package/resource discovery. It loads only trusted in-process `extensionFactories`; pure defaults do not discover workspace `.pi/extensions`, `.pi/extensions.json`, npm plugins, package extensions, or global extension files. |
| AGENTS.md / CLAUDE.md context files | Sealed for pure mode. | Headless mode's in-memory resource loader returns no context files and never calls Pi context-file discovery. The prompt snapshot test asserts no `AGENTS.md` text appears. |
| Skills and global skill dirs | Sealed by default. | Headless mode's in-memory resource loader returns no skills and never scans user-global `~/.pi/agent/skills` or `~/.agents/skills`. |
| Prompt templates and themes | Sealed for pure mode. | Headless mode's in-memory resource loader returns no prompt templates or themes and never runs Pi package/resource discovery. Prompt-template discovery can otherwise rewrite slash-prefixed user input from ambient Pi resources. Themes are not needed for headless turns and are disabled with the same ambient-resource seal. |
| Model registry and auth files | Allowed as Pi-owned trust boundary; resource cwd sealed. | `AuthStorage.create()` and model registry setup remain Pi-owned credential/settings reads. Pure mode no longer calls `getAgentDir()` for resource loading and does not construct a file-backed resource `SettingsManager`; this keeps host workspace and user resource settings out while preserving Pi credential ownership. |
| System prompt cwd/workspace/file-tool leakage | Sealed for pure mode. | `systemPromptMode: 'headless'` replaces Pi's ambient/default base prompt with a minimal pure prompt, omits the workspace path and Python runtime addenda, ignores Pi-discovered append prompts, and the headless prompt extension strips Pi's cwd line before the model turn. The snapshot test asserts no host cwd, sealed cwd, `Current working directory:`, `Workspace paths`, `AGENTS.md`, `SYSTEM.md`, `APPEND_SYSTEM.md`, `read/edit/write`, `find/grep/ls`, or `uv pip install`. |
| Compaction | No file-tool dependency found. | Session compaction in `PiSessionStore` operates on JSONL transcript records and linked native Pi session files under the session store. It does not call file tools or require a workspace root. |
| Session identity | Does not require workspace root. | `SessionCtx.workspaceId` may be absent. Pure sessions persist `boringSessionCtx: {}` and are scoped by the configured session root; existing tests round-trip create/list/load/delete without synthesizing `workspaceId`. |

## Tests

- `packages/agent/src/server/harness/pi-coding-agent/__tests__/runtimeCwd.test.ts`
  - `constructs the default pure Pi harness without host cwd or ambient resources`
  - `snapshots the pure-mode system prompt seal`
- Existing pure session tests in `packages/agent/src/server/harness/pi-coding-agent/__tests__/createHarness.test.ts` continue to cover storage under `sessionRoot` without synthesized `workspaceId`.
- Existing `packages/agent/src/server/__tests__/createAgent.test.ts` pure-mode tests continue to cover sealed harness input for custom factories and rejection of filesystem attachments.

## Reproducers

Focused seal test:

```bash
TMPDIR=/home/ubuntu/tmp-boring-vitest pnpm --filter @hachej/boring-agent exec vitest run src/server/harness/pi-coding-agent/__tests__/runtimeCwd.test.ts
```

Required PR gate:

```bash
TMPDIR=/home/ubuntu/tmp-boring-vitest pnpm --filter @hachej/boring-agent run test
```
