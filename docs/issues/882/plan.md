---
github: https://github.com/hachej/boring-ui/issues/882
issue: 882
state: ready-for-agent
updated: 2026-07-21
flag: not-needed
track: fast
---

# gh-882 Diagram plugin: support tldraw as an alternative to Excalidraw

## Problem

The diagram plugin currently routes diagram files to an Excalidraw-based editor. The user wants tldraw support as an alternative, inspired by https://offline.tldraw.com/.

## Solution

Plan and implement tldraw as a second diagram backend rather than replacing Excalidraw. Add explicit file routing for a tldraw workspace format, a tldraw editor pane path, and persistence through the same workspace file APIs used by the diagram plugin.

Recommended first implementation:
- Keep existing `.excalidraw` and `.excalidraw.png` behavior unchanged.
- Add a tldraw-specific extension such as `.tldr` or `.tldraw` after confirming the SDK persistence format.
- Split the current Excalidraw-specific pane code so the plugin routes by file kind to either `ExcalidrawDiagramPane` or `TldrawDiagramPane`.
- Use workspace file read/write and optimistic conflict behavior analogous to the existing diagram pane.

## Decisions

- Do not replace Excalidraw in this issue.
- Do not depend on the external offline.tldraw.com app at runtime; use local packaged code if feasible.
- Treat tldraw as an adapter/backend equivalent to the Excalidraw pane if feasible, with tldraw persistence format, license/watermark constraints, and plugin-runtime asset bundling as the main spike risks before building UI polish.
- Do not require offline.tldraw.com import/export compatibility for the first implementation unless the spike proves it is the natural/cheap path.

## Flag / Abstraction
- Needed?: no runtime feature flag for first additive support; route only files with the new tldraw extension.
- Path: file-kind router and separate pane components.
- Rollback: remove tldraw extension resolver/pane/dependency; Excalidraw remains untouched.

## Test Seams
- Highest public seam: `isDiagramPath`/surface resolver test for tldraw paths plus pane persistence test if feasible.
- Existing prior art: `plugins/diagram/src/shared/index.test.ts`, `plugins/diagram/src/front/index.tsx`, `DiagramPane.tsx`.
- Avoid testing: tldraw internals; test our routing, serialization boundary, and workspace writes.

## Acceptance

- Spike confirms whether a tldraw adapter equivalent to the current Excalidraw pane is feasible.
- If feasible, a supported tldraw diagram file opens through `workspace.open.path` in the diagram plugin.
- Existing Excalidraw files still open exactly as before.
- Editing a tldraw file persists to the workspace and reopens correctly.
- Unsupported diagram/image paths are not accidentally routed to tldraw.
- Dependency/build impact is understood and acceptable.

## Proof
- Exact command: diagram plugin shared/front tests and package build/typecheck.
- Screenshot/demo: tldraw file opens, edits, saves, and reloads.
- Manual steps: create/open `example.tldraw` or chosen extension, draw something, save/reload, verify persistence.
- Waiver if proof is not possible: spike note explaining SDK/file-format blocker and recommended follow-up.

## Slices

### Slice: tldraw persistence/license/bundling spike and routing decision
**Delivers:** confirmed extension/file format, dependency choice, license/watermark answer, asset/externalization strategy, and minimal routing changes plan.
**Blocked by:** None.
**Proof:** notes with code/doc references and shared route tests.
**Review budget:** inside.

### Slice: tldraw dependency and asset integration
**Delivers:** package/build wiring for the selected tldraw dependency without changing Excalidraw behavior.
**Blocked by:** tldraw spike.
**Proof:** package build/typecheck and minimal import/render smoke test if feasible.
**Review budget:** inside.

### Slice: tldraw editor pane
**Delivers:** local tldraw pane with read/write persistence and regression tests.
**Blocked by:** tldraw dependency and asset integration.
**Proof:** focused tests plus manual demo.
**Review budget:** inside.

## Out of Scope

- Converting Excalidraw files to tldraw.
- Collaboration/multiplayer tldraw features.
- External offline.tldraw.com import/export unless the SDK makes it trivial.
- Rewriting the diagram image rendering AI flow.

## Grill / Unknowns

### Known-knowns
- Current plugin is Excalidraw-specific in `DiagramPane.tsx` and routes via `isDiagramPath` in shared code.
- Excalidraw dependency is already externalized/configured in `plugins/diagram/tsup.config.ts`.

### Known-unknowns
- Which tldraw package and persistence API should be used.
- Which extension/format should be canonical for workspace files.
- Whether tldraw CSS/assets create bundling constraints in the plugin runtime.
- Whether tldraw licensing/watermark terms are acceptable for this app.

### Unknown-knowns
- Users may expect offline.tldraw.com-compatible files, not just any tldraw SDK snapshot; this compatibility expectation should be made explicit.

### Unknown-unknowns / blindspots
- **Scale:** tldraw snapshots/assets may grow large; autosave strategy may need debounce/conflict handling similar to Excalidraw.
- **Security:** embedded assets/URLs in tldraw documents must not bypass workspace/file sandbox expectations.
- **Failure modes:** a failed save cannot silently corrupt the JSON document; conflict detection matters.
- **Migration:** adding `.tldraw` to generic diagram routing may affect existing file open behavior.
- **Rollback:** additive extension-based routing is safely reversible.

**Resolved decision:** Let the spike decide feasibility and compatibility. First goal is an Excalidraw-equivalent adapter backed by tldraw; offline.tldraw.com import/export is not required unless it falls out naturally.
**Why it matters:** Offline-app compatibility may dictate extension, schema, asset handling, and import/export work; SDK-native persistence is much smaller.
**Evidence:** The issue references `offline.tldraw.com`, but user clarified the desired shape is likely just the equivalent of Excalidraw backed by tldraw, if possible.
**Chosen answer:** spike first; implement editor pane only after adapter feasibility, format, bundling, and license/watermark constraints are understood.

## Next Action

`/exec #882` for spike slice first, then continue with editor pane if the spike confirms feasibility.
