# UX harness

Scenarios as data (`ux/scenarios/*.json`), one per layout or component, that a runner plays in a real browser over the kit's own fixtures: it screenshots the states, films and measures each flow, gates regressions with no model, builds a showcase site, and lets a model judge the result against shared criteria. Fictional data only; the demo assistant is scripted, never a model.

## Sub-features

- `ux-scenario` a scenario is one JSON file: `target` (`layout:<name>` or `component:<name>`), `title`, `purpose`, `fixture` (the page that renders it, its query, install line and usage), `viewports`, `states` (named static shots) and `flows` (steps with a gesture from a fixed vocabulary, an `until` condition and the plain sentence a person would say). `ux/scenarios/`, validated by `ux/runner/scenario.mjs`.
- `ux-capture` `node ux/runner/cli.mjs capture --target <t> --out <folder>` writes states, one labelled strip per flow and viewport (frames before, at 80 ms, at 200 ms and settled), a video and `metrics.json` per flow (time to first change and to settle, layout shift, what moved, focus, scroll, touch targets, clipped or overlapping controls, console errors). `ux/runner/capture.mjs`, `ux/runner/measure.mjs`.
- `ux-check` `node ux/runner/cli.mjs check` replays every flow without pictures or a model and fails when a step does not complete, a console error appears or a threshold the scenario declares is crossed. The regression gate. `ux/runner/check.mjs`.
- `ux-judge` `node ux/runner/cli.mjs judge --target <t> --from <folder>` has Claude Opus (headless, read-only) grade a captured folder on six criteria (`ux/CRITERIA.md`) and write `verdict.json` and `verdict.md`. `ux/runner/judge.mjs`.
- `ux-loop` `node ux/runner/loop.mjs --target <t>` runs a worker model and the judge in rounds, one commit per round, state outside the repo. `ux/runner/loop.mjs`.
- `ux-showcase` `node ux/runner/cli.mjs site` builds a static, English documentation site from a capture: left navigation, the playable demo first on every page (and on the home page) with "things to try" that play a flow in it, usage, then the collapsed status, steps and recordings. `ux/runner/site.mjs`, run by `.github/workflows/ux-showcase.yml` (on a release or by hand; publishes whenever capture succeeds, shows the check status in neutral words, and blocks only when `UX_ENFORCE` is on; see the runbook).
- `ux-scripted-agent` the demos' assistant is data (`ux/scenarios/scripts/*.json`): turns with tool steps, streamed text, questions; `pace=real` for people and videos, `pace=instant` for `check`. `ux/fixtures/scripted-agent.mjs`.
- `ux-demo-entry-controls` the bookkeeping demo uses kit Buttons for entry labels and quoting, so the kit owns their touch sizing. `test/fixtures/themes/one-composer.jsx`, `test/fixtures/themes/one-composer-demo.jsx`.
- `ux-demo-entry-status` the bookkeeping page shows a translated status word below each amount on phones, using kit Badge variants for reconciled, gap and receipt states. Desktop keeps its separate status column. `test/fixtures/themes/one-composer.jsx`.
- `ux-demo-pane-family` the demo's entry pane and library are one family: the entry is built from kit parts (Button, Checkbox, Label, Item rows, Table) and the library is the compact `variant="plain"` tree under the pane's own header, so there is one title and one row height (36 px, 44 px on touch). `test/fixtures/themes/one-composer-demo.jsx`.
- `ux-showcase-design-check` the showcase fixtures (`test/fixtures/themes/one-composer*.jsx`, `ux/fixtures/*.jsx`) are held to `boring-ui-blocks design`: no raw form control or table, no arbitrary size, no hand-written touch size. Run `node scripts/check-showcase-design.mjs` (part of `npm run check`). `scripts/check-showcase-design.mjs`, `test/showcase-design.test.mjs`.
- `ux-design-system-home` the showcase is ONE top bar over the app: a page menu (Start: the design system; Layouts; Components), one Phone and Desktop switch (remembered for the whole site) and the theme switch, then the page's demo in a frame filling the rest (Phone is a centred 390 px frame, Desktop the full width). No site navigation, no title block. The home is the design system: the kit's AppShell at its defaults with the colours, type scale, radius, shadow, buttons, form controls, status, rows, table, card, tabs, dialog and empty state as its app view, and an empty app view as its second screen. A scenario with `"site": false` is checked in CI but not published as a page (the update notice is a part of the design system page instead); a target without a demo keeps the documentation page. `ux/fixtures/design-system.jsx`, `ux/scenarios/component-design-system.json`, `ux/runner/site.mjs`, `ux/runner/site-chrome.mjs`.
- `ux-demo-samples` the demo's Library and the design system page's file tree hold a `samples` folder, one invented file per kind the pane draws: SVG, diagram, Excalidraw, draw.io, mock-up, maquette, records, and TS, Python and shell as text, beside the PDF, CSV, Markdown, image, JSON, text and video. Made in memory from the repo's invented fixtures. `test/fixtures/themes/one-composer-files.js`, `one-composer-demo.jsx`.
- `ux-play-menu` the top bar's Play menu lists the current page's "things to try" (a scenario's `try`, up to 12) and plays one into the demo (reloads it and plays the steps), plus « Reset the conversation ». The design system's assistant is the harness's scripted one (`ux/fixtures/demo-controller.mjs` over `scripted-agent.mjs`, script `ux/scenarios/scripts/design-system.json`): plain and Markdown answers, a question card with choices and one with free text, tool steps running, done and failed, an error, files cited as chips and opened in the pane, a typing state. The bar has the attach and dictation buttons (`ux/fixtures/fake-mic.mjs`, no real microphone). `ux/runner/site-chrome.mjs`, `site-client.js`.

## How to get to it (user POV)

- A visitor opens the showcase site (GitHub Pages) and tries each layout or component live; a designer reads the site. An agent adds a scenario for a new component and runs `check`. The owner starts the loop on a target and reads `scoreboard.md`.

## Driving it with the UX runner

Preconditions: `npm ci && npm run build`, `CHROMIUM` set to a Chromium binary, `npm i --no-save playwright-core@1.63.0`.

- `ux-scenario`: `node ux/runner/cli.mjs list` lists the targets with their numbers of states and flows; a malformed scenario fails there.
- `ux-capture`: `node ux/runner/cli.mjs capture --target layout:bar --out .cache/ux` and open `.cache/ux/layout-bar/contact-1440.png` and `flows/F01/strip-1440.png`.
- `ux-check`: `node ux/runner/cli.mjs check`; exit code 1 and a list of failures when a flow broke.
- `ux-judge`: `node ux/runner/cli.mjs judge --target layout:bar --from .cache/ux/layout-bar` (calls a model; needs the `claude` CLI).
- `ux-loop`: `node ux/runner/loop.mjs --target layout:bar --dry-run` runs the guards and one capture with no model call.
- `ux-showcase`: `node ux/runner/cli.mjs site --from .cache/ux --out .cache/site`, then open `.cache/site/index.html`.
- `ux-scripted-agent`: open a fixture page with `?demo=1` and type “Reconcile the January statement”; any other text gets the script's plain fallback sentence.
- `ux-demo-entry-controls`: at 390 px in `layout:bar`, tap the Jan 09 or Jan 15 entry label, then “Quote in the assistant”. Both controls use the kit's 44 px touch floor. Entry labels also open with Enter or Space. F03 and F04 drive these controls.
- `ux-demo-entry-status`: inspect `layout:bar` at 390 px in light and dark. Scroll through the page and check that each amount has “Reconciled”, “Gap” or “Needs a receipt” beneath it. Open and close Jan 09 and Jan 15 in F03 and F04, then scroll to the last entry and confirm it remains above the composer. At 1440 px, status stays in its own column.
- `ux-demo-pane-family`: in `layout:bar-pane` open an entry, then the library from its header. Both show one title, and rows are one height (36 px desktop, 44 px phone).
- `ux-showcase-design-check`: add a raw `<button>` to `ux/fixtures/component-reply-card.jsx` and run `node scripts/check-showcase-design.mjs`; it exits 1 and names the line.
- `ux-design-system-home`: build the site (`ux:site`), open its home at 390 and 1440, light and dark: one bar (page menu, Phone/Desktop, theme) over the framed app; pick a layout in the menu, switch to Phone and reload another page: the choice is kept. `node --test test/ux-site-home.test.mjs` checks the bar and the menu.
- `ux-demo-samples`: open the Library (or the design system page's file tree), folder `samples`: one file per viewer opens in the right viewer in the pane.
- `ux-play-menu`: on the design system page open the Play menu in the top bar and pick « Question card: choices »: the scripted assistant asks two questions in the conversation; « Reset the conversation » starts again (`node --test test/ux-site-play.test.mjs`).

## Gotchas

- Only `judge` and `loop` call a model. Capture, check and site never do, and the site never carries a grade.
- A flow step the kit cannot do carries `gap` and shows as “not in the kit yet”; do not invent a component to pass it.
- `check` thresholds live in the scenario, not in the runner; do not weaken a scenario to make a round pass (the loop protects `ux/scenarios/`).
- Fixtures must carry invented data only: `test/ux-invented-data.test.mjs` fails on a real e-mail domain, a key-like string or a denied name.
