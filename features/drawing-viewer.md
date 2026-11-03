# Drawing viewer

The `drawing-viewer` registry item ([registry/drawing-viewer/](../registry/drawing-viewer/)) shows an Excalidraw (`.excalidraw`) or draw.io (`.drawio`) file read-only, as the tool itself draws it: Excalidraw with its own library (`restore` then `exportToSvg`, hand-drawn strokes and its fonts), draw.io with the official diagrams.net viewer, vendored and pinned in the kit as `@hachej/boring-ui-kit/drawio-viewer` and run in a sandboxed frame without network. Both land as an SVG image on a white page fitted to the shapes, and `onRead` hands what the renderer read so an app can describe the drawing to a model (D-1398, asked for YouTube Visual).

## Sub-features

- `drawing-excalidraw`: an `.excalidraw` scene drawn by Excalidraw on a white page: rectangles, ellipses, diamonds, lines, arrows (bound arrows end on the outlines), text, freehand, a container's text as its label, deleted elements left out. Code: [excalidraw-render.ts](../registry/drawing-viewer/excalidraw-render.ts).
- `drawing-drawio`: a `.drawio` file, plain or compressed `<diagram>`, drawn by the diagrams.net viewer (`Graph.getSvg`): vertices in groups and containers, edges with bend points and labels, every shape and style the viewer knows. Code: [drawio-render.ts](../registry/drawing-viewer/drawio-render.ts), [drawio-frame.ts](../registry/drawing-viewer/drawio-frame.ts).
- `drawing-parse`: `onRead(drawing)` with the shapes (kind, place, size, label without HTML, stroke, fill, parent) and arrows (from, to, points, label), read from the native model: Excalidraw's restored elements and draw.io's own graph model and view. `describeDrawing` turns it into text for a model. Code: [drawing.ts](../registry/drawing-viewer/drawing.ts).
- `drawing-safety`: nothing in a file runs and nothing leaves the app. The result is an image from a blob URL; the draw.io viewer runs in a `sandbox="allow-scripts"` frame whose policy allows only its nonce scripts and no network; Excalidraw's fonts come from the app (`excalidrawAssets`, default `/excalidraw/`) or are skipped: Excalidraw's fallback request to its CDN is refused, and an export that then fails is drawn again without fonts. What the frame refused is passed to `onRead` (`blocked`).
- `drawing-error`: an unreadable, unknown or empty file shows an inline error (English or French) instead of a drawing.
- `drawing-kind`: `drawingKind` and `createDrawingKind` match `.excalidraw` and `.drawio` paths for an app's `artifactKinds`. Not in the pi-app-kinds defaults; each renderer loads the first time a drawing of its format opens. Code: [drawing-kind.tsx](../registry/drawing-viewer/drawing-kind.tsx).

## How to get to it (user POV)

An app installs the item (`npx shadcn add <release>/drawing-viewer.json`), serves `node_modules/@excalidraw/excalidraw/dist/prod/fonts` at `/excalidraw/fonts` (or passes `excalidrawAssets`), and either renders `<DrawingViewer text={fileText} path={name} onRead={...} />` or adds `drawingKind` to its artifact kinds so a presented `.excalidraw` or `.drawio` file opens as a drawing.

## Driving it with the example journey

`npm run drawing:journey` ([examples/drawing-viewer/journey.mjs](../examples/drawing-viewer/journey.mjs)) in headless Chromium over the fictional fixtures in [test/fixtures/drawing/](../test/fixtures/drawing/):

1. `drawing-excalidraw`: open `?only=oakfield-garden.excalidraw&native`; the block's image sits beside the Excalidraw editor in view mode (screenshot `excalidraw-block-vs-native-1440.png`).
2. `drawing-drawio`: open `?only=bakery-morning.drawio&native`; the block beside draw.io's own HTML embed (screenshot `drawio-block-vs-native-1440.png`).
3. `drawing-parse`: the default page; `window.__drawings.read` holds each parse (written to `parse.json`), and the plain file reads as the compressed one.
4. `drawing-error` and `drawing-safety`: the broken and unknown files show the error; no fixture script ran, no request left the origin and no policy violation happened; the draw.io frame reports the remote image it refused; then `?fonts=partial` (only one font served) and `?fonts=missing` draw and attempt no CDN request.
5. `drawing-kind`: every block row is drawn through `drawingKind.renderer`; `node --test test/contracts/drawing-viewer.test.mjs` checks its matches, its inline error and that the kind loads no renderer up front.

## Gotchas

- The page's own policy must allow the inline nonce script of a `srcdoc` frame (`script-src` with `'unsafe-inline'`, as for the mockup viewer) and `blob:` images.
- draw.io parts the viewer would fetch (remote images, stencils outside its static bundle, web fonts) stay blank: the frame has no network by design.
- Without the fonts served, Excalidraw text draws in a system font. The kit's `drawio-viewer` subpath is 4.4 MB of text, loaded only when a draw.io file opens; update it with `node scripts/vendor-drawio-viewer.mjs`.
