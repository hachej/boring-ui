# Boring SharePoint plugin

Front-only SharePoint / Microsoft 365 Office cloud-reference substrate for boring-ui.

This package owns the durable `*.xlsx.cloud.json` and `*.pptx.cloud.json` reference format plus the front display surface that opens those files in the workspace. It no longer runs Arcade server code, Microsoft Graph calls, Office preview URL minting, import, or document editing.

## Current Scope

- Shared ref schema and validators for SharePoint-backed Excel and PowerPoint documents.
- Import/ref-building helpers that future agent-runtime import flows can reuse.
- Display helpers for cloud-ref paths and SharePoint document identity.
- A front surface resolver for `*.xlsx.cloud.json` and `*.pptx.cloud.json`.
- A front panel that reads the ref file through the workspace raw-file API, validates it, shows document identity, and links to `webUrl`.

## Deferred Scope

Office editing, local Office import, and transient preview URL minting now belong to future pi-agent-runtime Excel/PowerPoint plugins that use Arcade MCP tools. The expected agent-side tool surface is:

- `MicrosoftExcel_*`
- `MicrosoftPowerpoint_*`
- `MicrosoftSharepoint_*`
- `BoringSharePointPreview_CreatePreviewUrl`

Those plugins should own Microsoft/Arcade auth UX, execution, import/writeback behavior, and any preview URL creation. This package should stay route-free and display-focused.

## Ref Format

Excel refs use:

```txt
<workspace-path>.xlsx.cloud.json
```

PowerPoint refs use:

```txt
<workspace-path>.pptx.cloud.json
```

The JSON payload is a `SharePointDocumentRef`:

```json
{
  "kind": "office-cloud-document",
  "provider": "sharepoint",
  "version": 1,
  "name": "forecast.xlsx",
  "officeKind": "excel",
  "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "webUrl": "https://tenant.sharepoint.com/sites/team/Shared%20Documents/forecast.xlsx",
  "siteId": "tenant.sharepoint.com,site-id,web-id",
  "driveId": "drive-id",
  "driveItemId": "item-id",
  "createdFrom": {
    "type": "local-import",
    "originalPath": "reports/forecast.xlsx"
  }
}
```

## Trust Boundary

- boring-ui stores only durable SharePoint document references.
- `*.xlsx.cloud.json` and `*.pptx.cloud.json` files must never contain tokens, cookies, preview URLs, OAuth artifacts, Arcade tool names, or absolute local paths.
- `webUrl` is a human open link, not durable identity. Durable identity is `siteId`, `driveId`, and `driveItemId`.
- Preview URLs returned by Microsoft Graph `driveItem:preview` are transient token-bearing URLs. They must be minted on demand by the future agent-runtime preview tool and must never be stored in refs.
- Arcade and Microsoft OAuth grants belong to the agent-runtime tool layer, not this display substrate.

## Front Behavior

The surface resolver maps Office cloud-ref files to the SharePoint panel. The panel:

1. Uses `params.sharePointRef` as an optional fast path when the opener already supplied a valid ref.
2. Otherwise reads `params.path` through `/api/v1/files/raw?path=<workspace-relative-path>` with `credentials: "include"` and the `x-boring-workspace-id` header when available.
3. Parses and validates the JSON with the shared ref parser.
4. Renders document metadata and an `Open in SharePoint` link using `webUrl`.

There is no iframe preview and no `/api/sharepoint/*` route in this package.

## Package Surfaces

- `boring.front`: `dist/front/index.js`
- shared contracts: `@hachej/boring-sharepoint/shared`

The package manifest intentionally omits `boring.server`.

## Operator Notes

- Configure Arcade and Microsoft consent in the future Excel/PowerPoint pi-agent-runtime plugins, not here.
- Confirm Microsoft tenant/admin consent for the Arcade MCP tools those plugins use.
- If preview links are needed, deploy/enable the agent-side `BoringSharePointPreview_CreatePreviewUrl` tool and keep its token-bearing output out of persisted refs.
- When troubleshooting this package, inspect stable `SHAREPOINT_*` validation/read error codes and the ref JSON file contents first.
