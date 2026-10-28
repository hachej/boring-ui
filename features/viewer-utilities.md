# Viewer utilities

Registry presentation shares media subscriptions and nonfatal browser persistence through `utils`; these conveniences own no conversation or Pi execution state.

## Sub-features

- `viewer-phone-layout` phone means strictly below 768 CSS pixels across chat, ambient, app-shell, shared chat, viewers and windows; coarse pointers alone do not select phone layout. `registry/utils/use-media.ts`.
- `viewer-keyboard-inset` visual viewport resize/scroll updates the chat's element-relative keyboard inset; pinch zoom retains the last unzoomed box and teardown releases observers. `registry/utils/use-media.ts`.
- `viewer-layout-persistence` session/local storage helpers preserve existing keys and encodings for positions, widths, windows and workspace flags; denied storage leaves the viewer usable. `registry/utils/persisted.ts`.

## How to get to it (user POV)

- Resize the existing ambient or workspace example between 700px, 767px and 768px.
- Move a floating window or resize a panel, then reload in the same browser tab.

## Driving it with the example journeys

Preconditions: `npm run build`, Chromium; fictional data only.

- **Phone.** `viewer-phone-layout`: run `npm run ambient:journey:scripted` and `npm run test:viewer-chrome`; compare phone and desktop screenshots. `node test/ui/ambient-position.test.mjs` pins 700px and 767 / 767.5 / 768px boundaries without remounting the composer.
- **Keyboard.** `viewer-keyboard-inset`: `node test/ui/registry-utils.test.mjs` drives viewport resize/scroll, pinch zoom and observer cleanup; physical keyboard behavior still needs a real device.
- **Persistence.** `viewer-layout-persistence`: `npm run windows:journey` and `npm run dock-app:journey` move/resize and reload. `node test/ui/registry-utils.test.mjs` and `node test/ui/ambient-position.test.mjs` drive malformed/denied browser storage.

## Gotchas

- Explicit host `sheetBelow` overrides and container-fit constraints remain supported; they are not additional device classes.
- Reinstall affected blocks and `utils` together. Old Ambient/app-shell hook paths and `utils/utils`'s `PHONE_BELOW` remain compatibility exports for one release.
- Pointer-specific hit targets remain enabled on coarse pointers at any width. No new kit entry or Pi extension applies to browser layout and storage.
