---
name: visual-report-bundle
description: Runs authenticated browser UI testing and produces a review bundle with asserted screenshots, a paced WebM with a visible cursor, browser/network logs, machine results, and an HTML report. Use when asked to visually test a live app, record proof, create screenshot/video reports, or compare agent-generated UI reviews.
compatibility: Requires Node.js, Chromium installed for Playwright, ffprobe, and an existing Playwright or playwright-core installation.
---

# Visual Report Bundle

This is an auxiliary proof-packaging skill under the repository-owned `ui` skill. It does not replace the registered-spec review loop in `docs/kanzen/procedures/visual-review.md`, create improvement packets, or grant edit/merge authority. When invoked from `/ui`, the parent registered spec remains the source of targets, routes, fixtures, gates, and owner checks. Direct scenario execution requires an explicit bounded request such as a local dev-login smoke run.

Create evidence, not a prose-only report. Never label a screenshot as a state unless a DOM assertion proves that state is visible.

## Inputs

Collect or infer:

- app URL;
- authentication bootstrap URL, such as `/dev-login`;
- output directory (prefer `/tmp/<name>-<date>` unless the user requests tracked output);
- viewport;
- scenario file describing safe interactions.

Never put passwords, cookies, authorization headers, or tokens into scripts, logs, reports, or screenshots. A dev-login URL may establish a normal cookie inside the isolated browser context.

## Run

Resolve this skill directory and run:

```bash
node scripts/capture-visual-report.cjs \
  --scenario references/scenario.example.json \
  --output /tmp/visual-report-run
```

The scenario JSON controls authentication and interactions. Copy it to `/tmp` and adapt selectors for the live DOM instead of changing the bundled example.

## Required evidence

The runner produces:

```text
<output>/
├── screenshots/
├── videos/run.webm
├── console-errors.json
├── http-errors.json
├── interaction-results.json
├── video-probe.json
├── report.md
└── index.html
```

## Rules

1. Bootstrap authentication first and assert authenticated UI explicitly.
2. Use accessible roles/names or stable `data-*` attributes; avoid generated CSS classes.
3. Assert the expected DOM state after every click.
4. Mark selector misses as `BLOCKED`, interaction failures as `FAIL`, and proven states as `PASS`.
5. Add a visible cursor overlay to the page before recording interactions.
6. Move the cursor to each target before clicking.
7. Use reviewable pacing: about 500–800 ms cursor travel, 900–1500 ms after clicks, and 1500–2200 ms on important states.
8. Capture screenshots only after assertions pass. A failure screenshot may be captured with `failureScreenshot: true` and must be labelled as failure evidence.
9. Record HTTP status ≥400 with method and URL only. Never record headers.
10. Verify WebM with `ffprobe` and include duration, codec, dimensions, frame rate, and size.
11. Verify screenshots are not accidental duplicates by comparing SHA-256 hashes. Duplicate hashes are allowed only when explicitly explained; otherwise the run is invalid.
12. Do not mutate product data unless the scenario and user explicitly permit it.
13. Do not edit repository files for a report run; write evidence under the requested output directory.

## Review checklist

Before reporting completion:

- authenticated state is proven or honestly marked blocked;
- each PASS has a DOM assertion and screenshot;
- video shows the visible cursor and is not too fast;
- WebM passes ffprobe;
- screenshot hashes are listed;
- stale or rejected artifacts are excluded from `index.html`;
- the report separates product defects from environment/test blockers;
- exact output directory and served URL are returned.

## Handoff output

Always end with a concise handoff containing:

```text
Visual report bundle: <output-directory>
HTML report artifact: <output-directory>/index.html
Served report URL: <exact-url-or-not-served>
Video: <output-directory>/videos/run.webm
Results: <pass> PASS · <fail> FAIL · <blocked> BLOCKED
Residual risks: <none-or-list>
```

The HTML report is a required first-class handoff artifact, not an optional implementation detail. When `workspace.open.path` or an equivalent artifact opener is available, open `<output-directory>/index.html` for owner review. Otherwise serve it locally and return the exact URL.

## Serving

Serve the completed bundle locally:

```bash
python3 -m http.server 8766 --directory /tmp/visual-report-run
```

If the port is busy, choose another free port and report the exact URL.
