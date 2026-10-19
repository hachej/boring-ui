# Canvas board spike

Spike, not a shipped block: a `*.board.json` file (format `board@1`, see `board.ts`) opens a tldraw canvas in the real pi-app `ArtifactPanel`. Each maquette screen becomes a frame drawn with the registry's `MaquetteScreenView`, `goto` links become arrows, an `*.mockup.html` file becomes a frame holding the page in the html viewer's sandbox (`allow-scripts` only), and sticky notes are tldraw notes. People's moves and notes are published back into the board file through the workspace provider (conditional on the revision). Comment mode turns a tap on any element, including inside the sandboxed HTML frame (postMessage), into a `feedback@1` report with a `board.element@1` anchor.

```sh
npm run canvas-board            # the page on 127.0.0.1:4310 (?open=board|mockup|maquette, &csp=strict)
npm run canvas-board:journey    # CHROMIUM=... real-browser journey, desktop 1440 and phone 390, evidence under .cache/evidence/canvas-spike/
```

tldraw's fonts, icons and translations are unpacked from `@tldraw/assets` (same version as `tldraw`) into `.cache/tldraw-assets` and served from the page's origin. Without `TLDRAW_LICENSE_KEY` the SDK runs keyless on localhost (watermark shown). Fictional fixtures only.
