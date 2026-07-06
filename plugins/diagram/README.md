# Diagram plugin

Boring workspace plugin for `.excalidraw` and `.excalidraw.png` files.

- Registers a `workspace.open.path` surface resolver for supported diagram files (`.excalidraw`, `.excalidraw.png`).
- Uses the native `@excalidraw/excalidraw` React component (no iframe/CDN bridge).
- Autosaves JSON with debouncing, queued writes, and `expectedMtimeMs` conflict detection.
- Opening an embedded `.excalidraw.png` imports the scene and saves editable JSON beside it as `<name>.excalidraw`.
- Listens for workspace file events and reloads when an agent or external process changes the open diagram.
- Provides a Render drawer that exports the current diagram sketch and calls Pi AI image generation through OpenRouter-backed image models.

## Image rendering

Rendering is server-side; API keys are never sent to the browser.

Set one of:

```bash
OPENROUTER_API_KEY=...
# or
BORING_DIAGRAM_OPENROUTER_API_KEY=...
# legacy alias also works:
BORING_EXCALIDRAW_OPENROUTER_API_KEY=...
```

Optional default model:

```bash
BORING_DIAGRAM_RENDER_MODEL=google/gemini-3-pro-image-preview
```

Rendered files are written beside the source diagram:

```txt
diagram.excalidraw
diagram.render.png
diagram.render.json
```
