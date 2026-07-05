# A2 — Connector Packaging TODO

### A2-001 — Create Integration Package And Connector File — M

- **Goal:** Move the working spike connector into boring-ui as the production review target.
- **Files to touch/create:**
  - `integrations/pi-for-excel/package.json`
  - `integrations/pi-for-excel/README.md`
  - `integrations/pi-for-excel/boring-connector.mjs`
  - `pnpm-workspace.yaml`
- **Steps:**
  1. Create `integrations/pi-for-excel/`.
  2. Copy `/home/ubuntu/projects/ext-pi-for-excel-test/boring-connector/boring-connector.mjs` to `integrations/pi-for-excel/boring-connector.mjs`.
  3. Preserve one-file shape. Do not split helpers out unless review proves the file is unmanageable.
  4. Add a package named `@hachej/boring-integration-pi-for-excel` with a `test` script.
  5. Add `integrations/*` to `pnpm-workspace.yaml`.
  6. Keep config defaults token-free and host-generic.
- **VERIFICATION:**
  - `pnpm --filter @hachej/boring-integration-pi-for-excel --fail-if-no-match exec node --check boring-connector.mjs` — exits 0; package discovery and connector syntax are valid.
- **Acceptance criteria:**
  - Connector lives under `integrations/pi-for-excel/`.
  - Connector remains one `.mjs` file.
  - No bearer token, cookie, OAuth artifact, or company hostname is embedded in source.
  - Workspace ID and base URL stay runtime config values.
- **Estimated size:** M.

### A2-002 — Add Connection Bundle Template And Runbook — M

- **Goal:** Make installation executable without relying on spike notes.
- **Files to touch/create:**
  - `integrations/pi-for-excel/connection-bundle.template.json`
  - `integrations/pi-for-excel/README.md`
  - `integrations/pi-for-excel/docs/install-runbook.md`
- **Steps:**
  1. Add a connection-bundle template with placeholders for boring-ui base URL, workspace ID, token, and allowed host.
  2. Configure auth as host-injected connection auth, matching pi docs (`/home/ubuntu/projects/ext-pi-for-excel-test/INTEGRATION-SPIKE.md:108-128`).
  3. Document sideloading the pi-for-excel manifest.
  4. Document enabling remote extension URLs with `/experimental on remote-extension-urls`.
  5. Document installing the connector from a private HTTPS URL.
  6. Document `install_code` fallback for environments where direct remote URL install is blocked.
  7. Add the self-hosting warning: do not send company workbook data through the author's Vercel deployment.
- **VERIFICATION:**
  - `node -e "const fs=require('node:fs'); JSON.parse(fs.readFileSync('integrations/pi-for-excel/connection-bundle.template.json','utf8'))"` — exits 0; connection-bundle template is valid JSON at A2-002 completion.
  - `rg -n "YOUR_|<" integrations/pi-for-excel/connection-bundle.template.json` — prints only intentional placeholders.
- **Acceptance criteria:**
  - Template includes `allowedHosts`.
  - Template does not include a real token.
  - Runbook covers sideload, remote-extension opt-in, private HTTPS install, and install-code fallback.
  - Runbook states the CORS value A1 must allow.
- **Estimated size:** M.

### A2-003 — Port The Spike Runtime Test — M

- **Goal:** Make the connector testable in boring-ui CI without Excel.
- **Files to touch/create:**
  - `integrations/pi-for-excel/tests/boring-connector-runtime.test.ts`
  - `integrations/pi-for-excel/tests/cloud-ref-validator.test.ts`
  - `integrations/pi-for-excel/vitest.config.ts`
  - `integrations/pi-for-excel/tsconfig.json`
- **Steps:**
  1. Port the spike runtime test from `tmustier/pi-for-excel` test shape (`/home/ubuntu/projects/ext-pi-for-excel-test/INTEGRATION-SPIKE.md:150-190`).
  2. Mock the pi extension API: `registerTool`, `http.fetch`, `config`, and connection auth injection.
  3. Assert the connector registers `boring_list_files`, `boring_read_file`, `boring_save_cloud_ref`, and `boring_post_note`.
  4. Assert `Authorization` is supplied by connection auth, not connector source.
  5. Assert `x-boring-workspace-id` is sent.
  6. Assert cloud-ref writes reject forbidden fields and require `siteId`, `driveId`, `driveItemId`, and `webUrl`.
  7. Assert `.xlsx.cloud.json` passes boring-sharepoint substrate validation; B2 owns PowerPoint ref-save generalization.
- **VERIFICATION:**
  - `pnpm --filter @hachej/boring-integration-pi-for-excel --fail-if-no-match run test` — exits 0; runtime and cloud-ref tests pass.
  - `pnpm --filter @hachej/boring-sharepoint run test` — exits 0.
- **Acceptance criteria:**
  - Tests fail if the connector embeds auth instead of using host-injected connection auth.
  - Tests fail if workspace header is omitted.
  - Tests fail if forbidden secret-like values enter refs.
  - Tests are CI-runnable without Office, Excel, or M365 credentials.
- **Estimated size:** M.

### A2-004 — Add Live Smoke Checklist — S

- **Goal:** Give A3 a deterministic starting point for manual live testing.
- **Files to touch/create:**
  - `integrations/pi-for-excel/docs/live-smoke.md`
  - `integrations/pi-for-excel/README.md`
- **Steps:**
  1. List required inputs: boring-ui base URL, workspace ID, workspace API token from A1, private connector URL, pi-for-excel taskpane URL, and test workbook URL.
  2. List the exact Office add-in sideload path for Excel web, macOS, and Windows using pi-for-excel install docs as source.
  3. Add expected result for each connector tool.
  4. Add a failure table for CORS, 401/403 auth failure, private URL block, and missing workbook identity.
  5. State that A3 owns full M365 workbook identity proof.
- **VERIFICATION:**
  - `rg -n "CORS|401|403|remote-extension|install_code|self-host" integrations/pi-for-excel/docs/live-smoke.md` — prints all required terms.
  - `pnpm --filter @hachej/boring-integration-pi-for-excel --fail-if-no-match run test` — exits 0.
- **Acceptance criteria:**
  - A3 can follow the smoke checklist without reading the old spike repo.
  - The doc does not include real tokens, tenant names, or workbook URLs.
  - Missing workbook identity is marked as an A3 blocker, not hidden.
- **Estimated size:** S.
