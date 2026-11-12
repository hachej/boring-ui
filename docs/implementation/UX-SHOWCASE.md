# UX showcase

A static site of the kit: one page per layout or component with a live demo (an invented, scripted assistant), still pictures of its states, each flow with its sentences, pictures and video, and the numbers a real browser measured, in plain words. Built by `ux/runner/site.mjs` from a captured run. No model is called anywhere; the site shows facts only.

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

Open `.cache/site/index.html` in a browser (the demos are self-contained files; no server).

## What it publishes

The kit version, commit and capture date; the scenario's title, purpose, install line and usage snippet (only when the scenario has them); the demo page of each target; state pictures; flow strips, sentences, videos and measurements; for each target one neutral status line from `check` (« N of M flow steps complete without a hitch », then the list of what does not pass yet, in plain words). On a phone each flow is a vertical list of steps, each with its own full-width picture.

## What it never publishes

The judge's grades, verdicts and the loop's scoreboards (`ux:judge` output stays internal), raw `result.json`, console logs, and anything outside the captured folder. Scenario and fixture data must be invented: `test/ux-invented-data.test.mjs` fails on a real-looking e-mail address, a key or token, or a denied name, in the fixtures, the scenarios and a generated site.

## Cost

About 5 to 10 minutes of one `ubuntu-latest` runner per run (Chromium install is cached; capture is about a minute per target), no model calls, no secrets. The artifact is a few MB per target (videos dominate).
