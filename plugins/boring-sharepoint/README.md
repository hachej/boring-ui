# Boring SharePoint plugin

App/internal plugin shell for SharePoint / Microsoft 365 Office document support in boring-ui.

This package is intentionally a trusted app/internal plugin, not a runtime-generated `.pi/extensions` plugin. The current stack includes the plugin shell, Office cloud-ref display wiring, Arcade runtime primitives, read-only SharePoint discovery/status, on-demand Office preview, V1 Office agent edit primitives, and route/provider primitives for importing local Office files to SharePoint canonical refs.

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
   - Deploy/register the plugin-owned upload/import Arcade tool assumed by this slice: `BoringSharePoint_UploadOfficeDocument`. It should accept `{ source_path, content_handle, name, mime_type, site_url?, drive_id?, folder_item_id?, folder_web_url? }`, use Arcade-managed Microsoft auth to upload the staged `.xlsx`/`.pptx`, and return SharePoint drive item metadata only.
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
   - Agent-edit Excel via `POST /api/sharepoint/edit` with `{ kind: "excel.add-worksheet", worksheetName }`.
   - Agent-edit PowerPoint via `POST /api/sharepoint/edit` with `{ kind: "powerpoint.create-slide", title, body?, layout? }`.
   - Import a local staged `.xlsx` or `.pptx` via `POST /api/sharepoint/import` with `{ sourcePath, contentHandle, target }`. The route returns `{ ref, cloudRefPath }`; a host/workspace follow-up can write that JSON to the suggested `*.cloud.json` path.
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

This PR adds local Office import route/provider primitives on top of the shell/display/runtime/discovery/preview/edit stack:

- `ArcadeSharePointProvider.importLocalOfficeDocument()` calls the assumed plugin-owned upload tool `BoringSharePoint_UploadOfficeDocument` with normalized snake_case input kept inside the server/provider adapter.
- `POST /api/sharepoint/import` accepts `{ sourcePath, contentHandle, target }`, validates it, and returns canonical `{ ref, cloudRefPath }` metadata only.
- `sourcePath` must be workspace-relative, use forward slashes, avoid traversal/dot/empty segments, and end in `.xlsx` or `.pptx`.
- `contentHandle` is an opaque host/workspace upload-staging handle. This plugin does not read local files or accept absolute filesystem paths.
- `target` can include `siteUrl`, `driveId`, `folderDriveItemId`, or `folderWebUrl`; IDs/URLs are validated for credential-like data before provider calls.
- The returned `cloudRefPath` is a suggestion such as `reports/forecast.xlsx.cloud.json`; writing that ref into the workspace file tree is intentionally left to a host/workspace integration follow-up because this plugin slice has no safe workspace file IO surface.
- Returned refs are validated and contain only SharePoint metadata. Preview URLs, tokens, raw upload metadata, and absolute paths are not returned or stored.
- Upload tool shape is inferred for this mocked slice; confirm against deployed Arcade tool metadata before promoting from draft.
- Tests use mocked Arcade/provider calls only.
- no Microsoft Graph direct calls in boring-ui code
- no Claude MCP/local MCP gateway dependency
- no broad filesystem access or absolute-path upload handling
- no SharePoint-specific workspace chrome branches
