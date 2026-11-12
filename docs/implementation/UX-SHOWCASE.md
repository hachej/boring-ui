# UX showcase

A static site of the kit: one page per layout or component with a live demo (an invented, scripted assistant), still pictures of its states, each flow with its sentences, pictures and video, and the numbers a real browser measured, in plain words. Built by `ux/runner/site.mjs` from a captured run. No model is called anywhere; the site shows facts only.

The workflow is `.github/workflows/ux-showcase.yml`. It is inert until the owner says go.

## Enable it once

1. Settings > Pages > Source: **GitHub Actions** (nothing else to configure; no secret is used).
2. Run it by hand once (below) and read the URL in the deploy step. For a project site it is `https://<owner>.github.io/<repo>/`, or the custom domain if one is set in Settings > Pages.

Until step 1 is done the deploy step fails and nothing is published; the earlier steps still show whether the kit passes.

## When it runs

- On every **published release** (`release: published`), and
- by hand: Actions > UX showcase > Run workflow, or `gh workflow run ux-showcase.yml`.

It never runs on push or pull request. A newer run cancels an older one (concurrency group `ux-showcase`).

## What it does

`npm ci`, Chromium (same cached install as `verify.yml`), `npm i --no-save playwright-core@1.63.0`, `npm run build`, then:

1. `node ux/runner/cli.mjs check`: the regression gate (every flow step completes, thresholds met). **If it fails the job stops and nothing is published.**
2. `node ux/runner/cli.mjs capture --out .cache/ux`: pictures, videos and measurements for every scenario in `ux/scenarios/`.
3. `node ux/runner/cli.mjs site --from .cache/ux --out .cache/site`: the static site.
4. Upload and deploy `.cache/site` with the standard Pages actions.

## Run it on your machine

```sh
export CHROMIUM=/path/to/chromium; npm i --no-save playwright-core
npm run ux:capture -- --out .cache/ux
npm run ux:site -- --from .cache/ux --out .cache/site
```

Open `.cache/site/index.html` in a browser (the demos are self-contained files; no server).

## What it publishes

The kit version, commit and capture date; the scenario's title, purpose, install line and usage snippet (only when the scenario has them); the demo page of each target; state pictures; flow strips, sentences, videos and measurements; a status line from `check`.

## What it never publishes

The Opus judge's grades, verdicts and the loop's scoreboards (`ux:judge` output stays internal), raw `result.json`, console logs, and anything outside the captured folder. Scenario and fixture data must be invented: `test/ux-invented-data.test.mjs` fails on a real-looking e-mail address, a key or token, or a denied name, in the fixtures, the scenarios and a generated site.

## Cost

About 5 to 10 minutes of one `ubuntu-latest` runner per run (Chromium install is cached; capture is about a minute per target), no model calls, no secrets. The artifact is a few MB per target (videos dominate).
