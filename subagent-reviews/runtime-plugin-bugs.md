# Runtime plugin / plugin-agent bug-risk review

Scope checked: hot reload + SSE front registration, `/reload` response handling, file visualizer routing, CLI scaffold/verify boundaries, ask-user waiter ordering, file-search pruning split, and runtime provisioning paths on the current `feat/plugin-agent-layer-rebased-main` branch with spot checks against `feat/agent-runtime-cwd-provisioning` where relevant.

## Findings

### High — Browser front import failures can be hidden by the `/reload` success path

**Evidence**
- Browser-side plugin import failures dispatch `boring.plugin.front-error` after dynamic import/capture fails: `packages/workspace/src/front/agentPlugins/registerAgentPlugin.tsx:302-318`.
- `ChatPanel` converts those events to an error state: `packages/agent/src/front/ChatPanel.tsx:507-511`, `packages/agent/src/front/ChatPanel.tsx:1448-1456`.
- But the same `/reload` command later unconditionally overwrites the banner with success after the fetch resolves: `packages/agent/src/front/ChatPanel.tsx:530-541`.

**Repro / impact**
1. Put a runtime plugin front entry in `.pi/extensions/<id>/front/index.tsx` with a syntax/runtime import error.
2. Run `/reload`.
3. The SSE load event is emitted during server-side reload; the browser import can fail and set `pluginUpdateState` to error.
4. When `/api/v1/agent/reload` returns 200, `runPluginUpdate()` overwrites that error with `{ kind: "success" }`.

The user can see “Plugins updated” even though the browser kept the previous plugin version. This directly undermines the recent front-failure visibility fix.

**Suggested fix / tests**
- In `runPluginUpdate`, merge with the existing state instead of blindly replacing it; preserve an existing `error` or accumulated `frontEvents` for the same run.
- Add a `ChatPanel` test where `WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT` with `boring.plugin.front-error` fires before the mocked reload fetch resolves, and assert the final banner remains error.

### High — “Try again” after a transient front import failure may not retry the import

**Evidence**
- On front import failure, the browser deletes only `latestRequestedRef` and keeps the previous `lastSeen` revision: `packages/workspace/src/front/agentPlugins/registerAgentPlugin.tsx:302-318`.
- The asset manager emits no new load event when the plugin signature is unchanged: `packages/workspace/src/server/agentPlugins/manager.ts:251-256`.
- `/api/boring.reload` and the agent reload hook call `manager.load()`, so an unchanged plugin produces no SSE load event to retry: `packages/workspace/src/server/agentPlugins/routes.ts:60-78`.
- A reconnect would replay current plugin list (`packages/workspace/src/server/agentPlugins/routes.ts:118-127`), but the normal “Try again” path does not reconnect EventSource.

**Repro / impact**
1. Trigger a transient dynamic import failure for a valid front plugin revision (e.g. temporary Vite transform/404/MIME issue).
2. The browser keeps the previous version and shows a front error.
3. Click “Try again” or run `/reload` without changing files.
4. Server signature is unchanged, so no `boring.plugin.load` event is emitted; the browser never re-imports the valid current revision.

Recovery requires editing the file to force a new signature/revision or refreshing/reconnecting the page. This makes the failure banner’s retry affordance misleading.

**Suggested fix / tests**
- Add an explicit browser retry path on `/reload` completion: fetch `/api/v1/agent-plugins` and attempt imports for plugins whose revision is newer than `lastSeen`, even if no SSE event fired; or add a force-broadcast/retry revision mechanism.
- Test with `importFront` failing once then succeeding, calling reload twice without changing files; assert the second reload imports and registers the same revision.

### Medium — Existing surface tabs can keep the old component after resolver/component changes

**Evidence**
- Default surface panel IDs are stable by kind + target and do not include the resolved component: `packages/workspace/src/front/chrome/artifact-surface/surfaceShellHelpers.ts:45-50`.
- `openFile` resolves the latest resolver first, but if a panel with the same resolved ID exists it only updates params and activates it; it does not compare or replace the component: `packages/workspace/src/front/chrome/artifact-surface/SurfaceShell.tsx:191-209`.
- `openSurface` has the same behavior: `packages/workspace/src/front/chrome/artifact-surface/SurfaceShell.tsx:233-257`.

**Repro / impact**
1. Runtime CSV plugin v1 resolves `data.csv` to component `csv-table-v1` and the user opens `data.csv`.
2. Plugin v2 changes the resolver to component `csv-table-v2` but leaves `resolved.id` unset.
3. Run `/reload`, then open `data.csv` again.
4. `surface:workspace.open.path:data.csv` already exists, so `SurfaceShell` re-activates the old v1 panel rather than replacing it with v2.

Hot reload works for same panel IDs, but resolver migrations or generated plugins that rename panel IDs can leave stale visualizers until the user manually closes the tab.

**Suggested fix / tests**
- When an existing panel ID is found, compare `existing.view.contentComponent` (used elsewhere in `DockviewShell`) to `resolved.component`; if different, remove/re-add the panel or generate an ID that includes an explicit resolver/component version.
- Add a `SurfaceShell` test that opens a path with resolver component A, swaps resolver to component B for the same target, reopens, and asserts the panel uses B.

### Medium — Surface/openPanel validation can still create blank tabs for registered-but-disallowed panels

**Evidence**
- `SurfaceShell` allowlists only center-placement panels plus `extraPanels`: `packages/workspace/src/front/chrome/artifact-surface/SurfaceShell.tsx:169-178`.
- `DockviewShell` filters the component map to that allowlist: `packages/workspace/src/front/dock/DockviewShell.tsx:325-329`.
- `openFile`, `openSurface`, and `openPanel` validate only that the registry has the component, not that it is present in the current allowlist before calling `api.addPanel`: `packages/workspace/src/front/chrome/artifact-surface/SurfaceShell.tsx:193-209`, `packages/workspace/src/front/chrome/artifact-surface/SurfaceShell.tsx:244-257`, `packages/workspace/src/front/chrome/artifact-surface/SurfaceShell.tsx:281-294`.

**Repro / impact**
A runtime plugin can register a panel with `placement: "right"` and return that component from a file surface resolver. The registry check passes, but the surface dockview does not have that component in its filtered `components` map, matching the code comment that this situation creates an empty tab.

**Suggested fix / tests**
- Keep an `allowedPanelsRef` and reject/throw when `resolved.component` or `config.component` is not allowed in this `SurfaceShell`.
- Add tests for resolver/openPanel pointing at a registered right-placement panel and assert a visible error/no tab instead of a blank tab.

### Low — Path traversal guard rejects legitimate filenames containing `..`

**Evidence**
- `normalizeWorkbenchPath` throws whenever the normalized path contains the substring `..`: `packages/workspace/src/front/chrome/artifact-surface/surfaceShellHelpers.ts:16-24`.

**Repro / impact**
A safe relative file such as `data/report..csv` or `notes/v1..v2.md` cannot be opened through `openFile` / `workspace.open.path`, even though it is not a traversal path. This affects generated file visualizers and the file tree for unusual but valid filenames.

**Suggested fix / tests**
- Reject only `..` as a full path segment after splitting on `/`, and reject absolute paths/null bytes separately.
- Add tests that `../secret` and `foo/../secret` are rejected while `report..csv` is accepted.

## Checked and no additional bug found

- CLI scaffold/verify now default to `BORING_AGENT_WORKSPACE_ROOT` and avoid the heavy server import path; I did not find a remaining top-level `@mariozechner/pi-coding-agent` load in scaffold/verify.
- Ask-user waiter ordering now registers the waiter before opening the UI (`plugins/ask-user/src/server/askUserRuntime.ts:169-172`, with synchronous waiter insertion at `plugins/ask-user/src/server/askUserRuntime.ts:47-56`), which addresses the fast-answer race.
- The cwd/provisioning split branch’s file-search pruning does remove top-level `.boring-agent`, `.git`, and `node_modules` from `find` in `feat/agent-runtime-cwd-provisioning:packages/agent/src/server/runtime/createServerFileSearch.ts`; current plugin PR branch does not contain that change, which matches the split-PR plan.
