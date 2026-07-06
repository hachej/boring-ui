# PPT Feasibility (GPT-5.5 xhigh spike report, 2026-07-04)

> Provenance: authored by GPT-5.5 xhigh against the pi-for-excel clone; file:line references are into that repo at its 2026-07-04 HEAD. Reconstructed from the session transcript after the original scratchpad file was lost to a /tmp cleanup.

Short answer: a `pi-for-powerpoint` MVP is feasible, but a useful/reliable deck editor is a serious product, not a weekend clone.

1. Architecture split: source TS is roughly 316 files / 74.6k LOC. Classified ~220 files / 49.8k LOC as host-agnostic harness, ~70 files / 18.5k LOC as clearly Excel-coupled, plus ~25 files / 6.3k LOC mixed taskpane wiring. The reusable core is real: Pi deps are generic agent/UI/runtime deps (package.json:38), and `pi-agent-core` describes itself as a "General-purpose agent". But the app manifest is hard-bound to `Workbook` (manifest.xml:19, manifest.xml:31).

2. Tool isolation: there is a clean `AgentTool[]` boundary. Core tools are created in one registry (src/tools/registry.ts:45), runtime tools are composed from core + integrations + extensions (src/taskpane/init.ts:923, init.ts:956), and extension tools can register dynamically (src/extensions/runtime-manager.ts:227, runtime-manager.ts:650). So PowerPoint tools can plug in, but the built-in core list is all workbook/range/formula semantics (src/tools/names.ts:2).

3. Excel coupling: the prompt says "embedded in Microsoft Excel" and talks cells/formulas/ranges (src/prompt/system-prompt.ts:369, :425). Context injection is workbook blueprint + selection + cell changes (src/taskpane/context-injection.ts:4); selection reads `context.workbook.getSelectedRange()` (src/context/selection.ts:31); change tracking registers worksheet `onChanged` events (src/context/change-tracker.ts:26). The Office helper is a thin `Excel.run()` wrapper (src/excel/helpers.ts:23).

4. Recovery/session coupling: mutations are serialized by `WorkbookCoordinator` (src/workbook/coordinator.ts:1); taskpane init wraps every runtime tool with workbook coordination and recovery invalidation (src/taskpane/init.ts:964); workbook recovery/checkpoints are first-class (init.ts:636). This needs a generic `DocumentHost`/`DocumentCoordinator` abstraction or a PowerPoint-specific fork.

5. PowerPoint Office.js: Microsoft docs list `PowerPointApi 1.10` as latest non-preview requirement set, with 1.8 tables, 1.9 table formatting, 1.10 accessibility/background/hyperlink improvements: https://learn.microsoft.com/en-us/javascript/api/requirement-sets/powerpoint/powerpoint-api-requirement-sets. Slides can be added, counted, fetched, exported (powerpoint.slidecollection); deleted, moved, layout-applied, rendered to images, shape-selected (powerpoint.slide).

6. PowerPoint editing surface: shapes/text/tables/tags/pictures are viable. Shape collections add geometric shapes, tables, text boxes, lines/groups, and pictures via `ShapeCollection.addPicture`. Shapes expose position/size/fill/line/text frame/table/tag/z-order/delete/image render (powerpoint.shape). Text ranges expose text/font/paragraph/hyperlinks/selection (powerpoint.textrange). Tables support values, cells, merge, clear (powerpoint.table). Update 2026-07-05: corrected — ShapeCollection.addPicture is preview-only per Microsoft Learn; image insertion is preview-gated, not MVP-required.

7. Big API gaps vs Excel: no Excel-like grid/calculation/range dependency model; no first-class chart authoring/editing API comparable to Excel charts; speaker notes/animation/transition APIs are not apparent in the current PowerPoint package index (https://learn.microsoft.com/en-us/javascript/api/powerpoint). Useful deck editing is therefore layout/shape semantics plus visual verification, not a translation of range tools.

8. Prior art: no public `tmustier/pi-for-powerpoint`, no `PowerPoint` issues/PRs in `tmustier/pi-for-excel`; only an archived generic `powerpoint` skill entry in docs. Searches: github.com/search?q=%22pi-for-powerpoint%22&type=repositories and the repo's issue search.

9. Realistic path: fork-and-replace is fastest for MVP: PowerPoint manifest, `powerPointRun`, `createPowerPointTools`, new prompt/context, disable workbook recovery or replace with slide snapshot/export checkpoints. Upstreaming multi-host cleanly means abstracting host identity, context injection, tool registry, mutation policy, recovery, prompt, UI labels, and tests.

10. Estimate: 3-5 days for a spike with read deck outline, selected slide context, add/delete/move slide, add textbox/image/table. 6-12 weeks for a credible product with robust undo/checkpoints, visual diffing, layout-aware tools, cross-platform Office testing, and polished prompts. Upstream multi-host abstraction pushes this toward 10-16 weeks because Excel behavior must not regress.

11. Strategy: if the goal is "agent can edit decks," Claude's Excel+PowerPoint context sharing and headless Arcade-style `MicrosoftPowerpoint_*` tools make a native taskpane a crowded path. It is worth building only if the differentiator is open-source/BYO-model/local-bridge privacy, live in-deck selection/approval UX, or tight Pi extension workflows. Otherwise, start by exposing headless PowerPoint tools and treat native `pi-for-powerpoint` as a validated product investment.
