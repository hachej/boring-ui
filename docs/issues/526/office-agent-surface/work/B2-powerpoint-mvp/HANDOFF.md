# B2 — Handoff

Pick this package up only after B1's `DocumentHost` seam is merged in `hachej/pi-for-office`.

## Fresh-Agent Start

- Fork branch: `office/526-b2-powerpoint-mvp`.
- Read first:
  - `docs/issues/526/office-agent-surface/VISION.md` from boring-ui.
  - `docs/issues/526/office-agent-surface/work/B2-powerpoint-mvp/PLAN.md` from boring-ui.
  - B1's merged `src/hosts/document-host.ts`.
  - B1's merged `src/hosts/powerpoint/powerpoint-document-host.ts`.
  - Microsoft PowerPoint JavaScript API reference.
  - `plugins/boring-sharepoint/src/shared/types.ts` from boring-ui.

## Bead Checklist

- [ ] B2-001 — PowerPoint context/read tools.
- [ ] B2-002 — slide mutation tools.
- [ ] B2-003 — shape, text, image, and table tools.
- [ ] B2-004 — visual verification and recovery checkpoints.
- [ ] B2-005 — connector reuse and `.pptx.cloud.json` proof.

## Done Definition

- PowerPoint read and mutation tools pass tests.
- `get_slide_image` provides visual verification.
- Mutating tools create recovery checkpoints.
- A2 connector loads unchanged.
- `.pptx.cloud.json` proof validates and renders through boring-sharepoint.

## Review Notes

Keep B2 to the MVP. Do not add chart authoring, calc semantics, animations, or speaker notes.

