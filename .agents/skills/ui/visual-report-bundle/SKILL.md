---
name: visual-report-bundle
description: Runs authenticated browser UI testing and produces a review bundle with asserted screenshots, a paced WebM with a visible cursor, browser/network logs, machine results, and an HTML report. Use when asked to visually test a live app, record proof, create screenshot/video reports, or compare agent-generated UI reviews.
compatibility: Requires Node.js, Chromium installed for Playwright, ffprobe, and an existing Playwright or playwright-core installation.
---

# Visual Report Bundle

This is an auxiliary proof-packaging skill under the repository-owned `ui` skill. Read `docs/kanzen/MODEL-CARD.md` and `docs/kanzen/procedures/visual-review.md` before selecting an operator or running a project scenario. It does not replace the registered-spec review loop, create improvement packets, or grant edit/merge authority. When invoked from `/ui`, the parent registered spec remains the source of targets, routes, fixtures, gates, and owner checks. Direct scenario execution requires an explicit bounded request such as a local dev-login smoke run.

Use the Model Card's L0 visual-evidence operator: prefer Qwen 3.6 through the local `mac` provider when available. The operator runs deterministic browser steps and packages evidence only. It never grades its own bundle, plans fixes, edits product code, or approves a review round. Pass its requested identity as `--declared-operator-model`; this is a label, not runtime attestation. Record separately the runtime-resolved provider/model from the orchestrator transport in `operator-invocation.json`. Fail the round if requested and resolved models differ.

Create evidence, not a prose-only report. Never label a screenshot as a state unless a DOM assertion proves that state is visible.

## Inputs

Collect or infer:

- app URL;
- authentication bootstrap URL, such as `/dev-login`;
- GitHub issue number (required for normal project runs);
- run name, such as `authenticated-smoke-2026-07-24`;
- viewport;
- scenario file describing safe interactions.

Never put passwords, cookies, authorization headers, or tokens into scripts, logs, reports, or screenshots. A dev-login URL may establish a normal cookie inside the isolated browser context.

## Run

Resolve this skill directory and run:

```bash
node scripts/capture-visual-report.cjs \
  --scenario references/scenario.example.json \
  --issue 913 \
  --run round-01-baseline \
  --declared-operator-model mac/qwen3.6-35b-a3b
```

For an issue run, the runner creates the bundle in this dedicated subfolder:

```text
docs/issues/<issue>/artifacts/visual-report/<run>/
```

Use `--output /tmp/visual-report-run` only for an explicitly disposable experiment that is not issue work. The scenario JSON controls authentication and interactions. Copy it to `/tmp` and adapt selectors for the live DOM instead of changing the bundled example.

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

## Iterative review role

This skill owns only the capture/package steps in the bounded review loop:

```text
registered scenario
  → L0 operator captures round-N bundle
  → independent vision-capable L1 critic grades enumerated evidence
  → orchestrator selects a bounded fix plan / execution packet
  → /exec implements approved fixes
  → L0 operator captures round-(N+1) comparison bundle
  → independent critic regrades
```

Store each round as a sibling beneath the issue artifact subfolder, for example
`round-01-baseline`, `round-02-after-fixes`, and `round-03-final`. Never overwrite
a prior round. The strong critic and existing UI-review hard gates remain the
review authority. Follow the parent workflow's round limit and stop conditions.
For explicit scenarios, follow [the loop artifact schema](references/loop-artifact-schema.md). Requested and runtime-resolved critic models must match; fail closed on mismatch rather than trusting model-authored self-identification.

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
Issue artifact folder: docs/issues/<issue>/artifacts/visual-report/<run>/
Requested operator model: <provider/model>
Resolved operator model: <provider/model-from-runtime>
Operator invocation record: <output-directory>/operator-invocation.json
Visual report bundle: <output-directory>
HTML report artifact: <output-directory>/index.html
Served report URL: <exact-url-or-not-served>
Video: <output-directory>/videos/run.webm
Results: <pass> PASS · <fail> FAIL · <blocked> BLOCKED
Residual risks: <none-or-list>
```

The HTML report is a required first-class handoff artifact, not an optional implementation detail. For issue work, all generated evidence must remain together inside the issue's `artifacts/visual-report/<run>/` subfolder; never scatter screenshots, video, logs, or reports elsewhere in the issue folder. When `workspace.open.path` or an equivalent artifact opener is available, open `<output-directory>/index.html` for owner review. Otherwise serve it locally and return the exact URL.

## Serving

Serve the completed bundle locally:

```bash
python3 -m http.server 8766 --directory /tmp/visual-report-run
```

If the port is busy, choose another free port and report the exact URL.
