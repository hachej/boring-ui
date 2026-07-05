# B1 — Handoff

Pick this package up only in the `hachej/pi-for-office` fork. Do not implement B1 in boring-ui.

## Fresh-Agent Start

- Fork branch: `office/526-b1-host-seam`.
- Read first:
  - `docs/issues/526/office-agent-surface/VISION.md` from boring-ui.
  - `docs/issues/526/office-agent-surface/work/B1-host-seam-fork/PLAN.md` from boring-ui.
  - `manifest.xml` in upstream pi-for-excel.
  - `src/excel/helpers.ts`
  - `src/workbook/context.ts`
  - `src/context/selection.ts`
  - `src/context/change-tracker.ts`
  - `src/workbook/coordinator.ts`
  - `src/workbook/recovery-log.ts`
  - `src/tools/mutation/finalize.ts`

## Bead Checklist

- [ ] B1-001 — fork setup and discipline docs.
- [ ] B1-002 — `DocumentHost` contract and Excel adapter.
- [ ] B1-003 — PowerPoint manifest and host detection.
- [ ] B1-004 — upstream seam RFC.

## Done Definition

- `hachej/pi-for-office` has `origin` and `upstream`.
- Excel still builds and tests green.
- Existing Excel behavior routes through `DocumentHost`.
- PowerPoint host is detectable but tool implementation remains B2.
- Upstream RFC is open and linked from the fork PR.

## Review Notes

Reject broad rewrites. The seam should make host differences explicit while keeping upstream merges boring.

