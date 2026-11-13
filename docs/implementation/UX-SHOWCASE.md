# UX showcase

A static documentation site of the kit, in English: a left navigation (a menu on a phone), a theme switch, and one page per layout or component. The home page and every page open on the live, playable demo (an invented, scripted assistant), then "Things to try" (buttons that reload the demo and play a flow in it), a width toggle and start states, the install and usage lines (copyable), and last the collapsed status line, each flow's steps ("All steps") and its recording ("Show recording", loaded on request, never autoplayed). Built by `ux/runner/site.mjs` from a captured run. No model is called anywhere; the site shows facts only.

The pages are written for a visitor: no harness explanation on them, one footer link to `ux/README.md`. What a page lists under "Things to try" is `try` in the scenario (`[{ "label": "...", "flow": "F01" }]`, or `"steps"` for an ad hoc list); without it the first playable flows are used. A flow is playable when it uses only tap, type, press, focus, scroll, wait and fixture steps. `summary` is the one line under the page title.

The workflow is `.github/workflows/ux-showcase.yml`.

## Enable it once

1. Settings > Pages > Source: **GitHub Actions** (nothing else to configure; no secret is used).
2. Run it by hand once (below) and read the URL in the deploy step. For a project site it is `https://<owner>.github.io/<repo>/`, or the custom domain if one is set in Settings > Pages.

Until step 1 is done the deploy step fails and nothing is published.

## When it runs

- On every **published release** (`release: published`), and
- by hand: Actions > UX showcase > Run workflow, or `gh workflow run ux-showcase.yml` (add `-f enforce=true` to turn the gate on for that run).

It never runs on push or pull request. A newer run cancels an older one (concurrency group `ux-showcase`).

## What it does

`npm ci`, Chromium (same cached install as `verify.yml`), `npm i --no-save playwright-core@1.63.0`, `npm run build`, then:

1. `node ux/runner/cli.mjs check`: every flow step completes and the scenario's thresholds are met. Its output is written to the run summary. **By default a failing check does not stop the run**: the site is published anyway and each target's page says, in plain words, how many flow steps complete without a hitch and what does not pass yet. A failing check is visible (the step is marked failed-but-continued, and the summary lists it) and hides nothing.
2. `node ux/runner/cli.mjs capture --video --out .cache/ux`: pictures, videos and measurements for every scenario in `ux/scenarios/`.
3. `node ux/runner/cli.mjs site --from .cache/ux --out .cache/site`: the static site.
4. Upload and deploy `.cache/site` with the standard Pages actions.

## The gate: from showing to enforcing

The kit does not pass every check yet, so enforcement is off. When the kit is ready, switch it on in one place:

- repository variable `UX_ENFORCE` = `true` (Settings > Secrets and variables > Actions > Variables), for every run; or
- `gh workflow run ux-showcase.yml -f enforce=true`, for one run.

With enforcement on, a failing check fails the run before capture and nothing is published. The same gate is a command: `npm run ux:check` (exit code 1 when a check fails), which any other workflow or a release step can call.

## Run it on your machine

```sh
export CHROMIUM=/path/to/chromium; npm i --no-save playwright-core
npm run ux:capture -- --out .cache/ux
npm run ux:site -- --from .cache/ux --out .cache/site
```

Serve `.cache/site` (for example `python3 -m http.server -d .cache/site`) and open it: a page drives its demo through the frame, which a `file://` page cannot do.

## What it publishes

The kit version, commit and capture date; the scenario's title, purpose, install line and usage snippet (only when the scenario has them); the demo page of each target; flow sentences, videos and measurements, with no still pictures in the page by default; for each target one neutral status line from `check` (« N of M flow steps complete without a hitch », then the list of what does not pass yet, in plain words). The recordings and the step lists are collapsed; nothing is loaded for them until a visitor opens them.

## What it never publishes

The judge's grades, verdicts and the loop's scoreboards (`ux:judge` output stays internal), raw `result.json`, console logs, and anything outside the captured folder. Scenario and fixture data must be invented: `test/ux-invented-data.test.mjs` fails on a real-looking e-mail address, a key or token, or a denied name, in the fixtures, the scenarios and a generated site.

## Cost

About 5 to 10 minutes of one `ubuntu-latest` runner per run (Chromium install is cached; capture is about a minute per target), no model calls, no secrets. The artifact is a few MB per target (videos dominate).
