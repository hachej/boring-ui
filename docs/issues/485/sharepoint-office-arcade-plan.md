# Issue 485 — SharePoint Office documents via Arcade

Plan for PowerPoint / Excel support in boring-ui.

Issue: https://github.com/hachej/boring-ui/issues/485

## Summary

Implement Office document support as an app/internal SharePoint plugin.

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

- Create app/internal SharePoint plugin using existing plugin conventions.
- Add `boring.front` and `boring.server` entries.
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
- Tests ensure no generic file-tree SharePoint spaghetti.

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

## Cross-stack green gates

- No Claude Code MCP/product dependency.
- No Arcade SDK import outside backend provider/runtime files.
- No snake_case Arcade params outside adapter boundary.
- No raw Arcade auth/errors in UI.
- No preview URL/token persistence/logging.
- No SharePoint conditionals scattered through generic file tree code.
- Existing plugin conventions only.
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
