# P1 Pi Harness Audit - BBP1-005

Scope: `createPiCodingAgentHarness`, Pi session storage, resource loading, plugin discovery, and prompt construction for `runtime: 'none'`.

Decision: sealed Pi harness, not a second harness. Pure mode still uses `createPiCodingAgentHarness`, but it receives only a sealed virtual cwd and headless Pi defaults. If a host wants workspace resources, it must use a workspace runtime path, not pure mode.

## Seals Landed

- `createAgent({ runtime: 'none' })` builds a sealed cwd through `createPureRuntimeCwd(sessionStorageRoot)` and passes it as both `cwd` and `runtimeCwd`; transcript storage receives `sessionStorageCwd: ''` plus `sessionRoot` so it does not derive storage from a host cwd (`packages/agent/src/server/createAgent.ts`).
- Pure-mode default Pi construction uses `withPurePiHarnessDefaults()`, which forces `noExtensions: true`, `noContextFiles: true`, `noSkills: true`, `noPromptTemplates: true`, `noThemes: true`, and `systemPromptMode: 'headless'` (`packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`).
- Headless `systemPromptMode` uses Pi's supported `DefaultResourceLoader` with the sealed cwd as both `cwd` and `agentDir`, one `SettingsManager.inMemory()` shared with `createAgentSession()`, literal prompt override callbacks, and every ambient-discovery flag disabled. It does not evaluate static or hot-reloadable path/package resources; only trusted in-process extension factories supplied by the harness code or host remain enabled.
- Pure HTTP adapters (`createAgentApp`, `registerAgentRoutes`) also use `withPurePiHarnessDefaults()`, so request-scoped pure bindings cannot opt into ambient AGENTS.md or global skill discovery by accident.
- Headless prompt mode replaces Pi's ambient/default base prompt with a minimal pure prompt, suppresses Boring's workspace/file/Python prompt addenda, ignores Pi-discovered append prompts, and installs a `before_agent_start` extension that removes Pi's final `Current working directory:` line from the model-visible prompt. Workspace runtimes keep the old guidance.

## Findings

| Suspect | Verdict | Evidence / seal |
| --- | --- | --- |
| Session JSONL location | Sealed for pure mode. | `PiSessionStore` still supports `BORING_AGENT_SESSION_ROOT` for legacy/default storage, but pure mode passes explicit `sessionRoot` and `sessionStorageCwd: ''`; with an explicit root and empty storage cwd, the store roots directly under `sessionStorageRoot` instead of a cwd-derived directory. |
| `SessionManager.create(runtimeCwd, nativeSessionDir)` | Sealed for pure mode. | `runtimeCwd` is the sealed `.runtime-none` directory, not `ctx.workdir`; the BBP1-005 spy test passes `ctx.workdir = process.cwd()` and asserts Pi receives the sealed cwd. |
| `.pi` extension loading | Gated off in pure mode. | Plugin discovery remains in `pluginLoader.ts` for workspace modes, but pure-mode adapter paths do not call `loadPlugins({ cwd })`. The headless `DefaultResourceLoader` receives sealed `cwd`/`agentDir`, in-memory settings, `noExtensions: true`, and no extension paths or packages. It loads only trusted in-process `extensionFactories`; pure defaults do not discover workspace `.pi/extensions`, `.pi/extensions.json`, npm plugins, package extensions, or global extension files. |
| Path/package resource callbacks | Not evaluated in pure mode. | Pi's `no*` flags still permit explicit additional paths, so the headless branch also skips `getHotReloadableResources()` and does not pass static or dynamic skill, extension, or package paths to the loader. The focused test supplies sentinel host paths and proves the callback is not invoked and the paths do not reach loader options. |
| AGENTS.md / CLAUDE.md context files | Sealed for pure mode. | The headless loader uses the sealed directory plus `noContextFiles: true`, so host context cannot contribute content. The prompt snapshot test asserts no `AGENTS.md` text appears. |
| Skills and global skill dirs | Sealed by default. | The headless loader uses `noSkills: true`, in-memory settings, sealed directories, and no additional skill paths. It cannot scan user-global `~/.pi/agent/skills` or `~/.agents/skills`. |
| Prompt templates and themes | Sealed for pure mode. | The headless loader uses `noPromptTemplates: true`, `noThemes: true`, sealed directories, and no additional paths. Prompt-template discovery can otherwise rewrite slash-prefixed user input; themes are not needed for headless turns. |
| Model registry and auth files | Credentials allowed; ambient defaults sealed. | `AuthStorage.create()` and model registry setup remain the Pi-owned credential trust boundary. Headless mode skips Boring's `readConfiguredDefaultModel()` fallback, passes the same in-memory settings manager and sealed `agentDir` to `createAgentSession()`, and disables ambient configured-default lookup on the pure `/api/v1/agent/models` route. An explicit available `input.model` still wins; otherwise Pi may restore session state or choose from the credential-backed registry using empty in-memory settings. Workspace model/default behavior is unchanged. |
| System prompt cwd/workspace/file-tool leakage | Sealed for pure mode. | `systemPromptMode: 'headless'` supplies the minimal base and explicit host append through literal override callbacks, not Pi's path-or-text `systemPrompt`/`appendSystemPrompt` source fields. A path-like host fragment therefore remains literal. The mode also omits workspace/Python addenda and strips Pi's cwd line before the model turn. The snapshot test asserts no host cwd, sealed cwd, `Current working directory:`, `Workspace paths`, `AGENTS.md`, `SYSTEM.md`, `APPEND_SYSTEM.md`, `read/edit/write`, `find/grep/ls`, or `uv pip install`. |
| Compaction | No file-tool dependency found. | Session compaction in `PiSessionStore` operates on JSONL transcript records and linked native Pi session files under the session store. It does not call file tools or require a workspace root. |
| Session identity | Does not require workspace root. | `SessionCtx.workspaceId` may be absent. Pure sessions persist `boringSessionCtx: {}` and are scoped by the configured session root; existing tests round-trip create/list/load/delete without synthesizing `workspaceId`. |

## Tests

- `packages/agent/src/server/harness/pi-coding-agent/__tests__/runtimeCwd.test.ts`
  - `constructs the default pure Pi harness without host cwd or ambient resources` (same in-memory settings manager reaches loader + Pi session; no file-backed settings/global agent-dir lookup; explicit model preserved)
  - `does not evaluate path-based Pi resources in headless mode`
  - `snapshots the pure-mode system prompt seal`
- `packages/agent/src/server/http/routes/__tests__/models.test.ts`
  - `does not read an ambient configured default when the profile disables it`
- Existing pure session tests in `packages/agent/src/server/harness/pi-coding-agent/__tests__/createHarness.test.ts` continue to cover storage under `sessionRoot` without synthesized `workspaceId`.
- Existing `packages/agent/src/server/__tests__/createAgent.test.ts` pure-mode tests continue to cover sealed harness input for custom factories and rejection of filesystem attachments.

## Reproducers

Focused seal reproducer:

```bash
TMPDIR=/home/ubuntu/tmp-boring-vitest pnpm --filter @hachej/boring-agent exec vitest run src/server/harness/pi-coding-agent/__tests__/runtimeCwd.test.ts
```

Full regression reproducer:

```bash
TMPDIR=/home/ubuntu/tmp-boring-vitest pnpm --filter @hachej/boring-agent run test
```
