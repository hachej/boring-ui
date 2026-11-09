# Kit gallery

`demos/gallery` is one page to open and click through: the kit in its default style inside the real `AppShell`, over fictional data, with no network. It builds to a single self-contained file.

## Sub-features

- `gallery-build` `npm run gallery:build` writes `.cache/gallery/index.html`: the JS and CSS inline, the mono font embedded, no external URL. It reuses the fixture build (esbuild, then Tailwind over the `theme` item). `scripts/gallery-build.mjs`.
- `gallery-shell` the page is an `AppShell` with `layout="screen"`, `rail="hover"` and `composer="content"`; the nav is Bases, Blocs d'app, Chat, Visionneuses, Coquille. `demos/gallery/gallery.jsx`.
- `gallery-bases` buttons (every variant and size, loading, disabled), badge, input, textarea, select, checkbox, switch, tooltip, dialog, sheet, popover, tabs, toast, skeleton. `demos/gallery/sections/bases.jsx`.
- `gallery-blocs` page-header, kpi-stat, list-row, empty-state, data-table, space-card, wiring-chips, file-pick, inline-question, status-narrative. `demos/gallery/sections/blocs.jsx`.
- `gallery-chat` `pi-chat` over a scripted fictional controller: a Markdown reply, a question card, an approval card, `/` and `@` pickers, an attachment and a fake voice recorder. The agent-bar slot is reserved until D-1978 lands. `demos/gallery/sections/chat.jsx`, `demos/gallery/chat-controller.js`.
- `gallery-viewers` placeholder card; the viewers land in a later slice. `demos/gallery/sections/visionneuses.jsx`.
- `gallery-header-switches` the header holds a light/dark switch, a compact-density switch and the Téléphone entry. `demos/gallery/gallery.jsx`.
- `gallery-phone-frame` the Coquille section shows this same page in a 390px iframe, so the shell is in its phone layout; it follows the theme and density. `demos/gallery/sections/coquille.jsx`.

- `gallery-docs` the page is the kit's documentation: each card shows its import or registry name and the props that matter in a copyable line (Copier), names its feature id and repo path as plain text (the page is offline), and has its own anchor. `demos/gallery/common.jsx`.
- `gallery-anchors` `#bases`, `#blocs`, `#chat`, `#visionneuses`, `#coquille` open a section; `#agent-bar`, `#data-table`, `#pi-chat`... open the section that holds that card and scroll to it, so a master can send a deep link. `demos/gallery/gallery.jsx`.
- `gallery-pages` the same file is published with GitHub Pages at https://hachej.github.io/boring-ui/ on each push to main (Pages build type: GitHub Actions). `.github/workflows/gallery-pages.yml`.

## How to get to it (user POV)

- Online: https://hachej.github.io/boring-ui/ (documentation and demo). A card link looks like `https://hachej.github.io/boring-ui/#data-table`.
- Run `npm run gallery:build`, then open `.cache/gallery/index.html`; or download the `kit-gallery` artifact from a CI run.
- `?theme=dark` starts dark; `#chat` (or any section id) starts on that section.

## Driving it

Preconditions: `npm run build`, Chromium (`CHROMIUM`).

- **Sections.** `gallery-bases`, `gallery-blocs`, `gallery-chat`, `gallery-viewers`, `gallery-shell`: `node --test test/contracts/gallery.test.mjs` opens the built file, clicks each nav entry and finds its landmark in light and dark with no console error and no network request.
- **Switches and phone.** `gallery-header-switches`, `gallery-phone-frame`: the same test clicks the header's theme and density actions, opens Coquille and reads the 390px frame.
- **Fake data.** `gallery-chat`: the test answers the question card and approves, and the scripted reply appears.
- **Docs and links.** `gallery-docs`, `gallery-anchors`: open `.cache/gallery/index.html#data-table`; the Tableau card is in view and shows its usage line and feature id. The test opens `#blocs` and a card anchor and reads the usage line.
- **Pages.** `gallery-pages`: run the "Gallery pages" workflow (workflow_dispatch) after enabling Pages; the deploy job prints the URL.
- **Build.** `gallery-build`: the test builds into a temporary folder; the CI step builds `.cache/gallery` and uploads it as `kit-gallery`.

## Gotchas

- The toast is a kit Alert in a status stack: sonner is not a dependency of this repo.
- The font is the system stack; Inter becomes the default with D-1974.
