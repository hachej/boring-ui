# Dock example

A fictional host app ("Journal") in `DockMain`, an agent chat in a `Dock` on its left and a files `Dock` on its right, from `registry/pi-workspace/dock.tsx`. Docked, the chat is `PiChat`; dragging its divider below 260px (or Alt+Left on it, or a phone) floats it as `AmbientChat` on the same controller, and its Dock button puts it back at its last width. The files dock is closed at first, opened by the chat header's Files button (`useDock('files')`) or the app's own, and is a full-screen sheet on a phone. Usage and options: [Docks](../../registry/README.md#docks-pi-workspace).

```sh
npm run dock-app           # the page on a local port
npm run dock-app:journey   # real-browser journey (scripted model, no key), screenshots under .cache/evidence/dock-app/
```

The server only serves the page and the chat transport; `STUDIO_MODEL=scripted` (set by the journey) answers from `script.mjs` instead of a provider.
