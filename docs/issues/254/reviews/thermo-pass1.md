# Runtime/plugin planning thermo review — pass 1/3

Reviewed:

- `docs/plans/cli-external-plugin-system-vision-gap-plan.md`
- `docs/plans/runtime-backend-gateway-jiti-hot-reload-plan.md`

Verdict: **revise before these become implementation tickets.** The gateway/registry direction is right, but the docs still leave too many ownership seams ambiguous. If implemented as written, this can easily turn into more conditional reload spaghetti in `createWorkspaceAgentServer.ts`, source-kind guessing inside `BoringPluginAssetManager`, and conflicting public API contracts.

## P0 blockers

### 1. The runtime server API contradicts itself about plugin ids

Both docs still show `id` inside `defineRuntimeServerPlugin(...)` even though they later say the id must come only from the manifest.

- Vision doc: example repeats `id: "email-client"` at lines 121-124, but line 605 says the runtime module must not repeat the plugin id.
- Gateway doc: target example repeats `id: "email-client"` at lines 91-93, but line 248 says do **not** repeat `id`.

This is not a nit. If a ticket contains both shapes, implementation will grow a mismatch branch: manifest id vs module id, conflict diagnostics, fallback behavior, and tests. Delete that complexity now.

Concrete edits:

- Remove `id` from every `defineRuntimeServerPlugin` example.
- Add one explicit contract sentence: `Runtime server modules never declare identity; the loader supplies pluginId from the validated manifest/source record.`
- Add a test requirement: a module export with an `id` field is ignored or rejected consistently. Prefer reject at validation so the API stays clean.

### 2. The vision doc is too broad to become a ticket; split it into implementation-sized plans

`cli-external-plugin-system-vision-gap-plan.md` is a 1k+ line roadmap covering PR merges, docs taxonomy, install/update/remove/list, dependency installation, backend gateway, lifecycle/health, bwrap workers, and self-test. As an implementation ticket, that is an invitation to touch every layer at once.

The plan needs a code-judo cut: keep this as a vision/roadmap, then make smaller tickets with hard ownership boundaries.

Concrete edits:

- Rename its implementation section to `Roadmap, not one ticket`.
- Split the implementation work into separate ticket docs:
  1. taxonomy + manifest/source metadata;
  2. runtime backend gateway MVP using existing `.pi/extensions` roots;
  3. Pi-style install/list/remove/update;
  4. unified health API;
  5. dependency import/install policy;
  6. bwrap worker/proxy.
- Make each ticket list allowed files/modules and explicit non-goals.
- Do not let one worker implement Phase 2 + Phase 3 together unless there is a compelling reason.

### 3. Source ownership must be modeled at discovery boundaries, not inferred later

The docs correctly say runtime backend activation needs source-kind gating, but the proposed model is too thin:

```ts
type BoringPluginSourceKind = "workspace-extension" | "global-extension" | "default-package" | "additional-dir"
```

That is not enough unless source provenance enters the system before scanning. Today the server builds plain plugin dirs, then `BoringPluginAssetManager` scans them. If runtime backend gating is added after that, someone will infer trust from path strings or bolt special cases into the asset manager/gateway.

Concrete edits:

- Replace planned `pluginDirs: string[]` usage with a first-class source record in the docs:

```ts
type BoringPluginSource = {
  root: string
  kind: "workspace-extension" | "global-extension" | "default-package" | "additional-dir"
  scope: "workspace" | "global" | "app"
  workspaceId?: string
  runtimeBackendAllowed: boolean
}
```

- Rename the planned collector from `collectBoringPluginDirs` to `collectBoringPluginSources` in the plan.
- Require `BoringPluginAssetManager.load()` to return loaded plugin records with source metadata preserved.
- State that `runtimeBackendRegistry` must not infer trust from paths. It receives `LoadedPlugin.source.runtimeBackendAllowed` or an equivalent explicit flag.
- Add tests for each source kind, including `additional-dir`, default package roots, and workspace-local roots in workspaces mode.

### 4. Extract reload orchestration before adding backend reload

`createWorkspaceAgentServer.ts` is already 801 lines. The gateway plan correctly says not to grow it, but the PR split still allows the riskiest work (`PR C: reload integration`) to touch the existing reload body and add more branches.

This needs a stronger gate. The code-judo move is: first extract the existing reload flow unchanged, then add runtime backend reload to the extracted coordinator.

Concrete edits:

- Change the PR split to:
  - `PR C0: extract current plugin reload flow into workspacePluginReload.ts with no behavior change`;
  - `PR C1: add runtimeBackendManager.reloadFromLoadedPlugins(...) to that coordinator`.
- Define the coordinator input/output types in the plan. It should receive the asset manager, rebuild function, provisioning callback, optional caller hook, and runtime backend manager; it should return merged diagnostics/restart warnings/health.
- Replace vague `caller beforeReload()` wording with the actual owner: `opts.beforeReload` runs after Boring scan/rebuild/provisioning and must be wrapped so it cannot abort unrelated plugin reloads.
- Update `boringPluginRoutes` planning to call the same coordinator closure, not a separate `rebuildPlugins` path.

## P1 high-priority structural issues

### 5. Host health endpoints conflict with the plugin gateway namespace

The vision doc proposes host management endpoints like:

```txt
GET /api/v1/plugins/:pluginId/health
```

But the gateway itself is:

```txt
/api/v1/plugins/:pluginId/*
```

That means `/api/v1/plugins/email-client/health` is ambiguous: is it host health metadata or a plugin-owned `/health` handler? The Phase 3 acceptance even says `GET /api/v1/plugins/<id>/health` can dispatch to a plugin handler. This conflict will produce route-order special cases.

Concrete edits:

- Keep `/api/v1/plugins/:pluginId/*` exclusively plugin-owned gateway space.
- Put host metadata under the existing management shape, e.g.:
  - `GET /api/v1/agent-plugins`
  - `GET /api/v1/agent-plugins/:pluginId`
  - `GET /api/v1/agent-plugins/:pluginId/health`
- If a plugin wants its own health check, it may register `/health` under the gateway. The self-test can call that, but host health must not live in the same path.

### 6. `RuntimeWorkspaceFacade` is still a boundary leak waiting to happen

The gateway doc says `workspace: RuntimeWorkspaceFacade` is in V1 context, then immediately says to omit it if no safe facade exists. The vision doc makes it optional and adds a logger. This is exactly how broad host access sneaks into a hot-loaded plugin API.

Concrete edits:

- For MVP, remove `workspace` from `RuntimePluginContext` entirely.
- Add a future ticket: `RuntimeWorkspaceFacade` with explicit operations only, no root path, no raw adapter escape hatch.
- If the team insists on including it now, define the exact method list in this plan and require tests proving no raw root/path escape is exposed.

### 7. Install and dependency policy are duplicated and out of phase

The vision doc says Phase 2 implements npm/git/local install, then Phase 6 again says to add package install flow for npm/git packages. The gateway doc says arbitrary npm dependency installation is a non-goal for the gateway MVP. These statements can all be reasonable, but not as one ticket sequence.

Concrete edits:

- Make the gateway MVP depend only on already-discovered `.pi/extensions` / explicit plugin source records.
- Move npm/git/local package install and dependency installation into a separate Pi-style install plan.
- In the vision roadmap, make Phase 2 own all source install mechanics and Phase 6 only own front/runtime dependency resolution after install. Do not repeat package install in both phases.

### 8. Workspace scoping / same-origin checks must be in gateway MVP, not a later banner phase

The vision doc delays CSRF/localhost/workspaces-mode considerations to Phase 4. That is too late. The gateway exposes trusted local code over HTTP; even in the Pi-style trust model, request routing must not cross workspace boundaries or accept unintended origins.

Concrete edits:

- Move these requirements into the runtime backend gateway MVP acceptance criteria:
  - same-origin/localhost policy matches existing API policy;
  - workspaces mode requires the same workspace identity check as adjacent workspace APIs;
  - workspace-local plugin sources cannot serve another workspace;
  - tests cover cross-workspace rejection.
- Keep permission prompts out of MVP, but do not defer route boundary checks.

## P2 maintainability/clarity improvements

### 9. Response/result types are too magical

The proposed result union allows `Response`, `{ status?, headers?, body? }`, `Record<string, unknown>`, `string`, `Uint8Array`, `null`, and `undefined`. That is convenient, but it is also ambiguous: a normal JSON object with `status` or `headers` keys can look like response metadata.

Concrete edits:

- Make the response object shape discriminated or require `body` for response-init objects.
- Define a readonly headers facade instead of exposing mutable `Headers` in context.
- Add response-normalization tests for arrays, plain objects containing `status`, unsupported values, `Uint8Array`, and thrown errors.

### 10. Protect `BoringPluginAssetManager` from becoming the lifecycle dumping ground

The runtime plan says not to put route tables in the asset manager. Good. The vision doc, however, puts scan state, errors, lifecycle, health, source/provenance, install state, and self-test state near the same conceptual area. That will make `BoringPluginAssetManager` absorb unrelated responsibilities.

Concrete edits:

- Add an explicit ownership table:
  - asset manager: scan, manifest validation, signatures, revisions, SSE scan events;
  - source registry/install store: installed source records and scope;
  - runtime backend registry: executable handler tables and dispose;
  - health aggregator: front/Pi/backend/self-test summary;
  - CLI commands: install/list/remove/update UX.
- Require any new asset-manager code to be scan/provenance only, not lifecycle policy or executable runtime state.

### 11. The public `runtime-server` export needs a hard dependency boundary

The new subpath should be importable by external plugin server modules without dragging in app/server orchestration or Fastify implementation details.

Concrete edits:

- State that `@hachej/boring-workspace/runtime-server` may export only types and `defineRuntimeServerPlugin`; no Fastify, no app server, no asset manager imports.
- Add an invariant/test that importing the subpath does not register routes or touch workspace/server state.

## Concrete edit checklist

Before converting these docs into tickets, make these edits:

1. Remove `id` from all runtime server plugin examples.
2. Split the 1k-line vision doc into roadmap + small ticket docs.
3. Add `BoringPluginSource` / source provenance as a first-class discovery input/output.
4. Add a behavior-preserving reload-coordinator extraction PR before backend integration.
5. Move host health endpoints out of `/api/v1/plugins/:pluginId/*`.
6. Omit `workspace` from V1 runtime handler context unless the exact safe facade is specified now.
7. Align install/dependency phases so npm/git install is not both Phase 2 and Phase 6.
8. Move same-origin/workspace scoping checks into gateway MVP.
9. Tighten `RuntimePluginResult` and headers types.
10. Add an ownership table that keeps `createWorkspaceAgentServer.ts` and `BoringPluginAssetManager` from absorbing this feature.
