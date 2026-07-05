# B2 — PowerPoint MVP Plan

## Today / Delta

Today, the verified host code is Excel-only. PowerPoint support does not exist in upstream pi-for-excel. The boring-sharepoint substrate already accepts PowerPoint refs through `officeKind: "powerpoint"` and `.pptx.cloud.json` (`plugins/boring-sharepoint/src/shared/types.ts:1-21`, `plugins/boring-sharepoint/README.md:28-38`). Microsoft PowerPoint JavaScript APIs expose presentation, slide, shape, table, text range, and `PowerPoint.run` primitives in the documented package reference consulted for this pack.

Delta: in `hachej/pi-for-office`, add a PowerPoint host implementation and MVP tool set on top of B1's `DocumentHost` seam. A2 connector list/read/note tools must load unchanged; PowerPoint ref saving needs explicit Office-ref generalization.

PowerPoint feasibility report: `work/B1-host-seam-fork/_ppt-feasibility-report.md` (reconstructed). Treat the non-goals below as fixed scope for this pack, and re-check API ceilings before any later expansion.

## MVP Tool Set

- Deck outline.
- Selected-slide context.
- Add slide.
- Delete slide.
- Move slide.
- Apply slide layout.
- Insert textbox.
- Insert table.
- Text-range edits.
- `get_slide_image` for visual verification.

## Prompt And Context

Add a PowerPoint system prompt and slide-blueprint context injection. The prompt should make slide operations explicit and discourage spreadsheet language.

## Recovery Model

Use slide snapshot/export checkpoints. For every mutating operation, record enough before/after state to support recovery or manual repair.

## Explicit Non-Goals

- Chart authoring.
- Calc semantics.
- Animations.
- Speaker notes.
- Production image insertion through preview-only `ShapeCollection.addPicture`.

Do not add these in B2 even if a later API review finds partial support.

## Connector Reuse

The A2 connector should remain host-agnostic. Its list/read/note tools load unchanged in PowerPoint. Saving `.pptx.cloud.json` refs requires a small Office-ref generalization, and B2 must prove those refs validate and render through boring-sharepoint.

## Exit Criteria

- PowerPoint host tools pass unit tests and a manual sideload smoke.
- `get_slide_image` returns usable visual verification output.
- Mutations create recovery checkpoints.
- A2 connector list/read/note behavior loads unchanged.
- `.pptx.cloud.json` proof validates in boring-sharepoint.
