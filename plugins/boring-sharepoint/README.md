# Boring SharePoint plugin

App/internal plugin shell for SharePoint / Microsoft 365 Office document support in boring-ui.

This package is intentionally a trusted app/internal plugin, not a runtime-generated `.pi/extensions` plugin. Future PRs will add SharePoint discovery, preview, Office agent edits, and import flows behind the contracts introduced in this shell.

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
   - Confirm Microsoft scopes needed by each capability.
   - Confirm tenant/admin consent requirements.
3. **boring-ui workspace connection**
   - Open the SharePoint app-left action or run `SharePoint: Open settings/status` from the command palette.
   - Connect or verify the workspace Arcade user mapping once provider status/auth lands.
   - Confirm status: connected / needs auth / pending auth / admin consent required / failed.
4. **Create test documents**
   - Upload a sample `.xlsx` and `.pptx` to the SharePoint document library.
   - Capture their SharePoint identity as `siteId`, `driveId`, and `driveItemId`.
5. **Validate V1 flows**
   - Open in SharePoint using `webUrl`.
   - Preview in boring-ui once the custom preview tool lands.
   - Agent-edit Excel and PowerPoint once edit providers land.
6. **Troubleshooting**
   - Auth required: reconnect SharePoint/Microsoft 365.
   - Admin consent required: tenant admin must approve Microsoft scopes.
   - Preview blocked: check tenant iframe policy, browser auth, and host CSP.
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

The app-left action opens the placeholder SharePoint / Microsoft 365 status overlay. The command opens the same status placeholder as a center panel. A future PR can replace the placeholder body with provider status and authorization controls without changing the menu path.

## Package surfaces

- `boring.front`: `dist/front/index.js`
- `boring.server`: `dist/server/index.js`
- shared contracts: `@hachej/boring-sharepoint/shared`

## Current scope

This PR adds server-only Arcade runtime primitives on top of the shell/display stack:

- `ArcadeJsToolRuntime` wraps `@arcadeai/arcadejs` behind server internals.
- Arcade tool execution uses the SDK shape `{ tool_name, user_id, input }`.
- Arcade authorization/tool auth responses normalize into shared `IntegrationAuthState` without exporting Arcade SDK types.
- Arcade config is read from the `BORING_SHAREPOINT_ARCADE_*` environment variables listed above.
- Redaction helpers keep API keys, bearer tokens, and token query strings out of logs.
- tests use mocked Arcade clients only.
- no Microsoft Graph calls
- no external network calls in tests
- no SharePoint discovery, iframe preview, edit, or provider behavior yet
- no SharePoint-specific workspace chrome branches
