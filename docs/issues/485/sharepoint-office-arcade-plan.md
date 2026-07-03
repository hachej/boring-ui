# Issue 485 — SharePoint Office documents via Arcade

Plan for PowerPoint / Excel support in boring-ui.

Issue: https://github.com/hachej/boring-ui/issues/485

## Summary

Implement Office document support as an app/internal SharePoint plugin located at `plugins/boring-sharepoint`.

- User-facing integration: **SharePoint / Microsoft 365**
- V1 backend provider: **Arcade** via `@arcadeai/arcadejs`
- Preview: plugin-owned custom Arcade tool wrapping Microsoft Graph `driveItem:preview`
- Agent edits: Arcade SharePoint Excel / PowerPoint tools
- No Claude Code MCP product dependency
- No WOPI / embedded Office editing in V1

## Architecture

```txt
SharePointPlugin
  front
    - thin surface resolver for *.xlsx.cloud.json / *.pptx.cloud.json
    - Office preview panel
    - Open in SharePoint / Agent edit actions
  server
    - SharePointProvider domain facade
    - ArcadeSharePointProvider backend implementation
    - ArcadeJsToolRuntime wrapper around @arcadeai/arcadejs
    - plugin-owned preview contract/tool wrapper
```

## Reference file

The plugin owns `*.xlsx.cloud.json` / `*.pptx.cloud.json` refs.

```json
{
  "kind": "office-cloud-document",
  "provider": "sharepoint",
  "version": 1,
  "name": "forecast.xlsx",
  "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "webUrl": "https://tenant.sharepoint.com/...",
  "siteId": "...",
  "driveId": "...",
  "driveItemId": "..."
}
```

Rules:

- Durable identity: `driveId + driveItemId`
- `webUrl` is display/open-link cache
- No tokens, cookies, preview URLs, OAuth artifacts, Arcade tool names, or absolute local paths


## Existing MCP/integrations menu integration

The SharePoint plugin must integrate with the existing MCP/integrations menu instead of creating a separate settings island or hardcoding SharePoint in workspace chrome.

Current documented front plugin surfaces are:

- `panels`
- `commands`
- `leftTabs`
- `catalogs`
- `surfaceResolvers`
- `providers` / `bindings`
- `toolRenderers`

There is not yet a documented generic `integrations` contribution in `definePlugin`. Therefore PR 1 must include an audit of the current MCP/integrations menu/plugin and choose the smallest compatible integration path.

Preferred path if the existing MCP menu already has a contribution registry:

```txt
plugins/boring-sharepoint
  -> contributes integration item:
       id: sharepoint
       label: SharePoint / Microsoft 365
       backend: arcade
       status: connected | needs_auth | pending_auth | failed
       openCommandId: boring-sharepoint.open-settings
```

Fallback path if no generic integration contribution exists yet:

1. Reuse existing plugin surfaces:
   - command: `boring-sharepoint.open-settings`
   - panel: SharePoint settings/status/setup
   - optional left tab only if the existing MCP menu pattern uses left tabs
2. Add the smallest generic integration-menu extension point to the existing MCP menu, not a SharePoint-specific branch.

Example generic contribution shape if needed:

```ts
interface WorkspaceIntegrationContribution {
  id: string
  pluginId: string
  label: string
  description?: string
  icon?: string
  statusEndpoint?: string
  openCommandId: string
  capabilities?: string[]
}
```

Thermo rule: no `if (integration === "sharepoint")` logic in the MCP menu. The menu should render plugin-contributed integration items, and the SharePoint plugin should own its settings/status/actions panel.

## Custom preview tool

Plugin-owned contract:

```ts
type CreateOfficePreviewUrlInput = {
  driveId: string
  driveItemId: string
  viewer?: "office"
}

type CreateOfficePreviewUrlResult = {
  getUrl: string
  expiresAt?: string
}
```

Arcade-backed implementation:

```txt
BoringSharePoint.CreatePreviewUrl
  requires_auth = Microsoft(scopes=["Sites.Read.All"])
  POST /v1.0/drives/{drive_id}/items/{item_id}/preview
  returns { getUrl }
```

Spike findings:

- Arcade JS SDK works with the project API key.
- Built-in Arcade SharePoint tools executed successfully through SDK.
- Existing Arcade Microsoft provider is active.
- Existing user connection has required Microsoft scopes.
- Custom Arcade tool definition with `requires_auth=Microsoft(scopes=["Sites.Read.All"])` is viable locally.
- Final implementation must deploy/register the custom tool and verify iframe preview through product SDK path.

## Stacked PR plan

### PR 1 — SharePoint app/internal plugin shell + contracts

- Create app/internal SharePoint plugin under `plugins/boring-sharepoint` using existing plugin conventions.
- Audit the existing MCP/integrations menu/plugin and document the exact contribution path SharePoint will use.
- Add `boring.front` and `boring.server` entries.
- Add plugin workbook/runbook documentation for setting up SharePoint/Microsoft 365 with boring-ui:
  - tenant/workspace setup flow
  - Arcade provider/backend setup
  - Microsoft consent/scopes needed
  - how to connect SharePoint in the boring-ui integration/MCP menu
  - how to create/upload test `.xlsx` / `.pptx` files
  - how to validate Open in SharePoint, preview, and agent edit
  - troubleshooting auth/admin-consent/CSP/iframe failures
- Add canonical `SharePointDocumentRef` / Office ref schema.
- Add stable `SHAREPOINT_*` error codes.
- Add provider/domain contracts:
  - `SharePointProvider`
  - `IntegrationAuthState`
  - `OfficeEditRequest`
  - `OfficeEditResult`
  - `CreateOfficePreviewUrlInput/Result`
- Add README trust-boundary note.
- Tests: ref validation, invalid refs, redaction invariants.

### PR 2 — Virtual Office file display + thin resolver

- Add surface resolver for `*.xlsx.cloud.json` / `*.pptx.cloud.json`.
- Resolver only parses and dispatches to the SharePoint plugin panel.
- Add virtual display metadata helper.
- Add placeholder preview panel.
- Add **Open in SharePoint** action using `webUrl`.
- Add SharePoint settings/status panel entry through the existing MCP/integrations menu contribution path chosen in PR 1.
- Tests ensure no generic file-tree or MCP-menu SharePoint spaghetti.

### PR 3 — Arcade JS runtime + auth normalization

- Add `@arcadeai/arcadejs` server-side.
- Add `ArcadeJsToolRuntime` wrapper.
- Add centralized workspace/tenant/user -> Arcade `user_id` resolver.
- Map Arcade auth states to boring-ui `IntegrationAuthState`.
- Map SDK failures to stable `SHAREPOINT_*` codes.
- Add mocked SDK tests.
- Enforce no Arcade SDK imports outside provider/runtime files.

### PR 4 — Read-only SharePoint discovery/status

- Add `ArcadeSharePointProvider` read-only services:
  - auth/status
  - site/drive/item discovery
- Execute built-in Arcade SharePoint tools through `ArcadeJsToolRuntime`.
- Add status/discovery route/tool if needed by UI.
- No preview/edit yet.

### PR 5 — Custom Arcade preview tool + iframe preview

- Add/deploy/register `BoringSharePoint.CreatePreviewUrl` custom Arcade tool.
- Tool uses Microsoft auth scope `Sites.Read.All` and Graph `driveItem:preview`.
- Wire `SharePointProvider.createOfficePreviewUrl` to the custom tool.
- Add iframe preview panel.
- Add fallback card: preview unavailable + **Open in SharePoint**.
- Verify real iframe rendering in host app/CSP.
- Add tests/redaction to ensure `getUrl` is never persisted/logged/session-stored.

### PR 6 — Office agent edit V1: Excel + PowerPoint

- Add Office edit action/job entry point.
- Excel path:
  - `MicrosoftSharepoint_AddWorksheet`
  - `MicrosoftSharepoint_GetWorkbookMetadata`
  - preserve/use `session_id`
- PowerPoint path:
  - `MicrosoftSharepoint_CreateSlide`
- Keep requests domain-level; Arcade tool names stay adapter-local.
- Add job logs with actor, ref, backend, status; no secrets.
- Add conflict/version metadata where available.

### PR 7 — Local Office import to SharePoint canonical ref

- Add import action for local `.xlsx` / `.pptx`.
- Upload/copy to SharePoint through provider backend.
- Create `*.xlsx.cloud.json` / `*.pptx.cloud.json` ref.
- Make SharePoint ref canonical after import.
- Handle duplicate names/conflicts.
- No two-way sync.

## Documentation/workbook requirement

The SharePoint plugin must ship a user/operator workbook explaining how to set up SharePoint/Microsoft 365 for boring-ui. It should be written for someone configuring a new tenant/workspace, not for core developers only.

Required topics:

- SharePoint/Microsoft 365 prerequisites.
- Arcade backend/provider setup.
- Tenant/workspace connection flow in boring-ui.
- Required Microsoft consent/scopes and admin-consent expectations.
- Creating or selecting a SharePoint site/document library.
- Uploading sample `.xlsx` / `.pptx` files.
- Validating file refs, Open in SharePoint, iframe preview, and agent edits.
- Troubleshooting:
  - auth required
  - admin consent required
  - preview iframe blocked by CSP/tenant policy
  - stale `webUrl` / moved files
  - Arcade tool failure


## Expected repository footprint

The implementation should be plugin-owned. The target location is:

```txt
plugins/boring-sharepoint/
```

Expected changes should be limited to:

- `plugins/boring-sharepoint/**` for implementation, tests, docs/workbook, and custom Arcade tool code.
- Workspace/app plugin registration/config needed to include the app/internal plugin.
- Package manager files such as `pnpm-lock.yaml` if `@arcadeai/arcadejs` or plugin package metadata requires it.
- Minimal docs/issue-plan updates.

Avoid changing core workspace/file-tree/plugin APIs. If an implementation PR needs changes outside the plugin and registration/lockfile/docs, it must explicitly justify the missing extension point and keep the change surgical.


## Thermo review after MCP/integrations menu pass

The plan remains green only if the existing MCP/integrations menu is treated as a host surface, not as SharePoint-owned UI. The SharePoint plugin may contribute to it, but must not fork or replace it.

Findings from the current plugin API/docs:

- `definePlugin` currently documents panels, commands, left tabs, catalogs, surface resolvers, providers/bindings, and tool renderers.
- A generic `integrations` contribution surface is not documented yet.
- Existing plugin docs require file visualizers to use surface resolvers instead of hard-coded file-tree extension logic.
- App/internal plugins are the right tier for trusted server routes/tools/provider code; runtime/generated plugins are route-free.

Thermo decision:

- PR 1 must identify the actual existing MCP/integrations menu owner and extension pattern before adding SharePoint UI.
- If an integration contribution registry exists, SharePoint should register an item there.
- If it does not exist, add the smallest generic contribution surface to the existing menu. Do not add SharePoint-specific conditionals.
- If adding that generic surface is too large for PR 1, split it into a separate prerequisite PR before SharePoint appears in the menu.

Hard blockers:

- No `if (id === "sharepoint")` branches in the MCP/integrations menu.
- No separate SharePoint settings island that bypasses the existing menu.
- No left-tab workaround if the intended UX is the MCP/integrations menu.
- No changes to plugin APIs unless the existing menu truly lacks a generic contribution path, and then the new API must be integration-agnostic.

Review checklist for the first implementation PR:

1. Link to the existing MCP/integrations menu files studied.
2. State which extension path is used.
3. Show that SharePoint contributes data/config, not hard-coded menu behavior.
4. Include a test with at least two fake integration contributions so the menu is proven generic.

## Cross-stack green gates

- No Claude Code MCP/product dependency.
- No Arcade SDK import outside backend provider/runtime files.
- No snake_case Arcade params outside adapter boundary.
- No raw Arcade auth/errors in UI.
- No preview URL/token persistence/logging.
- No SharePoint conditionals scattered through generic file tree or MCP menu code.
- Existing plugin conventions and existing MCP/integrations menu patterns only; if a new menu extension point is required, it must be generic and minimal.
- Stable error codes for every user-visible failure.
- Surface resolver remains parse/dispatch only.
- Workspace/user -> Arcade `user_id` mapping is centralized.

## Deferred / non-goals

- WOPI / embedded Office editing.
- Composio backend.
- Direct boring-ui Microsoft app registration path.
- Generic provider marketplace.
- Two-way local/cloud sync.
- Notion/Airtable UI in this issue, though the backend-provider architecture can support them later.
