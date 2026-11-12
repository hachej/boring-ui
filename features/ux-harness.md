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
- `ux-scripted-agent`: open a fixture page with `?demo=1` and type « Rapproche le relevé de janvier »; any other text gets the script's plain fallback sentence.

## Gotchas

- Only `judge` and `loop` call a model. Capture, check and site never do, and the site never carries a grade.
- A flow step the kit cannot do carries `gap` and shows as « not in the kit yet »; do not invent a component to pass it.
- `check` thresholds live in the scenario, not in the runner; do not weaken a scenario to make a round pass (the loop protects `ux/scenarios/`).
- Fixtures must carry invented data only: `test/ux-invented-data.test.mjs` fails on a real e-mail domain, a key-like string or a denied name.
