# A2 — Handoff

Pick this package up after A1 has a usable token-auth branch or merged PR.

## Fresh-Agent Start

- Branch: `bclaw/526-a2-connector-packaging`.
- Read first:
  - `docs/issues/526/office-agent-surface/VISION.md`
  - `docs/issues/526/office-agent-surface/work/A2-connector-packaging/PLAN.md`
  - `/home/ubuntu/projects/ext-pi-for-excel-test/INTEGRATION-SPIKE.md`
  - `/home/ubuntu/projects/ext-pi-for-excel-test/boring-connector/boring-connector.mjs`
  - `plugins/boring-sharepoint/README.md`
  - `plugins/boring-sharepoint/src/shared/ref.ts`

## Bead Checklist

- [ ] A2-001 — create integration package and connector file.
- [ ] A2-002 — add connection bundle template and install runbook.
- [ ] A2-003 — port runtime and cloud-ref tests.
- [ ] A2-004 — add live smoke checklist.

## Done Definition

- `integrations/pi-for-excel/boring-connector.mjs` is the review target.
- Connector tests run without Excel.
- Connection auth is host-injected.
- Workspace ID is explicit.
- Install docs cover sideload, remote-extension opt-in, private HTTPS install, install-code fallback, and self-hosting.

## Review Notes

Do not generalize this into a multi-host integration package yet. B2 verifies host-agnostic reuse after the PowerPoint fork exists.

