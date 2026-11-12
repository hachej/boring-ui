# UX harness

Scenarios (data) + one runner: capture what a layout or a component looks like and how it behaves, gate regressions without a model, build a showcase, and let a model judge it against shared criteria. Fictional data only; the demo assistant is scripted (no model, no network, no key).

## A scenario

One JSON file per target in `ux/scenarios/` (kept in one folder: one place to list, validate and keep under 500 lines each). `target` is `layout:<name>` (a whole shell arrangement over a realistic page) or `component:<name>` (one registry component alone on a neutral surface). Same format and runner for both.

```json
{ "target": "layout:bar", "title": "…", "purpose": "one line",
  "fixture": { "entry": "test/fixtures/themes/one-composer.jsx", "query": "tabs=1", "queryBy": { "1440": "single=1" }, "ready": "<css>", "install": "npx shadcn … add …", "usage": "<JSX>" },
  "viewports": [ { "name": "390", "width": 390, "height": 844, "touch": true }, { "name": "1440", "width": 1440, "height": 900 } ],
  "watch": [ ["field", "[data-testid=composer]"] ],  "thresholds": { "cls": 0.08, "settledMs": 1200, "touchTarget": 44 },
  "notes": "target-specific notes for the judge", "criteria": { "phone": false },
  "states": [ { "id": "01", "name": "rest", "query": "dark=1", "steps": [ … ] } ],
  "flows":  [ { "id": "F01", "name": "…", "steps": [ { "do": "tap", "target": "agent-card-file", "say": "Tap the chip", "expect": "The preview opens beside the conversation", "until": "visible:fixture-preview", "motion": true, "focus": "composer-input" } ] } ] }
```

Gestures (`ux/runner/gestures.mjs`): `tap`/`click` (test id, `text`, or `choice`), `type`, `press`, `focus`, `hold`/`release`, `scroll`, `drag`, `swipe`, `drop` (a file), `attach` (the picker), `wait`, `back` (the browser's Back, a phone's back gesture), `reload` (the page reloads: what it keeps across), `fixture` (one named helper in `window.__ux`). Targets may differ by viewport (`{ "390": "…", "1440": "…" }`). `until`: `visible:` `gone:` `focus:` `value:` `text:` `count:` `eval:`, joined with ` & `. A step the kit cannot do carries `gap: "why"`: it shows as "not in the kit yet" and caps the flows criterion; do not invent a component.

## Add one in five minutes

1. Write a fixture `ux/fixtures/<name>.jsx` that mounts the registry component the way a consumer would on a neutral page (invented French content; read `?dark=1`; expose helpers on `window.__ux` only when a step needs one). A layout fixture may be an existing test fixture.
2. Write `ux/scenarios/<kind>-<name>.json` with 3 to 6 states and 2 to 4 flows.
3. `node ux/runner/cli.mjs list` (validates), then `capture`, look at the pictures, then `check`.

## Commands (`npm run ux:<command>` also exists)

Needs `CHROMIUM` (a Chromium binary) and `playwright-core` (`npm i --no-save playwright-core@1.63.0`; not a repo dependency, so the kit's lockfile does not change; set `UX_PLAYWRIGHT` to a folder that has it otherwise).

| Command | What it does |
| --- | --- |
| `list` | targets with their numbers of states and flows |
| `capture [--target t] [--level layout\|component] [--flow F01,F02] [--out dir]` | states, a labelled strip per flow and viewport (frames before, +80 ms, +200 ms, settled), a video and `metrics.json` per flow; default `.cache/ux` (git-ignored) |
| `check [--target t]` | no model, no pictures: fails on a step that does not complete, a console error, a failed request, or a threshold of the scenario crossed (layout shift, time to settle, touch target, focus, clipping) |
| `judge --target t --from dir [--prev dir]` | Claude Opus, headless and read-only, grades the folder on `CRITERIA.md`, writes `verdict.json` and `verdict.md` |
| `site --from dir --out dir` | static showcase (facts only, never a grade) |
| `ux/runner/loop.mjs --target t` | worker model + judge in rounds; state in `$UX_LOOP_HOME/<target>/`, one commit per accepted round (see "The loop" below) |

Pace: demos stream and wait at `pace=real` (people, videos); `check` runs `pace=instant`. The scripted assistant lives in `ux/scenarios/scripts/*.json`.

## What the judge grades, and 9

Six criteria in `CRITERIA.md`: clarity and hierarchy, layout and spacing, states and feedback, phone ergonomics, visual polish, flows and interactions. 9 means a senior product designer would ship it as is: for flows, every step completes first time, layout shift under 0.02, focus lands in the right place, close returns to the exact prior state, first response under about 100 ms, settled under about 300 ms.

## The loop (runbook)

The worker (Codex, `workspace-write` sandbox) cannot write the worktree's git directory and cannot start Chromium, so it only edits files; the loop does everything else (`loop.mjs`, git and round mechanics in `loop-round.mjs`, tested by `test/ux-loop-round.test.mjs` with a fake worker).

Per round:
1. Eyes. The loop copies the last accepted capture (pictures, flow strips, `metrics.json`), the judge's remarks, `check-lines.txt` and, when the last round was discarded, `last-failure.txt` into `round-N/eyes/` and points `worker-brief.md` at it.
2. The worker edits files. No change means the round is logged "no change" (not a failure).
3. Refusal. A change under `ux/runner/`, `ux/scenarios/`, `test/contracts/`, the acceptance contract, `ux/CRITERIA.md`, `ux/judge-prompt.md`, `ux/worker-brief.md` or `package*.json` discards the round, with no repair.
4. Checks, cheapest first: `npm run registry:build` (when `registry.json` or `registry/` changed, so the committed build is never stale), `npm run check`, the contract tests (`UX_TEST_CMD`), then, after waiting for the 1-minute load to fall under `UX_LOAD_MAX` (default 25, at most 15 minutes), the harness `check` and the full capture with the flow guard. A crashed capture is retried once. The harness check may not have more failing lines than the last accepted round.
5. One repair: a failure gives the worker the full failing output (failing test, assertion, file and line; also saved as `round-N/failure-1.txt` and in the log) and a second pass in the same round. Still failing: the files are checked out back to the round's start commit and the files the round added are removed (`discard`; never `git reset --hard` or `git stash`), and the round is recorded as failed with its reason.
6. Judge, only for a round that passed. A round whose lowest criterion is below the last accepted round's is discarded the same way and recorded. Otherwise the loop commits for the worker (author `<model> (UX loop round N)`, never empty) and the scoreboard gets the row: commit, criteria, failing check lines, result.

State is in `$UX_LOOP_HOME/<target>/`: `loop.log`, `scoreboard.md`, `round-N/`, `check-lines.json`. `touch STOP` there pauses it between rounds. Limits: `UX_MAX_ROUNDS` (10), `UX_MAX_IDLE` (3 rounds in a row that improved nothing), `UX_WORKER_MODEL`.

## What it does not do

It does not test business logic or accessibility audits (axe), real devices, real keyboards on a phone (the keyboard is emulated), real networks or a real model. It does not replace the contract tests. It never pushes, merges or releases; the loop commits to a local branch only.

## Scenario contract (exact; other tools, such as a video recorder, read this)

Top level: `target` (string, `layout:<name>` | `component:<name>`, required), `title` and `purpose` (strings, required), `fixture` (required), `viewports` (required, list), `watch` (list of `[name, cssSelector]`), `thresholds` (object), `notes` (string), `criteria` (object of booleans to switch a criterion off), `states` (list), `flows` (list).

- `fixture`: `entry` (repo path of a .jsx that mounts the target, required), `query` (URL query added for every viewport), `queryBy` (`{ "<viewport name>": "<query>" }`), `ready` (CSS selector present once mounted), `css` (extra registry css item names), `install`, `usage` (strings, optional). The page is opened as `<built page>?demo=1&<query>&<queryBy[viewport]>&<state or flow query>&pace=<real|instant>`; fixtures read `dark=1` and `pace` and expose helpers on `window.__ux`.
- `viewports[]`: `{ name, width, height, touch? }` (`name` is the string used in file names and in `{ "390": … }` maps).
- `states[]`: `{ id, name, query?, only?, steps? }`. A state runs its steps then screenshots `states/<viewport>-<id>-<name>.png`. `only`: a viewport name.
- `flows[]`: `{ id, name, query?, only?, steps[] }`.
- `steps[]`: `do` (gesture, required), its arguments (below), and optional `say` (the gesture as a short sentence, a caption), `expect` (one plain sentence a person would say), `until` (condition joined with ` & `: `visible:` `gone:` `focus:` `value:<t>~text` `text:<t>~text` `count:<t>>=N` `eval:<js>`; `a|b` = either), `timeout` (ms to wait for `until`, default 1500), `settleMax` (ms to wait for the page to go quiet, default 1200; use ~150 while a timer ticks), `motion` (take frames at 80 and 200 ms), `focus` (the target focus should be on afterwards), `when` (a condition: skip the step when false), `only` / `skip` (a viewport name), `gap` (text: the kit cannot do this).
- A target is a test id (`composer-input` means `[data-testid=composer-input]`), `testid[attr=value]`, or any CSS selector; where it differs by viewport give `{ "390": "…", "1440": "…" }`.

Gestures, one example each:
`{ "do": "tap", "target": "agent-card-file" }` · `{ "do": "tap", "text": "Carte Garage du Port" }` · `{ "do": "tap", "choice": "2026" }` · `{ "do": "click", … }` (same as tap) · `{ "do": "type", "target": "composer-input", "text": "Bonjour" }` · `{ "do": "press", "key": "Escape Escape" }` (keys separated by a space) · `{ "do": "focus", "target": "composer-input" }` · `{ "do": "hold", "target": "agent-talk" }` then `{ "do": "release" }` · `{ "do": "scroll", "target": "transcript-scroll", "to": 0 }` · `{ "do": "drag", "from": "a", "to": "b" }` · `{ "do": "swipe", "target": "card", "dir": "left" }` · `{ "do": "drop", "target": "composer", "file": "releve-fevrier.pdf", "phase": "enter" }` (`phase: "enter"` = drag over, absent = drop) · `{ "do": "attach", "target": "composer-bar-attach", "file": "facture-delorme-0112.pdf" }` · `{ "do": "wait", "ms": 400 }` · `{ "do": "back" }` · `{ "do": "reload" }` · `{ "do": "fixture", "name": "failNext", "arg": null }` (calls `window.__ux.<name>(arg)`).

Video: `ux/runner/video.mjs` exports `recordFlow({ scenario, flowId, viewport, outDir, browser })` returning `{ files, ok }`; it is the only place that records, so another recorder can replace it. `capture --video` calls it for every flow.
