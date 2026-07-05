# A3 — Workbook Identity E2E Plan

## Today / Delta

Today, the connector can save a cloud ref only when the caller already supplies SharePoint identity fields. Its helper requires `webUrl`, `siteId`, `driveId`, and `driveItemId` (`/home/ubuntu/projects/ext-pi-for-excel-test/boring-connector/boring-connector.mjs:167-199`). Current pi-for-excel extension APIs do not expose open workbook identity to extensions (`/home/ubuntu/projects/ext-pi-for-excel-test/INTEGRATION-SPIKE.md:142-149`, `src/commands/extension-api-types.ts:197-228` in the pi-for-excel source reviewed for this pack).

Delta: add a minimal upstream open-document identity API, add a boring-ui resolver that maps a SharePoint document URL to stable IDs, and prove the live loop with a real M365 workbook.

## Resolver Decision

Use Microsoft Graph direct in boring-ui. Do not use Arcade SDK.

Reason: the boring-sharepoint plugin deliberately has no Graph/Arcade routes and stores only durable SharePoint document identity (`plugins/boring-sharepoint/README.md:17-24`, `plugins/boring-sharepoint/README.md:63-78`). A direct Graph resolver is the smallest server route needed by the connector and keeps the cross-pack gate intact.

## Deliverables

- Upstream `tmustier/pi-for-excel` PR exposing open-document identity to extensions.
- Interim doc for `execute_office_js` fallback that reads `Office.context.document.url`.
- boring-ui route resolving SharePoint document URL to `{siteId, driveId, driveItemId}`.
- Connector update to call the resolver and save `.xlsx.cloud.json` without manual IDs.
- Live E2E proof: sideloaded add-in, real hub, real M365 workbook, saved cloud ref rendered by #515 panel, and `boring_post_note` audit.
- Self-hosting runbook for taskpane and connector assets.

## Open-Document API Shape

Smallest acceptable upstream API:

```ts
api.office.getOpenDocumentIdentity(): Promise<{
  host: "excel";
  url: string | null;
  name: string | null;
}>;
```

The API must not expose tokens, cookies, tenant secrets, or Graph access. It only reports the currently open Office document identity available from Office.js.

## Boring-UI Resolver Shape

Route:

```text
POST /api/v1/office/sharepoint/resolve
```

Request:

```json
{"webUrl":"https://..."}
```

Response:

```json
{"name":"...", "webUrl":"https://...", "siteId":"...", "driveId":"...", "driveItemId":"..."}
```

The route must require workspace auth, redact inputs from logs, reject non-HTTPS URLs, and return stable error codes.

## Exit Criteria

- The connector can start from the live workbook URL and save a valid `.xlsx.cloud.json` ref.
- The boring-sharepoint panel renders that ref.
- `boring_post_note` writes an audit note.
- The live proof uses self-hosted taskpane and connector URLs.
- No token, cookie, OAuth artifact, preview URL, or local absolute path enters a ref or tool result.

