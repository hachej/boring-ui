# Implementation Plan

## Goals

Add an opt-in remote-safe external plugin mode for hosted/full-app remote sandboxes: plugins in the runtime workspace may contribute only self-contained, sandboxed iframe panels declared in `package.json`, while existing local trusted native plugin behavior remains unchanged.

## Non-goals

- Do not execute hosted plugin `boring.front` modules, `boring.server` modules, Pi extensions, tools, routes, or backend code.
- Do not add plugin backend route proxying, arbitrary iframe RPC, filesystem writes, network/fetch proxies, marketplace install/provenance, signing, or permissions UI.
- Do not change `packages/cli/src/server/pluginFrontRuntime.ts` or trusted local native plugin semantics except for shared type compatibility.
- Do not expose raw host filesystem roots through the remote runtime workspace seam.

## Exact Architecture

### Trust modes

- `externalPlugins`: existing local/trusted native mode. Keeps using `BoringPluginAssetManager`, native/module-url front targets, server routes, Pi resources, and backend gateway behavior.
- `hostedExternalPlugins`: new remote-safe iframe mode. Scans `.pi/extensions/<pluginId>/package.json` through the request/runtime `Workspace` abstraction only and emits `frontTarget.kind === "iframe"` for manifest-declared iframe panels.
- Full-app/core remote sandbox wiring should be able to run with `externalPlugins: false` and `hostedExternalPlugins: true`.

### Single `/api/v1/agent-plugins` owner

Do not register a second route module on existing plugin paths. Refactor the existing route owner in `packages/workspace/src/server/agentPlugins/routes.ts` to depend on a small manager interface, then feed it one of:

1. the native `BoringPluginAssetManager` in trusted mode,
2. the new hosted iframe manager in hosted-only mode, or
3. an explicit mux/combined manager only where both modes are intentionally enabled.

The same route owner must serve:

- `GET /api/v1/agent-plugins`
- `GET /api/v1/agent-plugins/events`
- `GET /api/v1/agent-plugins/:id/error`
- `GET /api/v1/agent-plugins/:id/iframe/:panelId/document` only when the selected manager supports hosted iframe documents

### Runtime workspace seam

Add an agent app callback seam for runtime-scoped route registration, but return only server-safe metadata:

```ts
{
  workspaceId: string
  runtimeMode: RuntimeModeId
  workspace: Workspace
  workspaceFsCapability?: FsCapability
}
```

Import `Workspace` from the agent/shared workspace contract, not from workspace package internals. Do not return `workspaceRoot`, host paths, or raw adapter roots.

### Hosted manifest shape

Extend `boring` with `iframePanels`:

```json
{
  "boring": {
    "id": "example",
    "label": "Example",
    "iframePanels": [
      {
        "id": "main",
        "title": "Example Panel",
        "entry": "panel.html",
        "placement": "right",
        "chromeless": false,
        "supportsFullPage": false,
        "openCommand": "Open Example Panel"
      }
    ]
  }
}
```

Validation rules:

- plugin id and panel id must be stable plugin ids using existing id rules;
- `entry` must be a safe plugin-relative path, regular file, `.html`, no NUL/backslash/absolute path/`..` segment;
- max manifest file size: 256 KiB;
- max iframe HTML document size: 1 MiB;
- max `entry` length: 256 chars; max full workspace-relative document path length: 512 chars;
- duplicate plugin ids and duplicate panel ids are diagnostics, not process-fatal;
- hosted mode rejects/diagnoses `boring.front`, `boring.server`, and `pi` contributions instead of importing/executing them.

### Iframe document and bridge

- Host fetches document JSON from `/api/v1/agent-plugins/:id/iframe/:panelId/document?nonce=<per-load-nonce>` and assigns returned `srcdoc` to the iframe. Do not navigate iframe `src` to a plugin URL.
- Document response uses `Cache-Control: no-store`.
- Generated srcdoc injects a CSP meta tag with at least: `default-src 'none'; img-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; worker-src 'none'; frame-src 'none'; navigate-to 'none'` where supported.
- Frontend renders `<iframe sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={srcdoc}>`; no `allow-forms`, no `allow-same-origin`, no popups/top-navigation permissions.
- Per iframe load, host creates a cryptographically random nonce and a fresh `MessageChannel`; it only transfers the port after verifying `event.source === iframe.contentWindow` and the nonce. The iframe bootstrap only accepts the matching nonce and then reports allow-listed messages (`ready`, `log`, `error`). Unknown messages are ignored and optionally logged as diagnostics.

## Files to Change

- `packages/workspace/src/shared/plugins/manifest.ts` - add `BoringIframePanelManifest`, `boring.iframePanels` validation, path/id/duplicate checks.
- `packages/workspace/src/shared/plugins/runtimePluginTypes.ts` - add `BoringPluginIframeFrontTarget` and iframe panel descriptor union member.
- `packages/workspace/src/plugin.ts` - export iframe manifest/front-target types for authors.
- `packages/workspace/src/server/agentPlugins/types.ts` - re-export iframe front target types and define route-manager-compatible plugin entry/event types.
- `packages/workspace/src/server/agentPlugins/routes.ts` - refactor to a single generic route owner/mux interface; add optional iframe document endpoint without duplicating existing paths.
- `packages/workspace/src/server/agentPlugins/manager.ts` - adapt `BoringPluginAssetManager` to the generic route manager interface if needed.
- `packages/workspace/src/server/hostedPlugins/types.ts` - new hosted diagnostics, manager interface, constants, document result types.
- `packages/workspace/src/server/hostedPlugins/scan.ts` - new workspace-backed scanner for `.pi/extensions` using only `Workspace.readdir/stat/readFileWithStat/readFile`.
- `packages/workspace/src/server/hostedPlugins/manager.ts` - new per-workspace hosted manager with list/replay/subscribe/error/document methods and bounded cache.
- `packages/workspace/src/server/hostedPlugins/srcdoc.ts` - new HTML size check, CSP/bootstrap injection, nonce-aware srcdoc generation.
- `packages/workspace/src/server/index.ts` - export hosted manager/route adapter helpers needed by app shells and tests.
- `packages/agent/src/server/createAgentApp.ts` - add runtime route registration callback option with no raw root exposure.
- `packages/agent/src/server/registerAgentRoutes.ts` - invoke runtime route callback after request workspace scoping hooks are installed.
- `packages/agent/src/server/index.ts` - export new callback/context types.
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts` - add `hostedExternalPlugins` option, instantiate native/hosted/combined route manager, register `boringPluginRoutes` once.
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` - pass hosted option through runtime route callback for core/full-app.
- `packages/workspace/src/app/front/WorkspaceAgentFront.tsx` - add hosted frontend enablement separate from native external plugin flag.
- `packages/core/src/app/front/CoreWorkspaceAgentFront.tsx` - pass hosted frontend flag.
- `apps/full-app/src/server/main.ts` - keep `externalPlugins: false`; add explicit env gate for hosted mode, e.g. `BORING_HOSTED_EXTERNAL_PLUGINS=1`.
- `apps/full-app/src/server/dev.ts` - same hosted env gate for dev server.
- `apps/full-app/src/front/main.tsx` - expose matching frontend flag.
- `packages/workspace/src/front/agentPlugins/registerAgentPlugin.tsx` - handle `frontTarget.kind === "iframe"`, register panels/commands without dynamic import.
- `packages/workspace/src/front/agentPlugins/HostedPluginIframePanel.tsx` - new host-owned iframe wrapper and minimal diagnostics rendering.
- `packages/workspace/src/front/agentPlugins/hostedPluginBridge.ts` - new nonce/source-bound `MessageChannel` helpers.
- `packages/workspace/src/front/provider/WorkspaceProvider.tsx` - ensure hosted plugin events can be consumed when native external plugins are disabled.
- `packages/plugin-cli/src/manifest.ts` - recognize/validate `iframePanels` without changing native scaffolds.
- `packages/workspace/docs/PLUGIN_SYSTEM.md` - document hosted iframe trust mode and limitations.
- `packages/workspace/docs/PLUGIN_STRUCTURE.md` - add hosted iframe package example.
- `packages/agent/docs/PLUGINS.md` - document remote-safe plugin limitations.
- `docs/DECISIONS.md` - update plugin decision with remote-safe iframe exception.
- `packages/plugin-cli/README.md` - note hosted manifest validation and unchanged native templates.

## Implementation Sequence

1. **Add shared types and manifest validation**
   - Files: `packages/workspace/src/shared/plugins/manifest.ts`, `packages/workspace/src/shared/plugins/runtimePluginTypes.ts`, `packages/workspace/src/plugin.ts`, `packages/plugin-cli/src/manifest.ts`
   - Changes: define `iframePanels`, validation constants, iframe front target union.
   - Acceptance: existing `boring.front` manifests still validate; safe iframe manifests validate; `../x.html`, non-HTML entries, duplicate panel ids, and oversized manifest fixtures fail with stable issues.

2. **Refactor plugin routes to one generic owner**
   - Files: `packages/workspace/src/server/agentPlugins/routes.ts`, `packages/workspace/src/server/agentPlugins/types.ts`, `packages/workspace/src/server/agentPlugins/manager.ts`
   - Changes: introduce a route manager interface covering `list`, `listExternal`, `subscribe`, `getError`, optional `getIframeDocument`; adapt native manager; keep existing SSE replay/heartbeat behavior.
   - Acceptance: route paths are registered exactly once in each server composition; native plugin route tests continue to pass.

3. **Add runtime route seam without root leakage**
   - Files: `packages/agent/src/server/createAgentApp.ts`, `packages/agent/src/server/registerAgentRoutes.ts`, `packages/agent/src/server/index.ts`
   - Changes: add callback context with `Workspace`, `workspaceId`, `runtimeMode`, optional fs capability only.
   - Acceptance: no callback type exposes `workspaceRoot` or host paths; package boundary imports remain from agent/shared contracts.

4. **Implement hosted scanner and manager**
   - Files: `packages/workspace/src/server/hostedPlugins/types.ts`, `scan.ts`, `manager.ts`, `packages/workspace/src/server/index.ts`
   - Changes: scan `.pi/extensions` via `Workspace`; load good plugins independently; store diagnostics; compute revisions from manifest/document stat/content signatures; ignore hosted-native fields with diagnostics.
   - Acceptance: one bad plugin does not block one good plugin; remote workspaces are scanned without `node:fs` or raw paths.

5. **Implement iframe document generation**
   - File: `packages/workspace/src/server/hostedPlugins/srcdoc.ts`
   - Changes: enforce HTML size/path limits; inject CSP, bootstrap, and nonce placeholder; return srcdoc JSON with `no-store` through the generic route owner.
   - Acceptance: oversized/missing/non-file docs return stable errors; returned docs contain CSP and bootstrap.

6. **Wire server compositions and feature flags**
   - Files: `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`, `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`, `apps/full-app/src/server/main.ts`, `apps/full-app/src/server/dev.ts`
   - Changes: add `hostedExternalPlugins`; instantiate hosted manager only when enabled; register `boringPluginRoutes` once with native, hosted, or explicit mux manager; keep full-app native `externalPlugins: false`.
   - Acceptance: hosted-only full-app exposes iframe plugin list/events/document routes; native local mode remains unchanged.

7. **Add frontend iframe host path**
   - Files: `packages/workspace/src/front/agentPlugins/registerAgentPlugin.tsx`, `HostedPluginIframePanel.tsx`, `hostedPluginBridge.ts`, `packages/workspace/src/front/provider/WorkspaceProvider.tsx`, `WorkspaceAgentFront.tsx`, `CoreWorkspaceAgentFront.tsx`, `apps/full-app/src/front/main.tsx`
   - Changes: register iframe panels and open commands; fetch srcdoc with per-load nonce; render sandbox without `allow-forms`; source/nonce-bound channel; visible minimal logs/errors.
   - Acceptance: no dynamic import is called for iframe targets; channel closes on unmount/navigation; logs/errors render in host diagnostics.

8. **Add docs**
   - Files: docs listed above.
   - Changes: explain three modes: internal trusted, local trusted native, hosted untrusted iframe. Include manifest and `panel.html` examples and limitations.
   - Acceptance: docs clearly say hosted plugins cannot use backend routes/tools, `boring.server`, host React imports, filesystem writes, or network proxies.

9. **Add tests and run validation**
   - Files: test files listed below.
   - Changes: add targeted server/frontend/manifest/composition tests.
   - Acceptance: validation commands pass.

## Tests

- `packages/workspace/src/shared/plugins/__tests__/manifest.test.ts`
  - safe `iframePanels`; unsafe paths; non-HTML entry; duplicate panel ids; oversize manifest validation helper if exposed.
- `packages/workspace/src/server/agentPlugins/__tests__/routes.test.ts` or existing `packages/workspace/src/server/__tests__/agentPlugins.test.ts`
  - generic route owner preserves list/error/SSE replay; document endpoint only exists when manager supports it; no duplicate route registration.
- `packages/workspace/src/server/hostedPlugins/__tests__/hostedPlugins.test.ts`
  - workspace-only scan; good+bad plugin isolation; duplicate plugin ids; diagnostics for `boring.front`, `boring.server`, and `pi`; revision changes on HTML edit; oversized/missing/non-file document errors; no raw path assumptions.
- `packages/workspace/src/front/agentPlugins/__tests__/registerAgentPlugin.test.tsx`
  - iframe target registers panels/open commands; no `importFront`/dynamic module path.
- `packages/workspace/src/front/agentPlugins/__tests__/HostedPluginIframePanel.test.tsx`
  - iframe has `sandbox="allow-scripts"`, no `allow-forms`, `referrerPolicy="no-referrer"`; document fetch includes nonce; source/nonce mismatch ignored; valid ready/log/error messages render.
- Nearest core/full-app server tests
  - `externalPlugins:false` disables native discovery; `hostedExternalPlugins:true` registers hosted manager through the single route owner; local native mode still uses `BoringPluginAssetManager`.

## Validation Commands

Run targeted checks first, then package checks:

```bash
pnpm --filter @hachej/boring-workspace test -- src/shared/plugins src/server/hostedPlugins src/server/agentPlugins src/front/agentPlugins
pnpm --filter @hachej/boring-workspace run typecheck
pnpm --filter @hachej/boring-workspace run lint:plugin-invariants
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-core run typecheck
pnpm --filter @hachej/boring-plugin-cli test
```

If full-app/core wiring has dedicated tests, also run the nearest affected test files.

## Dependencies

- Shared manifest/runtime types must land before scanner, server routes, and frontend registration.
- Generic route owner must land before hosted route wiring to avoid duplicate `/api/v1/agent-plugins` registrations.
- Runtime workspace seam must land before core/full-app hosted scanning can be request-scoped safely.
- Hosted manager and srcdoc generation must land before frontend iframe panel integration can be tested end-to-end.
- Frontend feature flag wiring depends on server feature flag names matching exactly.

## Risks

- Route muxing can accidentally change trusted native SSE semantics; preserve existing replay, heartbeat, and error behavior with regression tests.
- `EventSource` auth behavior may differ in hosted/full-app deployments; verify existing cookie/token handling before enabling the frontend listener.
- CSP `navigate-to` support is browser-dependent; sandbox must not include `allow-forms`, popups, top-navigation, or same-origin permissions.
- Inline scripts/styles are allowed for self-contained srcdoc apps; the iframe is still untrusted and must never receive broad host APIs.
- Long-lived multi-workspace servers need bounded hosted manager caches and cleanup on Fastify close/workspace switch.
- Full-app server and frontend hosted flags must match to avoid 404s or invisible plugins.

## Compact Worker Handoff Prompt

Implement `docs/plans/remote-sandbox-external-plugin-system.md`. Keep scope to hosted remote-safe iframe plugins. Must satisfy blockers: one generic/muxed `/api/v1/agent-plugins` route owner, no raw host root in runtime workspace seam, iframe sandbox exactly without `allow-forms`, enforce manifest/document size and safe `.html` path limits, and use source-bound plus per-load nonce `MessageChannel` handshake. Do not execute hosted `boring.front`, `boring.server`, Pi, tools, routes, or backend code. Add targeted tests and run the listed validation commands.
