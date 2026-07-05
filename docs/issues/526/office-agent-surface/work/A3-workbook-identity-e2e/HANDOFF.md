# A3 — Handoff

Pick this package up after A1 and A2 are merged or available as integration branches.

## Fresh-Agent Start

- boring-ui branch: `bclaw/526-a3-workbook-identity-e2e`.
- upstream pi-for-excel branch: `office-doc-identity-extension-api`.
- Read first:
  - `docs/issues/526/office-agent-surface/VISION.md`
  - `docs/issues/526/office-agent-surface/work/A3-workbook-identity-e2e/PLAN.md`
  - `/home/ubuntu/projects/ext-pi-for-excel-test/INTEGRATION-SPIKE.md`
  - `/home/ubuntu/projects/ext-pi-for-excel-test/boring-connector/boring-connector.mjs`
  - `plugins/boring-sharepoint/README.md`
  - `plugins/boring-sharepoint/src/shared/ref.ts`

## Bead Checklist

- [ ] A3-001 — upstream open-document identity API.
- [ ] A3-002 — boring-ui Graph document resolver.
- [ ] A3-003 — connector resolver integration.
- [ ] A3-004 — live Excel E2E proof.

## Done Definition

- Upstream identity PR is open or merged.
- boring-ui resolver PR is merged.
- Connector can save refs from open workbook identity.
- Live proof shows a real M365 workbook ref rendered by boring-sharepoint and an audit note posted.
- Proof uses self-hosted taskpane and connector URLs.

## Blockers To Surface

- Missing Graph tenant/client configuration.
- Office host does not expose document URL for the target workbook.
- Taskpane origin missing from `CORS_ORIGINS`.
- Connector URL blocked by pi remote-extension source policy.

