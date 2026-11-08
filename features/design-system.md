# Design-system page

The kit builds one static page, `design-system.html` (the folder `packages/ui/design-system/`), from its real components, its real tokens and the design check's own rule data. Nothing on it is written by hand: when a token, a variant or a component changes, the next build changes the page. This is its first slice (the colours, type, shape, density and component sections); blocks, patterns and the rules section come next. Factory shows it as a tab.

## Sub-features

- `design-system-page` the built page: `index.html`, `app.js`, `app.css`, `data.js` (no fetch, so it works on `file://` and over https) and `themes/default.css`, written by `scripts/build-design-system.mjs` (run by `npm run build`; the folder is gitignored and listed in the kit's `files`). Sources are in `lab/design-system/`. Sections: header (kit version, light/dark, 390/1280 width, theme picker), colour roles (every `CORE_ROLES` entry in light and dark, the derived tokens it feeds from `theme.derived.css`, and the WCAG ratio of each text-on-surface pair, measured in the browser from the painted colours; under 4.5 is marked), type, shape and depth, density, and the shadcn/ui components rendered with the real code in every variant and size (read from their `cva` blocks). Exports with no demo are listed under "listed, not rendered", never hidden.
- `design-system-sandbox` the page keeps its state in memory and the URL hash (no localStorage or sessionStorage; every use is wrapped), fetches nothing, and swaps the theme by writing the `data.js` theme text into a `<style>`. The width toggle is an inner iframe of the same file with the state in its hash, and mode and theme reach it by `postMessage`, so the page works in `<iframe sandbox="allow-scripts">` (an opaque origin).
- `design-system-theme` `boring-ui-blocks design-system --out <dir> [--theme name=path ...]` copies the packaged page to `<dir>`, adds `themes/<name>.css` and a `data.js` entry per theme, and the picker lists it. It refuses a file that is not CSS custom properties on `:root` or `.dark` (an `@import`, markup, unbalanced braces) and the reserved name `default`. The command reads only the files it copies (node builtins, BORING-PI-5).

## How to get to it (user POV)

- Open `design-system/index.html` from the installed kit (`node_modules/@hachej/boring-ui-kit/design-system/index.html`), or from `packages/ui/design-system/` after `npm run build`. Use the header to switch light/dark, 390/1280 and the theme. The coarse-pointer sizes (44px targets) follow the device, so open the page on a touch device to see them.
- To show an app's themes: `npx boring-ui-blocks design-system --out site --theme brand=web/src/theme.core.css`, then open `site/index.html`.

## Driving it with Chromium

Preconditions: `npm ci`; `CHROMIUM` set to a Chromium or chrome-headless-shell binary (CI sets it and never skips). Fictional data only.

- **Page is built from the sources.** `design-system-page`: `node --test test/contracts/design-system-page.test.mjs` builds the page into a temp folder and checks that every `CORE_ROLES` entry and every export of `shadcn/ui/*.tsx` (read from the source files) is in its data, that the checker names a dropped role or export, and that no page code uses fetch, storage or parent access.
- **Sections, contrast and toggles.** `design-system-page`: `CHROMIUM=... EVIDENCE_DIR=.cache/evidence/design-system node --test test/contracts/design-system-page-browser.test.mjs` opens the built page over `file://` and `http`, checks the five sections, that each contrast figure is a number, that dark switching changes `--background`, and that a token changed in a copy of `theme.derived.css` changes the page with no page edit. It writes shots at 390 and 1280, light and dark.
- **Sandboxed frame.** `design-system-sandbox`: the same test loads the page in `<iframe sandbox="allow-scripts">` from a host page (storage throws there) and drives mode, width and theme, reading what the inner frame reports about its own document.
- **Adding a theme.** `design-system-theme`: the same test adds a theme with the bin command and drives the picker; `node --test test/contracts/design-system-page.test.mjs` also checks the refusals.

## Gotchas

- The Toast is drawn as a static frame with the kit's tokens: the toast renderer (sonner) is not part of the page bundle.
- Dialog and Sheet are static open frames in a bounded box (a transformed container with the overlay heights set in pixels), not live overlays.
- Light and dark are both drawn whatever the toggle says (`.ds-light` and `.dark` scopes re-declare the tokens); the toggle changes the page chrome and the live component demos.
- The contrast figure is measured from the painted colour, so it needs a canvas; a DOM without one shows `n/a`, never an invented number.
