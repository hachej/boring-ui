# B2 — PowerPoint MVP Plan

## Today / Delta

Today, the verified host code is Excel-only. PowerPoint support does not exist in upstream pi-for-excel. The boring-sharepoint substrate already accepts PowerPoint refs through `officeKind: "powerpoint"` and `.pptx.cloud.json` (`plugins/boring-sharepoint/src/shared/types.ts:1-21`, `plugins/boring-sharepoint/README.md:28-38`). Microsoft PowerPoint JavaScript APIs expose presentation, slide, shape, table, text range, image, and `PowerPoint.run` primitives in the documented package reference consulted for this pack.

Delta: in `hachej/pi-for-office`, add a PowerPoint host implementation and MVP tool set on top of B1's `DocumentHost` seam. The A2 connector must load unchanged.

The requested PowerPoint feasibility report was unavailable in this session. Treat the non-goals below as fixed scope for this pack, and re-check API ceilings before any later expansion.

## MVP Tool Set

- Deck outline.
- Selected-slide context.
- Add slide.
- Delete slide.
- Move slide.
- Apply slide layout.
- Insert textbox.
- Insert image.
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

Do not add these in B2 even if a later API review finds partial support.

## Connector Reuse

The A2 connector should remain host-agnostic. It reads/writes workspace files, saves cloud refs, and posts notes. B2 must prove that it loads unchanged in PowerPoint and that `.pptx.cloud.json` refs validate and render through boring-sharepoint.

## Exit Criteria

- PowerPoint host tools pass unit tests and a manual sideload smoke.
- `get_slide_image` returns usable visual verification output.
- Mutations create recovery checkpoints.
- A2 connector file loads unchanged.
- `.pptx.cloud.json` proof validates in boring-sharepoint.

