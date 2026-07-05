# B2 — Handoff

Pick this package up only after B1's `DocumentHost` seam is merged in `hachej/pi-for-office`.

## Fresh-Agent Start

- Fork branch: `office/526-b2-powerpoint-mvp`.
- boring-ui branch for B2-005: `bclaw/526-b2-office-ref-generalization`.
- Read first:
  - `docs/issues/526/office-agent-surface/VISION.md` from boring-ui.
  - `docs/issues/526/office-agent-surface/work/B2-powerpoint-mvp/PLAN.md` from boring-ui.
  - B1's merged `src/hosts/document-host.ts`.
  - B1's merged `src/hosts/powerpoint/powerpoint-document-host.ts`.
  - Microsoft PowerPoint JavaScript API reference.
  - `plugins/boring-sharepoint/src/shared/types.ts` from boring-ui.

## Bead Order

Execute beads in TODO.md order. INDEX.md is the only package-ordering authority.

## Done Definition

- PowerPoint read and mutation tools pass tests.
- `get_slide_image` provides visual verification.
- Mutating tools create recovery checkpoints.
- A2 connector list/read/note behavior loads unchanged.
- `.pptx.cloud.json` proof validates and renders through boring-sharepoint.

## Review Notes

Keep B2 to the MVP. Do not add chart authoring, calc semantics, animations, or speaker notes.
