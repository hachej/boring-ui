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
   - Confirm Microsoft scopes needed by each capability.
   - Confirm tenant/admin consent requirements.
3. **boring-ui workspace connection**
   - Open the SharePoint / Microsoft 365 integration entry in the boring-ui MCP/integrations menu.
   - Connect or verify the workspace Arcade user mapping.
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

## Existing MCP/integrations menu audit

PR 1 only audits and documents the current menu integration path; it does not add a new menu registry.

Current documented front plugin surfaces in `definePlugin` are:

- `panels`
- `commands`
- `leftTabs`
- `catalogs`
- `surfaceResolvers`
- `providers` / `bindings`
- `toolRenderers`

There is no documented generic `integrations` contribution in `definePlugin` today. The selected path for PR 2 is to add the smallest generic integration-menu contribution surface to the existing MCP/integrations menu, then have this plugin contribute data to that surface:

```ts
interface WorkspaceIntegrationContribution {
  id: string
  pluginId: string
  label: string
  description?: string
  statusEndpoint?: string
  openCommandId: string
  capabilities?: string[]
}
```

The SharePoint contribution should be data/config only:

```txt
id: sharepoint
pluginId: boring-sharepoint
label: SharePoint / Microsoft 365
openCommandId: boring-sharepoint.open-settings
capabilities: office.preview, office.excel.edit, office.powerpoint.edit
```

If PR 2 discovers an existing generic integration registry in the MCP menu, use that instead and document the files/API in the PR. It must not hard-code SharePoint-specific branches in workspace chrome.

## Package surfaces

- `boring.front`: `dist/front/index.js`
- `boring.server`: `dist/server/index.js`
- shared contracts: `@hachej/boring-sharepoint/shared`

## Current scope

This PR is shell + contracts only:

- no Arcade SDK dependency
- no Microsoft Graph calls
- no external network calls
- no preview panel behavior beyond future contracts
- no integration menu registry changes
