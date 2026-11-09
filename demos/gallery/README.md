# Kit gallery

The kit in its default style, in the real `AppShell`, on fictional data. One page to open and click through, like a system-design page.

```
npm run gallery:build        # builds the workspace packages, then writes .cache/gallery/index.html
```

The file is self-contained: JS and CSS inline, the mono font embedded, no external URL, no network. CI uploads it as the `kit-gallery` artifact.

- Sections (the nav): Bases, Blocs d'app, Chat, Visionneuses, Coquille. One file each in [`sections/`](sections/).
- Header: light/dark, compact density, and the Téléphone entry (a 390px frame of this page in Coquille).
- Chat runs over the scripted controller in [`chat-controller.js`](chat-controller.js): a question, an approval, then free replies. No model.
- `?theme=dark` starts dark; `#chat` starts on a section.
- The build is [`scripts/gallery-build.mjs`](../../scripts/gallery-build.mjs); the test is `test/contracts/gallery.test.mjs`; the feature file is [`features/gallery.md`](../../features/gallery.md).

Not in this slice: the viewers (a placeholder card) and the agent-bar block (a marked slot until D-1978 is on main).
