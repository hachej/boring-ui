# 00 — Global ISA: intent, strategy, architecture

ISA here means **Intent, Strategy, Architecture**.

## Intent

Make boring-ui support true headless agents while preserving the coding-agent workspace experience.

Today `@hachej/boring-agent` is too coupled to `Workspace + Sandbox + FileSearch`. We want:

- pure/headless agents with no filesystem, no sandbox, no cwd, no file routes, no bash tools;
- optional working environments for coding/file tasks through `@hachej/boring-bash`;
- multiple agent personalities/runtimes inside one deployed app and one workspace;
- child apps such as Macro hosted inside the same full-app deployment without leaking tools/prompts/provisioning into generic workspaces.

## Target package ownership

| Package | Owns | Must not own |
| --- | --- | --- |
| `@hachej/boring-agent` | model loop, sessions, runner API, tool registry, channel-neutral event stream, non-bash operational hooks, provisioning engine types/orchestration by injected adapter | filesystem, file routes, bash, file UI, concrete sandbox providers, bash requirement normalization |
| `@hachej/boring-bash` | optional fs + exec working environment, path safety, search/watch, file routes, file/bash/upload tools, file UI, bash requirement normalizer, provider adapters/capabilities | auth, billing, app membership, LLM harness core, provisioning engine ownership |
| `@hachej/boring-workspace` | UI shell, layout, plugin host, UI bridge/RPC, surface registry | agent model loop, concrete bash providers |
| `@hachej/boring-core` / app composition layer | auth, DB, workspaces, child-app context resolution, billing, deployment composition; final child-app registry location follows the shared child-app plan | concrete bash provider internals |

Non-negotiable: `@hachej/boring-agent` has **zero value imports** from `@hachej/boring-bash`. Bash is injected by host/CLI/composition.

Provisioning ownership rule: the existing provisioning engine and `ProvisionWorkspaceRuntimeOptions` stay in agent/server as type-safe orchestration over an injected provisioning adapter. `@hachej/boring-bash` owns bash requirement normalization and concrete provider adapters. The host/core/CLI wires the two together. Agent must never import concrete bash providers.

## What we learned from Flue

- `SessionEnv` is the key seam: file tools, programmatic fs, shell, grep/glob all share one backing environment.
- Conversation/session durability does not imply sandbox/file durability.
- Durable submissions need stable environment identity and conservative recovery.
- Subagent profiles are useful for cheap delegation but normally share parent environment; they are not enough for isolated agent sandboxes.
- Default fs/bash tools are too powerful for our target. Boring-agent must default to none.
- Transcript-visible shell operations and out-of-band host fs plumbing are different contracts.

## What we learned from eve

- Filesystem-discovered slots are excellent DX: `agent.ts`, `instructions.md`, `tools/*`, `skills/*`, `subagents/*`, `channels/*`, `connections/*`, `sandbox/workspace/**`.
- Discovery should be import-free; compile/runtime can reattach live exports later.
- Path-derived names avoid drift.
- Authored tools/routes can override or disable framework defaults.
- Declared subagents as separate runtime nodes are the right model for different sandbox/tool policies.
- Sandbox lifecycle should separate reusable template/bootstrap from live session setup.
- `/workspace` as one model-visible namespace prevents split brain.
- Read-before-write/stale-write stamps are worth stealing for model-facing file edits.
- Provider labels are insufficient; a capability matrix must say real bash, real binaries, network isolation, and persistence semantics.

## Direction

Build one platform with three clean layers:

```txt
Agent core       model/session/tool loop; no implicit runtime
Feature layer    optional UI, bash, web, plugin, approval, search capabilities
Runtime layer    concrete storage/sandbox/provider implementation
```

Then one deployed app can host:

- generic Seneca coding workspaces;
- Macro child-app workspaces;
- concierge/support agents with no files;
- reviewers with readonly files and no shell;
- coding agents with full bash;
- hosted iframe plugins with no backend code;
- trusted internal plugins with explicit server/runtime requirements.

## Current seams to reuse, not replace

This repo already has real seams. The refactor must extend them:

- `disableDefaultFileTools`;
- `buildHarnessAgentTools()` for `bash` / `execute_isolated_code`;
- `buildFilesystemAgentTools()` for `read/write/edit/find/grep/ls`;
- `buildUploadAgentTools()`;
- `workspaceFsCapability` on runtime modes;
- `RuntimeBundle.storageRoot`, `Workspace.root`, `WorkspaceRuntimeContext.runtimeCwd`, and `getRuntimeBundleStorageRoot()`;
- `provisionWorkspaceRuntime()` with merge-by-id, fingerprint skipping, and `WorkspaceProvisioningResult.changed`;
- `RuntimeDependencyReadiness`, `ReadyStatusTracker`, and `mergeTools({ checkReadiness })`;
- `registerCapabilitiesContributor`;
- workspace-owned `/api/v1/ui/*`, `exec_ui`, `get_ui_state`, `WorkspaceBridge`, and `/api/v1/plugins/:pluginId/*`.

## Non-negotiable invariants

1. Pure agents run without `Workspace`, `Sandbox`, cwd, file routes, or bash tools.
2. Bash and file APIs are optional and live in `@hachej/boring-bash`.
3. File routes/search/watch/bash/git/status must use the same source of truth.
4. Partial file exposure with shell is physical: mount/seed only allowed files for untrusted exec.
5. Session history durability and file/workspace durability are separate.
6. Plugins/agents declare requirements; hosts resolve and intersect policy. No silent widening.
7. Provider fallback is policy-driven. Never silently downgrade isolation or capability.
8. Child-app/workspace-kind policy can narrow defaults and requirements.
9. Users are principals/supervisors/approval channels, not model-callable root agents.
10. Open backlog issues are not automatically solved; the abstraction only supplies the spine.

## Issue coverage posture

Do not overclaim. This abstraction directly owns #391 and materially advances parts of other issues only when their acceptance criteria land.

Materially advanced by this plan:

- #12 harness pluggability, if pure runtime-free harness acceptance passes;
- #242 app assembler / route composition, if dependency injection lands;
- #16 and #223 runtime/provider abstraction, if provider capability matrix lands;
- #26, #220, #221 file API/UI ownership, if file routes/tools/UI move;
- #357, #254, #256 plugin/runtime capability declaration, if plugin validation/runtime context lands;
- #243, #211 multi-agent/session scoping foundations, if route/session/search work lands.

Explicitly not fully solved but must be supported by extension points:

- #376 child-app platform / Macro hosted in full-app;
- #380 external harness hooks;
- #379 session-history search;
- #307 remote-worker hardening;
- #181 secrets;
- #328/#258 managed plugin services;
- #295 file tree replacement;
- #367/#226 document-authoritative collaboration;
- #189 git/source-of-truth consistency;
- #371/#228/#224 provider recovery and operational commands.

## Open decisions before implementation

1. Is pure/headless mode implemented through pi-coding-agent with cwd disabled/sealed, or a separate non-pi harness? This decision blocks Phase 1 exit.
2. Is arbitrary multi-mount/overlay support v1, or do we preserve one `/workspace` view and defer advanced projections? If deferred, public shapes must mark `mounts` as internal/future.
3. Do providers live under `@hachej/boring-bash/providers` forever, or move to a private provider package later?
4. Multi-agent route shape: path prefix `/api/v1/agents/:agentId` or header/request-scope equivalent?
5. Provisioning sharing defaults: workspace-shared, agent-private, or requirement-controlled?
6. Readonly fs in v1 or deferred?
