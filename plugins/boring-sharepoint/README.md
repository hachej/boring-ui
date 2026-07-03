# Boring SharePoint plugin

App/internal plugin shell for SharePoint / Microsoft 365 Office document support in boring-ui.

This package is intentionally a trusted app/internal plugin, not a runtime-generated `.pi/extensions` plugin. The current stack includes the plugin shell, Office cloud-ref display wiring, Arcade runtime primitives, read-only SharePoint discovery/status, and on-demand Office preview. Future PRs will add Office agent edits and import flows behind these contracts.

## Trust boundary

- Arcade is the planned V1 backend provider for Microsoft authorization and tool execution.
- Arcade stores Microsoft OAuth grants/tokens for Arcade-backed capabilities.
- boring-ui stores only SharePoint document references and integration metadata.
- `*.xlsx.cloud.json` and `*.pptx.cloud.json` files must never contain tokens, cookies, preview URLs, OAuth artifacts, Arcade tool names, or absolute local paths.
- Preview URLs returned by Microsoft Graph `driveItem:preview` are transient token-bearing URLs and must be generated on demand only.

## Setup workbook outline

This workbook will become the operator guide as implementation PRs land.

1. **Prerequisites**
   - Microsoft 365 tenant with SharePoint Online.
   - SharePoint site and document library for Office files.
   - Arcade project configured for the workspace/tenant.
2. **Arcade backend/provider setup**
   - Connect the SharePoint/Microsoft 365 integration through Arcade.
   - Configure the server runtime environment:
     - `BORING_SHAREPOINT_ARCADE_API_KEY` — required Arcade API key; never log this value.
     - `BORING_SHAREPOINT_ARCADE_DEFAULT_USER_ID` — optional default Arcade user id for local/operator testing.
     - `BORING_SHAREPOINT_ARCADE_PROVIDER_ID` — optional provider id, defaults to `microsoft`.
     - `BORING_SHAREPOINT_ARCADE_BASE_URL` — optional Arcade API base URL override.
   - Deploy/register the plugin-owned custom Arcade tool `BoringSharePoint_CreatePreviewUrl` in the operator's Arcade project. The tool wraps Microsoft Graph `driveItem:preview` using Arcade-managed Microsoft auth and returns only `{ getUrl, expiresAt? }`.
   - Confirm Microsoft scopes needed by each capability.
   - Confirm tenant/admin consent requirements.
3. **boring-ui workspace connection**
   - Open the SharePoint app-left action or run `SharePoint: Open settings/status` from the command palette.
   - Connect or verify the workspace Arcade user mapping.
   - Confirm status from the plugin-owned `GET /api/sharepoint/status` route: connected / needs auth / pending auth / admin consent required / failed.
4. **Create test documents**
   - Upload a sample `.xlsx` and `.pptx` to the SharePoint document library.
   - Use `POST /api/sharepoint/resolve` with either `webUrl` or `driveId + driveItemId` to resolve canonical ref metadata.
   - Capture their SharePoint identity as `siteId`, `driveId`, and `driveItemId`.
5. **Validate V1 flows**
   - Open in SharePoint using `webUrl`.
   - Preview in boring-ui through `POST /api/sharepoint/preview`, which requests a transient preview URL on demand.
   - Agent-edit Excel and PowerPoint once edit providers land.
6. **Troubleshooting**
   - Auth required: reconnect SharePoint/Microsoft 365.
   - Admin consent required: tenant admin must approve Microsoft scopes.
   - Preview blocked: check custom Arcade tool deployment, tenant iframe policy, browser auth, and host CSP.
   - Stale `webUrl`: re-resolve by durable `driveId + driveItemId`.
   - Arcade tool failure: inspect stable `SHAREPOINT_*` error code and provider status.

## MCP/integrations menu path

The workspace already exposes generic plugin chrome surfaces for integration/status UI:

- `commands` for command-palette entries that open panels.
- `appLeftActions` for app-left management overlays, the same chrome family used by the MCP/Sources management UI.

PR 2 uses those existing generic surfaces instead of adding SharePoint-specific branches to workspace chrome:

```txt
command id: boring-sharepoint.open-settings
panel id: boring-sharepoint.settings
app-left action id: boring-sharepoint.settings
label: SharePoint
```

The app-left action and command open the SharePoint / Microsoft 365 status surface. It now reads provider status from the plugin-owned route; future PRs can add authorization controls without changing the menu path.

## Package surfaces

- `boring.front`: `dist/front/index.js`
- `boring.server`: `dist/server/index.js`
- shared contracts: `@hachej/boring-sharepoint/shared`

## Current scope

This PR adds on-demand Office preview on top of the shell/display/runtime/discovery stack:

- `ArcadeSharePointProvider.createOfficePreviewUrl()` calls the plugin-owned custom Arcade tool `BoringSharePoint_CreatePreviewUrl` with `{ drive_id, item_id, viewer: "office" }` and normalizes `{ getUrl, expiresAt? }`.
- `POST /api/sharepoint/preview` accepts either `{ ref }` with a canonical SharePoint document ref or `{ driveId, driveItemId }` durable identity and returns the transient preview result only.
- The preview route validates canonical refs and rejects token-bearing ref input before calling the provider.
- The Office preview panel requests the preview URL only while rendering and stores it only in React component state.
- Preview `getUrl` values are never stored in cloud-ref metadata, route logs, route errors, or session storage.
- The custom Arcade tool deploy/register step remains an operator runbook task; this repo contains the contract/runtime call and mocked tests only.
- Tests use mocked Arcade/provider calls only.
- no Microsoft Graph direct calls in boring-ui code
- no Claude MCP/local MCP gateway dependency
- no Office edit calls
- no local import/upload
- no SharePoint-specific workspace chrome branches
