# Latest-main reassessment — CLI/local runtime plugin plan

Date: 2026-06-03

Branch reviewed after rebasing onto latest `origin/main`:

```txt
plan/runtime-plugin-cli-local
```

Latest-main code touchpoints inspected:

- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`
- `packages/workspace/src/app/server/pluginEntryResolver.ts`
- `packages/workspace/src/app/server/rebuildServerPlugins.ts`
- `packages/workspace/src/server/agentPlugins/scan.ts`
- `packages/workspace/src/server/agentPlugins/manager.ts`
- `packages/workspace/src/server/agentPlugins/routes.ts`
- `packages/workspace/src/shared/plugins/manifest.ts`
- `packages/workspace/package.json`

## Verdict

Plan remains valid, but latest main adds two important constraints:

1. `/api/v1/agent/reload` and `/api/boring.reload` do **not** currently have identical behavior; after reconsideration, PR 01 should remove `/api/boring.reload` instead of preserving a second reload path.
2. `installPluginAuthoring` / `boring-ui-plugin` is now an explicit agent-authoring path and must stay separate from future `boring-ui install`.

Canonical PR docs were updated to reflect both.

## Finding 1 — remove the old reload endpoint instead of coordinating two paths

Latest main behavior:

- Agent reload (`createAgentApp.beforeReload`) does:
  - asset manager scan;
  - server rebuild diagnostics;
  - runtime provisioning;
  - caller `opts.beforeReload` merge;
  - merged diagnostics/restart warnings.

- Developer reload route (`POST /api/boring.reload`) does:
  - asset manager scan;
  - server rebuild diagnostics;
  - restart warnings;
  - no runtime provisioning;
  - no caller `opts.beforeReload` merge.

So PR 01 cannot truthfully be both:

```txt
behavior-preserving extraction
```

and

```txt
make both reload endpoints identical
```

## Plan adjustment made

PR 01 now says `/api/v1/agent/reload` is the only reload endpoint and `/api/boring.reload` should be removed. It does not require a new helper abstraction unless that clearly shrinks `createWorkspaceAgentServer.ts`.

PR 02 now says runtime backend reload is added only to the canonical agent reload path and must not reintroduce `/api/boring.reload`. A focused helper can be extracted in PR 02 if backend reload would otherwise bloat the app-server composition file.

## Finding 2 — source metadata must not leak into public list/event responses by accident

Current `BoringPluginAssetManager` returns list/event payloads shaped for the frontend. These do not include root/source metadata.

Runtime backend needs source metadata internally, but front list/event payloads should not start exposing host paths or source policy details.

## Reassessment

PR 01 acceptance now explicitly says source metadata survives scan/load **without changing existing list/event response shapes**.

Implementation implication:

- source metadata can live on internal scan/inspection records;
- `BoringPluginListEntry` should remain public/UI-safe;
- do not leak `rootDir` into SSE/list payloads.

## Finding 3 — current duplicate-id scan behavior conflicts with future workspace-local shadowing

Current `scanBoringPlugins(pluginDirs: string[])` treats duplicate plugin ids as invalid and removes the earlier plugin.

Future PR 03 says:

```txt
workspace-local plugin wins over global same-id plugin
```

That cannot be implemented by simply appending roots to the current string-dir scanner. It will need a source-aware ordering/shadowing rule.

## Reassessment

This does not block PR 01/02 if install remains deferred. It is a PR 03 implementation concern.

When PR 03 starts, it should avoid broad rewrites by introducing source-aware collection/selection before calling scan/load, or by making scan accept source records with explicit duplicate policy.

Do not hide workspace-local shadowing inside incidental array order.

## Finding 4 — latest main has explicit agent-authoring CLI separation

`createWorkspaceAgentServer.ts` now has `installPluginAuthoring` and provisions `boring-ui-plugin` as the slim setup/scaffold/verify CLI inside agent workspaces.

This matters because PR 03 proposes top-level `boring-ui install`.

## Plan adjustment made

PR 03 now states:

- `boring-ui-plugin` remains the agent-facing scaffold/verify tool;
- `boring-ui install` is the human/host-facing package/source install manager;
- do not route agent plugin authoring through the full human CLI.

## Finding 5 — jiti helper extraction still matches latest main

`pluginEntryResolver.ts` still owns:

```ts
createJiti(import.meta.url, { moduleCache: false }).import(serverPath)
```

PR 01 shared import helper remains appropriate.

## Finding 6 — `runtime-server` export still needs build/export wiring

`packages/workspace/package.json` has exports for root, app/server, server, plugin, etc. No `./runtime-server` export exists.

PR 02 correctly includes adding the subpath. Implementation must update:

- package exports;
- tsup entry points;
- public API tests/build artifact assertions if present.

## Final reassessment

The three-PR plan is still the right shape:

```txt
PR 01 — foundation
PR 02 — server runtime MVP
PR 03 — install/list/remove MVP
```

But the implementation should obey these latest-main constraints:

1. Reload logic has one canonical endpoint, `/api/v1/agent/reload`; the old `/api/boring.reload` route is removed, not preserved. A helper is optional, not required.
2. Source metadata stays internal and does not leak in list/SSE payloads.
3. Workspace-local shadowing is a PR 03 source-selection rule, not implicit scan array luck.
4. `boring-ui install` stays separate from agent-facing `boring-ui-plugin`.
5. PR 02 must wire a real `./runtime-server` package export/build entry.

No major plan reset needed.
