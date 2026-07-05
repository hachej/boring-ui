# A3 — Workbook Identity E2E TODO

### A3-001 — Add Upstream Open-Document Identity API — M

- **Goal:** Let extensions read the open Office document URL without `execute_office_js`.
- **Landing repo:** `tmustier/pi-for-excel`.
- **Files to touch/create:**
  - `src/commands/extension-api-types.ts`
  - `src/commands/extension-api.ts`
  - `src/extensions/runtime-manager.ts`
  - `src/extensions/runtime-manager-activation.ts`
  - `docs/extensions.md`
  - `tests/extension-open-document-identity.test.ts`
- **Steps:**
  1. Add `api.office.getOpenDocumentIdentity()` to the extension API type.
  2. Implement it by reading the current Office document URL/name from the host side.
  3. Return `{host:"excel", url, name}` with `url` nullable when Office does not expose it.
  4. Do not expose tokens, cookies, tenant ids, Graph ids, or auth headers.
  5. Document `execute_office_js` as an interim fallback only.
  6. Add tests for URL present, URL absent, and sanitized return shape.
- **VERIFICATION:**
  - `pnpm test -- extension-open-document-identity` — exits 0; identity API tests pass.
  - `pnpm typecheck` — exits 0.
  - `pnpm build` — exits 0.
- **Acceptance criteria:**
  - Extension authors can call one typed API for the open document identity.
  - Returned data includes no auth material.
  - Existing extension APIs remain backward compatible.
  - Upstream PR text includes why this avoids unsafe arbitrary Office.js fallback for normal identity reads.
- **Estimated size:** M.

### A3-002 — Add Boring-UI Graph Document Resolver — L

- **Goal:** Resolve a SharePoint document URL to durable IDs for cloud refs.
- **Landing repo:** `hachej/boring-ui`.
- **Files to touch/create:**
  - `packages/core/src/server/routes/officeSharePointResolve.ts`
  - `packages/core/src/server/routes/__schemas__/officeSharePointResolve.ts`
  - `packages/core/src/server/routes/index.ts`
  - `packages/core/src/server/config/loadConfig.ts`
  - `packages/core/src/server/office/graphDocumentResolver.ts`
  - `packages/core/src/server/office/graphDocumentResolver.test.ts`
  - `packages/core/src/server/routes/officeSharePointResolve.test.ts`
- **Steps:**
  1. Add config for Graph tenant/client credentials using environment variables; do not require them unless the resolver route is called.
  2. Add `POST /api/v1/office/sharepoint/resolve` guarded by workspace auth.
  3. Validate request body as `{webUrl}`.
  4. Reject non-HTTPS URLs and localhost/private URLs.
  5. Convert the URL to Graph `/shares/u!<base64url>/driveItem`.
  6. Return only `{name, webUrl, siteId, driveId, driveItemId}`.
  7. Add stable error codes for missing config, invalid URL, Graph auth failure, Graph not found, and Graph upstream failure.
  8. Ensure logs and error payloads do not include bearer tokens or Graph credentials.
- **VERIFICATION:**
  - `pnpm --filter @hachej/boring-core run test -- graphDocumentResolver officeSharePointResolve` — exits 0; resolver and route tests pass.
  - `pnpm --filter @hachej/boring-core run typecheck` — exits 0.
  - `pnpm lint:invariants` — exits 0.
- **Acceptance criteria:**
  - Route works for a mocked SharePoint document URL and returns stable SharePoint IDs.
  - Route rejects non-HTTPS and private URLs.
  - Route requires workspace auth from Better Auth or A1 token auth.
  - No Arcade SDK dependency is added to boring-ui.
- **Estimated size:** L.

### A3-003 — Update Connector To Resolve And Save Workbook Refs — M

- **Goal:** Remove manual SharePoint ID entry from the happy path.
- **Landing repo:** `hachej/boring-ui`.
- **Files to touch/create:**
  - `integrations/pi-for-excel/boring-connector.mjs`
  - `integrations/pi-for-excel/tests/boring-connector-runtime.test.ts`
  - `integrations/pi-for-excel/docs/live-smoke.md`
  - `integrations/pi-for-excel/docs/live-e2e.md`
- **Steps:**
  1. Call `api.office.getOpenDocumentIdentity()` when available.
  2. Fall back to documented `execute_office_js` only when the upstream API is unavailable.
  3. Send the document URL to `/api/v1/office/sharepoint/resolve`.
  4. Build the `.xlsx.cloud.json` ref from the resolver response.
  5. Preserve the existing manual ID path as an explicit fallback.
  6. Add tests for identity API, fallback path, resolver success, resolver failure, and forbidden field redaction.
- **VERIFICATION:**
  - `pnpm --filter @hachej/boring-integration-pi-for-excel run test` — exits 0; connector resolver tests pass.
  - `pnpm --filter @hachej/boring-sharepoint run test` — exits 0.
- **Acceptance criteria:**
  - Happy path starts with the open workbook URL and writes a valid ref.
  - Manual ID entry is no longer needed for SharePoint workbooks.
  - Connector still fails closed when identity or resolver data is missing.
  - Tool output does not include tokens or Graph credentials.
- **Estimated size:** M.

### A3-004 — Run Live Excel E2E And Record Proof — L

- **Goal:** Prove the full loop with real Office, real hub, and real M365 workbook.
- **Landing repo:** `hachej/boring-ui`.
- **Files to touch/create:**
  - `integrations/pi-for-excel/docs/live-e2e.md`
  - `docs/issues/526/office-agent-surface/work/A3-workbook-identity-e2e/HANDOFF.md`
- **Steps:**
  1. Set `BORING_OFFICE_E2E_BASE_URL` to the self-hosted boring-ui URL.
  2. Set `BORING_OFFICE_E2E_WORKSPACE_ID` to the test hub workspace.
  3. Create an A1 workspace API token and store it only in the local secret manager or shell environment.
  4. Set `BORING_OFFICE_E2E_CONNECTOR_URL` to the self-hosted connector URL.
  5. Set `BORING_OFFICE_E2E_WORKBOOK_URL` to a real SharePoint workbook URL.
  6. Sideload the pi add-in into Excel and install the connector through the private HTTPS URL or install code.
  7. Run `boring_save_cloud_ref` from the taskpane.
  8. Confirm the `.xlsx.cloud.json` file appears in the workspace and renders in the boring-sharepoint panel.
  9. Run `boring_post_note` and confirm the audit note lands.
  10. Paste redacted proof into `integrations/pi-for-excel/docs/live-e2e.md`.
- **VERIFICATION:**
  - Manual: `boring_save_cloud_ref` returns success and the created ref validates against boring-sharepoint schema.
  - Manual: the #515 SharePoint panel renders the created ref with "Open in SharePoint".
  - Manual: `boring_post_note` writes a visible audit note.
  - `rg -n "Bearer|Authorization|refresh_token|access_token|client_secret|cookie" integrations/pi-for-excel/docs/live-e2e.md` — exits 1.
- **Acceptance criteria:**
  - Proof includes date, self-hosted taskpane origin, connector version, workspace path, and redacted screenshots or transcripts.
  - Proof excludes tokens, tenant secrets, cookies, and raw auth headers.
  - Any failure is recorded with the exact failing step and stable error code.
- **Estimated size:** L.

