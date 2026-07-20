---
github: https://github.com/hachej/boring-ui/issues/829
issue: 829
state: ready-for-agent
updated: 2026-07-19
flag: not-needed
---

# gh-829 Automated self-improving UI review loop

## Problem

UI work currently requires too much repeated manual exploration. Existing Playwright tests prove known behavior and DOM/CSS invariants, while the current Bombadil suite explores randomized chat interactions, but neither produces a concise, taste-aware owner review. Screenshots exist as scattered proof artifacts rather than a repeatable review input.

The result is expensive human work: reopen the playground, rediscover states, test desktop/mobile, notice regressions, explain fixes, and repeat.

## Solution

Evolve the explicit-only `/skill:ui` workflow into an automated review/improvement loop:

```text
known Playwright scenarios + Bombadil exploration
→ deterministic hard gates
→ diverse screenshot selection
→ Gemini Pro vision rubric and /10 score
→ bounded fixes through /exec
→ rerun
→ one before/after Inbox artifact and short owner playbook
```

Bombadil discovers state combinations; it does not judge aesthetics. Deterministic checks remain authoritative. AI taste scoring begins advisory and earns trust through calibration against owner decisions. No Fable is used for this workflow.

## Current seams and prior art

- `apps/workspace-playground/e2e/visual.spec.ts` turns manual visual bugs into stable DOM/computed-style assertions.
- The former root Storybook suite supplied isolated component fixtures and pixel baselines but duplicated lifecycle, Playwright, dependency, and CI infrastructure. Its six useful baselines now belong to the registered `workspace-component-baselines` spec; Storybook itself is retired.
- `apps/workspace-playground/playwright.config.ts` owns a deterministic, single-worker playground with an isolated fixture workspace.
- `packages/agent/e2e/pi-native-playground-showcase.spec.ts` already attaches a full-page screenshot to Playwright evidence.
- `packages/agent/e2e/bombadil/pi-native-chat.spec.ts` demonstrates the intended action/property shape, and `packages/agent/scripts/run-bombadil-chat.mjs` demonstrates target boot/output isolation, but both contain stale Bombadil 0.6.1 contracts. They are conceptual prior art only; do not copy their CLI argv or defaults import path.
- Bombadil 0.6.1 already writes a screenshot for every captured browser state and a `trace.jsonl` entry containing the action, current/previous transition hashes, snapshots, violations, resources, and screenshot path. The review loop should post-process this output rather than fork or patch Bombadil.
- `.impeccable.md` is the project design brief and must ground the critic: precise, calm, editorial, refined minimal, dark-first, tokenized, accessible.

Upstream evidence (pinned source `405d45aba3716a41c50b7dde7431b92c3c329968`):

- [trace entries include action/hash/screenshot/violations](https://github.com/antithesishq/bombadil/blob/405d45aba3716a41c50b7dde7431b92c3c329968/lib/bombadil-browser/src/trace/mod.rs#L15-L47)
- [the file trace writer persists each screenshot and JSONL entry](https://github.com/antithesishq/bombadil/blob/405d45aba3716a41c50b7dde7431b92c3c329968/lib/bombadil-browser/src/trace/writer.rs#L19-L88)
- [browser CLI supports output paths, viewports, time limits, and trace reproduction](https://github.com/antithesishq/bombadil/blob/405d45aba3716a41c50b7dde7431b92c3c329968/docs/manual/src/04-reference.md#L23-L45)

## User stories

1. As an owner, I want one before/after review artifact so I can validate UI work without rediscovering every state.
2. As an implementer, I want desktop/mobile scenarios and hard checks to run automatically before subjective review.
3. As an implementer, I want Bombadil to discover unusual but valid UI states and preserve a reproducible action trace.
4. As a reviewer, I want every AI finding tied to a screenshot/state id, not generic design advice.
5. As an owner, I want the AI score calibrated against my decisions before it blocks work.
6. As a maintainer, I want bounded improvement rounds that cannot churn indefinitely or auto-merge.
7. As a CI operator, I want deterministic fixture-mode proof without requiring paid vision credentials on every PR.

## Decisions

### 1. `/ui` modes

Keep one skill with two explicit modes:

- `review <named-scenario>`: pure capture/evaluation; never edits.
- `improve <named-scenario>`: creates one bounded execution packet and enters `/exec` once.

`/exec` alone owns workers, iterations, proof, and final Inbox handoff; after each change it calls only `ui review`. The packet budgets at most three high-confidence fixes per round and two rounds. A score alone never authorizes a change. V1 rejects arbitrary URLs and runs only named fixture/local scenarios.

### 2. Private scenario-driven repository tool

Owner correction supersedes the earlier app-local extraction threshold. The review engine belongs in the private, non-published `tools/ui-review` workspace package; playgrounds are review targets, not framework owners. Product apps must not depend on the tool at runtime.

The engine resolves only exact ids from a trusted repository registry. A registered review spec supplies repository target root/lifecycle, local route/readiness, isolated fixture/reset, viewports, known checkpoints, hard-gate policy, optional Bombadil exploration/replay, critic context, and owner checks. CLI input may select a name only—never a URL, path, config/module, or command. Behavior specs can target `agent-playground`, `workspace-playground`, `full-app`, or a future `apps/*` root; component specs use private `tools/ui-review/fixtures/*` hosts without modifying engine core or app runtime source.

### 3. Review-spec catalog

A review spec declares:

- stable id, revision, registered app-or-tool target root, and same-origin local route;
- target preparation/server lifecycle plus fixture/reset setup;
- deterministic actions/checkpoints and viewport matrix, including optional per-checkpoint viewport selection;
- optional checked-in Playwright pixel baselines for stable, non-sensitive fixture checkpoints;
- complete hard-gate contract and scenario-owned exemptions;
- optional bounded Bombadil actions/properties and replay selection;
- critic context and exact owner spot checks.

First proof spec: `workspace-command-palette`, reusing the existing visual-regression seam for closed/open, command mode, and keyboard-hint states at desktop `1440×900` and mobile `390×844`. It is an optional registered spec, not the framework identity.

Second spec: `workspace-component-baselines`, replacing the former Storybook job with six tool-owned deterministic fixtures: FileTree, CodeEditor, MarkdownEditor, dock-group chrome, mobile FileTree pane, and narrow data catalog. Each checkpoint declares its one applicable viewport and authoritative Playwright pixel baseline. The five ordinary checkpoints retain the prior 20-pixel Linux rasterization budget; Markdown retains its prior 300-pixel budget for the word-count footer. Every non-zero budget carries a rationale, and any difference over budget is a machine-readable hard-gate failure. Fixture composition and baseline policy live under `tools/ui-review`; no component-review route or import enters `workspace-playground`. Later specs register their own target-owned behavior without changing core; plugin-owned fixtures still compose through a private test host rather than moving review ownership into an app.

### 4. Capture and novelty selection

Known checkpoints use Playwright screenshots. For Bombadil 0.6.1, import browser APIs from `@antithesishq/bombadil/browser` and default properties from `@antithesishq/bombadil/browser/defaults/properties`; invoke `bombadil browser test`. Do not copy the current agent runner's invalid `bombadil test` command or `@antithesishq/bombadil/defaults/properties` import. Bombadil runs separately per viewport and writes its normal trace/screenshots. A post-processor:

1. treats `state.hash_current` as exploration metadata only—not visual identity;
2. uses screenshot digest/perceptual hash plus manifest state to dedupe visuals;
3. assigns unique ids from run, scenario, viewport, ordinal, and screenshot digest;
4. prioritizes violations and diverse dialogs/popovers/loading/error/empty/layout states;
5. selects at most 12 states per viewport and records overflow counts by reason;
6. emits each replay bundle as `reproduce/<state-id>/{trace.jsonl,reproduce.json}`. The manifest pins scenario/spec revision, fixture/reset id, origin, viewport, device scale, and expected normalized state signature/screenshot pHash. Proof runs `bombadil browser test` with those exact flags plus `--reproduce reproduce/<state-id>`, then verifies the reproduced final state—not merely process exit. Bombadil resolves the directory and opens its required `trace.jsonl` filename.

The raw run stays in a temporary directory. A versioned staging policy caps entries, files, and bytes and fails visibly on overflow. CI uploads only reports, manifests, hard gates, selected screenshots, and tested action-prefix reproduce directories—not the full raw screenshot set. Prefix bundles are replay inputs for the CLI; `report.html`, not Bombadil Inspect, is their viewer. V1 does not modify Bombadil.

### 5. Deterministic hard gates

Hard failures are separate from taste scoring and defined in a versioned contract. Each result cites state evidence. Defaults:

- existing Bombadil console/rejection/exception properties;
- HTTP failures outside a scenario-owned URL/status allowlist;
- `documentElement.scrollWidth > clientWidth` unless explicitly allowed;
- visible modal/dialog bounds outside the viewport;
- more than one visible modal blocker unless the scenario allows nesting;
- focused control outside/occluded from the viewport;
- mobile interactive bounds below `44×44` unless a scenario-owned exemption names the control and rationale;
- existing accessibility/contrast assertions and scenario-specific invariants;
- declared pixel-baseline comparison within a narrow, rationale-bearing per-checkpoint rasterization budget for stable, repository-owned component fixtures.

Do not encode taste as a property. Convert recurring defects to DOM/CSS or pixel assertions only when the observable invariant and fixture are stable.

### 6. AI critic contract

The Model Card selects a vision-capable L1 reviewer; Gemini latest Pro is the default. Low-confidence/material disagreement escalates through the existing tier-2 policy, not a UI-specific hierarchy. Fable is off. Record the resolved model id. Inputs:

- `.impeccable.md` design context;
- scenario/viewport/state manifest;
- selected screenshots or contact sheet;
- hard-gate results;
- optional baseline/candidate pairing from the same run.

The runner enumerates every attachment path; Pi does not expand `@file` globs. It spawns Pi with a temporary `HOME` and `PI_CODING_AGENT_DIR`, `PI_OFFLINE=1`, `PI_TELEMETRY=0`, and an environment allowlist containing only required process variables plus the selected provider credential:

```text
env -i PATH="$PATH" HOME="$tmp_home" GEMINI_API_KEY="$GEMINI_API_KEY" \
  PI_CODING_AGENT_DIR="$tmp_config" PI_OFFLINE=1 PI_TELEMETRY=0 \
  pi --print --no-session --no-tools --no-extensions --no-skills \
  --no-prompt-templates --no-context-files --no-approve \
  --system-prompt "$(cat critic-system.md)" \
  --model google/gemini-3.1-pro-preview \
  @critic-prompt.md @manifest.json @selected/desktop/001.png @selected/mobile/001.png
```

Named local fixture data only; credentials never appear in artifacts, prompts, or logs. Required PR CI uses `critic=fixture` with isolated workspace/session roots, ports, config/home, and output. Live Gemini remains an explicit local or protected-nightly opt-in.

Validate output against a versioned JSON schema, then validate every cited `stateId` against the run manifest. Unknown ids make the report invalid; never discard them silently. Permit one format-repair retry; never silently parse prose.

Required output:

```ts
type UiScore = {
  overall: number // 0–10
  dimensions: {
    hierarchy: number
    spacingAlignment: number
    typographyColor: number
    consistency: number
    interactionStates: number
    responsiveAccessibility: number
  }
}

type UiCriticReportV1 =
  | {
      schemaVersion: 1
      mode: 'candidate'
      confidence: number
      candidate: UiScore
      visualFindings: UiVisualFinding[]
      topFixes: UiTopFix[]
    }
  | {
      schemaVersion: 1
      mode: 'pair'
      confidence: number
      baseline: UiScore
      candidate: UiScore
      visualFindings: UiVisualFinding[]
      topFixes: UiTopFix[]
    }

// Runner-owned enrichment, never model-authored:
type UiPairResult = {
  baseline: UiScore
  candidate: UiScore
  signedDelta: Record<keyof UiScore['dimensions'] | 'overall', number>
  statePairs: Array<{ baselineStateId: string; candidateStateId: string }>
}

type UiVisualFinding = { stateIds: string[]; evidence: string; severity: 'note' | 'concern' }
type UiTopFix = { stateIds: string[]; problem: string; recommendation: string; confidence: number }
```

Every finding/fix cites unique manifest ids owned by the supplied screenshot bytes. The runner validates role ownership (baseline/candidate), supplied-image membership, digest equality, and deterministic state pairing; it computes signed deltas itself. AI findings are advisory; only `hard-gates.json` blocks. The critic may not inspect or edit the repository.

### 7. Scoring and calibration

- V1 score is advisory; hard gates block immediately.
- In V1, baseline/candidate comparison is limited to `ui improve` rounds where the pre-fix capture is locally available. A plain PR `ui review` is candidate-only; cross-branch baseline acquisition is deferred until nightly artifacts prove stable. When pairs exist, score them in one critic request to reduce model/version drift.
- Do not fail on an absolute score such as `<8`.
- Persist only non-sensitive calibration metadata: scenario, baseline/candidate revisions, score/confidence, owner disposition, prompt/rubric/manifest hashes, screenshot digests, and resolved model. Never persist private screenshot bodies in calibration records.
- After at least 10 owner-reviewed runs, propose a separate owner-approved change to gate only high-confidence regressions. Until then, score ranks work and summarizes progress.
- Use Grok latest as a second opinion only when Gemini confidence is low or the claimed regression is material; do not run panels by default.

### 8. Bounded improvement

`ui improve` emits one execution packet containing the evidence and budget. `/exec` selects fixes and owns the loop; it calls `ui review` after changes and stops when hard gates are green, no material high-confidence issue remains, score/delta stalls, fixes become subjective/out-of-scope, two rounds complete, or review budget is exceeded. The normal `/exec` proof/review ladder applies. No Fable.

### 9. Artifacts and Inbox

Raw capture writes to a temporary run directory. The bounded owner report is copied to workspace-relative ignored `.pi/ui-review/runs/<run-id>/` so existing `workspace.open.path`/HTML viewing can open it:

```text
manifest.json
hard-gates.json
selected/<viewport>/*.png
reproduce/<state-id>/trace.jsonl
selection.json
critic.json
report.html
report.md
```

`report.html` is the single owner artifact: before/after contact sheet, score/dimension delta, deterministic failures, selected action traces, accepted fixes, remaining concerns, and exact manual spot checks. Treat trace/model text as untrusted: escape all strings, allow local selected-image references only, render no active links/forms/scripts, and emit a restrictive CSP (`default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'`). Open through `workspace.open.path` and project through the existing Inbox/Human Intention path; do not invent a review store. CI uploads the bounded staging directory.

### 10. Nightly exploration

After local/PR behavior is proven, add a longer nightly Bombadil job. It uploads bounded traces/reports and may create one deduplicated issue only for deterministic violations. AI visual findings remain report-only until a separate owner-approved calibrated gate exists. Nightly never edits code, opens fix PRs, or merges.

## Flag / abstraction

- **Runtime flag:** not needed; this is opt-in developer/CI tooling and does not ship product behavior.
- **Abstraction:** private `tools/ui-review` engine plus validated registered review specs and a versioned critic JSON contract. Core owns orchestration/evidence; each spec owns target and UI semantics.
- **Rollback:** remove the tool/workflow/skill mode; product runtime and persisted user state are unchanged.

## Test seams

### Highest public seam

A real workspace-playground browser session using its existing isolated fixture/server, exercised by Playwright and Bombadil.

### Tests

- unit fixtures for trace parsing, transition/perceptual dedupe, priority selection, discriminated critic schemas, baseline/candidate role plus screenshot-digest validation, runner-computed signed deltas, bounded staging-artifact assembly, and report generation;
- Playwright test for known `command-palette` checkpoints at both viewports;
- registered component-fixture review proving six per-checkpoint viewport declarations and checked-in pixel baselines without Storybook;
- short Bombadil fixture run proving safe actions, hard properties, bounded selection, overflow reporting, and one actual selected-state `--reproduce` run;
- critic fixture test with deterministic JSON (no network/model in required CI);
- opt-in live Gemini smoke producing a valid `critic.json` and owner report;
- negative tests: invalid critic output, unknown/wrong-role/digest-mismatched state ids, missing screenshots, external navigation, destructive-action filtering, hard-gate failure, and adversarial report strings (`<script>`, `javascript:`, remote resources, forms) proving escaping/CSP/no-active-content.

### Avoid testing

- exact screenshot bytes outside explicitly declared, stable component-fixture baselines, or exact AI scores;
- provider prose/chain-of-thought;
- Bombadil internals already covered upstream;
- private screenshot content in committed fixtures.

## Acceptance

1. One command reviews the `command-palette` scenario at desktop/mobile sizes and produces a single HTML report.
2. Hard browser/a11y/layout failures are machine-readable and block regardless of AI score.
3. Bombadil exploration produces bounded, diverse screenshots; replay restores fixture/spec/viewport/device scale and verifies the expected final state.
4. Gemini output validates against the candidate/pair `UiCriticReportV1`; every finding owns a supplied, digest-matching baseline/candidate state, and the runner computes signed deltas.
5. The score is advisory and displayed with confidence, rubric version, model id, and baseline/candidate delta when available.
6. `ui improve` creates one bounded execution packet; `/exec` owns at most two rounds and final handoff.
7. The final Inbox artifact contains before/after evidence and a concise manual playbook.
8. Generated HTML escapes untrusted content and blocks active/remote content with CSP.
9. No runtime product state, raw provider reference, secret, private screenshot, or merge authority is added.
10. Storybook configuration, stories, dependencies, scripts, and its duplicate workflow are removed after all six component baselines pass through `workspace-component-baselines` in the main UI-review CI job.

## Proof

Required commands will be finalized with the implementation, targeting:

```bash
pnpm --filter @hachej/boring-ui-review-tools typecheck
pnpm --filter @hachej/boring-ui-review-tools test
pnpm --filter workspace-playground typecheck
pnpm --filter workspace-playground test
BOMBADIL_TIME_LIMIT=30s pnpm --filter @hachej/boring-ui-review-tools test:explore -- workspace-command-palette
pnpm --filter @hachej/boring-ui-review-tools ui:review -- review workspace-command-palette --critic=fixture
pnpm --filter @hachej/boring-ui-review-tools ui:review:components:ci
```

Opt-in live proof:

```bash
BORING_UI_REVIEW_MODEL=google/gemini-3.1-pro-preview \
  pnpm --filter @hachej/boring-ui-review-tools ui:review -- \
  review workspace-command-palette --critic=pi
```

Manual owner proof: open `report.html`, verify the selected states/action traces, compare desktop/mobile before/after, and submit approve/request-changes from Inbox.

## Slices

### Slice 1 — Known-state vertical tracer

**Delivers:** `ui review` for `command-palette`: desktop/mobile Playwright checkpoints, versioned hard gates, hermetic critic fixture/live adapter, validated candidate score, HTML report, and a required credential-free PR CI job.

**Blocked by:** None.

**Proof:** unit + Playwright + critic-fixture commands; one opt-in live report.

**Review budget:** inside; one app, one scenario, no Bombadil changes.

### Slice 2 — Bombadil exploration and novelty selection

**Delivers:** correct Bombadil 0.6.1 browser CLI/import contracts, safe workspace action model, desktop/mobile runs, trace ingestion, deterministic novelty selection, reproducible action prefixes, and selected states in the same report/critic contract.

**Blocked by:** Slice 1.

**Proof:** short deterministic-target exploration, bounded selection/overflow fixtures, an actual `--reproduce` invocation, and report inspection; extend the PR CI job with this short run.

**Review budget:** inside if kept app-local and capped to one scenario.

### Slice 3 — Bounded improvement and Inbox handoff

**Delivers:** `ui improve` execution-packet creation; `/exec`-owned max-two-round flow, before/after report, calibration metadata, and final Human Intention artifact/playbook.

**Blocked by:** Slices 1–2.

**Proof:** introduce a controlled visual defect, detect it, apply one bounded fix, rerun green, and resolve the Inbox review.

**Review budget:** inside; orchestration only, no new task/review authority.

### Slice 4 — Nightly exploration and calibrated gating proposal

**Delivers:** longer scheduled Bombadil run, bounded artifact upload, deterministic-violation issue reporting, report-only AI findings, and evidence from at least 10 owner-reviewed runs for a separate gating decision.

**Blocked by:** Slice 3 and calibration evidence.

**Proof:** workflow fixture/dry run plus one scheduled artifact; no autonomous code changes.

**Review budget:** inside; gating activation remains a separate owner decision.

## Out of scope

- autonomous merge or release;
- Fable review;
- replacing deterministic Playwright/a11y tests with AI judgment;
- screenshot-byte golden tests outside declared deterministic component fixtures;
- unrestricted browser actions, production data, or external navigation;
- repairing the separate agent-chat Bombadil baseline except where a shared contract fix is intentionally extracted;
- publishing the private cross-app review tool;
- automatic absolute-score failure before calibration;
- storing private screenshot bodies in git or review metadata.

## Open questions

1. **Second target:** Inbox/Human Intention becomes the next scenario after its plugin-owned fixture is mounted through a test-only host.
2. **Taste gate:** V1 advisory is locked; blocking thresholds require a later owner decision after calibration.
3. **Retention:** raw Bombadil runs use temporary storage; long-term retention is deferred until real volume is measured.
