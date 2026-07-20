---
github: https://github.com/hachej/boring-ui/issues/875
issue: 875
state: ready-for-agent
updated: 2026-07-20
track: owner
---

# gh-875 autoresearch v1 and Automations pilot

## Problem

Boring can review deterministic UI and can execute reviewed work, but it lacks one
small controller that repeatedly combines UI evidence, functional proof, and
independent review into bounded fix/test/review iterations. The Automations pane
is the first pilot: PR #874 supplies a registered four-state review and currently
reports three authoritative mobile failures, while the plugin's functional suite
is green.

## Solution

Add an explicit-only `/skill:autoresearch` and one canonical Kanzen procedure.
The skill does not replace planning or execution: it loads the regular `/plan`
and `/exec` contracts, establishes a baseline, selects at most three material
findings, executes one bounded change set, re-proves function and UI, obtains
independent reviews, and repeats until convergence or the iteration cap.

Pilot the loop on `plugins/boring-automation` with `automation-pane-popover` as
the UI judge, plugin tests/typecheck as functional judges, existing UI-review
regression coverage, and the owner-selected Sol xHigh plus Claude Opus 4.8 high
review pair. The cap is five iterations; stop early when the plugin is simple,
robust, performant, and both reviewers find no material UX/correctness issue.

## Decisions

1. **One controller, existing workers.** `autoresearch` orchestrates the canonical
   plan/exec procedures rather than implementing or reviewing by itself.
2. **Combined review.** Every iteration records deterministic functional/UI
   gates, performance evidence, and advisory independent review; visual review
   starts only after hard gates permit it.
3. **One plan, one exec, bounded internally.** Run the regular plan once, then
   one regular exec as the sole writer across at most five internal rounds and
   one terminal owner handoff. Baseline review is iteration 0 and does not spend
   a writer round. Starting selection spends a round; UI `improve` packets are
   not used.
4. **Stable selection and stops.** Normalize IDs as `<source>:<check>:<subject>`,
   deduplicate exact IDs, carry unresolved findings forward, and order them by
   deterministic-gate failure, reviewer agreement, severity, then ID. Progress
   means at least one carried finding resolves or drops severity without a new
   equal-or-higher deterministic failure. Two consecutive writer rounds without
   that progress stop as stalled. Terminal states are `success`, `stalled`, `blocked-owner`, and
   `cap-exhausted`; iteration five permits no sixth writer round.
5. **Proof and reviewer boundary.** A red deterministic proof closes the round
   without model calls and carries its normalized failures forward. A command
   may retry once at the same revision with both attempts recorded: reproducible
   product failures become findings; repeated infrastructure failure ends
   `blocked-owner`. A green proof permits exactly one blind call to each reviewer
   on that revision. Success requires every acceptance gate and both reviews
   clean on the same commit/tree.
6. **External judges and red baseline.** Host contracts, gates, and tests stay
   independent from the product writer. Preserve iteration 0 by revision and
   artifact digest for comparison only; do not pass its red report as a paired
   `--baseline-dir`. When intended product work leaves only visual-baseline
   mismatches, inspect every captured delta locally, use only
   `ui:review:automation:update`, preserve before evidence, and rerun an unpaired
   56/56 review. The blind pair then judges the final tree plus before/after
   evidence; rejection becomes the next round's finding. An update first needed
   after round five ends `cap-exhausted`.
7. **Reviewer override is run-local.** Fresh isolated sessions resolve
   `anthropic/claude-opus-4-8` at high as the owner-approved tier-1 override and
   `openai-codex/gpt-5.6-sol` at xHigh as tier 2. They receive the same
   revision-bound packet but not each other's verdict. Record role, target
   commit/tree, resolved model, effort, transport, verdict, and findings/link;
   unavailable models stop `blocked-owner` rather than silently substituting.
8. **Performance budget.** Record raw and gzip bytes for
   `plugins/boring-automation/dist/front/index.js`. Growth greater than the
   larger of 2% or 2 KiB requires reviewer rationale and owner approval. This
   responsive pilot adds no dependency, request, async path, or persistent
   state; crossing that boundary is an unconditional `blocked-owner` stop.
9. **Iteration record.** Record issue/run ID, base and candidate commit/tree,
   iteration number, evidence paths/digests, deterministic command results,
   ordered findings, selected fixes, bundle bytes, both reviewer records,
   dispositions, and terminal state.
10. **Stacked delivery.** This branch starts from PR #874 because the registered
   automation review is required evidence. Retarget to `main` after #874 lands.

## Flag / Abstraction

- Needed?: No runtime flag; workflow skill and plugin UI only.
- Path: `.agents/skills/autoresearch`, `.gitignore`, the agent-resource checker,
  `docs/kanzen/procedures/autoresearch.md`, `tools/ui-review/package.json`,
  `plugins/boring-automation/**`, and intentional automation baseline updates.
- Rollback: revert the workflow commits and product changes independently; no
  migration or persisted-data shape changes.

## Test Seams

- Highest public seam: registered `automation-pane-popover` browser review and
  the package's public front/server behavior tests.
- Existing prior art: `/plan`, `/exec`, visual-review hard-gate loop, automation
  Testing Library suites, and command-palette Bombadil regression proof.
- Avoid testing: private React state or implementation-only helper calls when a
  visible/functional seam exists.

## Acceptance

- `.agents/skills/autoresearch/SKILL.md` is compact, explicit-only, validated,
  and follows one regular plan plus one regular exec with bounded internal rounds.
- Kanzen policy defines deterministic inputs, iteration records, reviewer
  independence, bounds, baseline handling, and stop conditions once.
- Automation typecheck and all package tests pass.
- `automation-pane-popover` has 56/56 authoritative gates passing at desktop
  and mobile, with reviewed before/after evidence.
- Existing command-palette review remains green after shared review changes.
- Automation front bundle and interaction behavior show no material performance
  regression; new async/state work is justified and bounded.
- Success requires Sol xHigh and Opus 4.8 high clean on the same final revision;
  otherwise the run ends stalled or cap-exhausted and escalates to the owner.
- Current CI is green and the PR provides an owner-runnable artifact; no merge is
  performed automatically.

## Proof

- `pnpm install --frozen-lockfile`
- `pnpm --filter @hachej/boring-automation typecheck`
- `pnpm --filter @hachej/boring-automation test`
- `pnpm --filter @hachej/boring-automation build`
- `node --input-type=module -e "import{readFileSync}from'node:fs';import{gzipSync}from'node:zlib';const b=readFileSync('plugins/boring-automation/dist/front/index.js');console.log(JSON.stringify({raw:b.length,gzip:gzipSync(b).length}))"`
- `pnpm --filter @hachej/boring-ui-review-tools typecheck`
- `pnpm --filter @hachej/boring-ui-review-tools test`
- `pnpm --filter @hachej/boring-ui-review-tools ui:review -- review automation-pane-popover --critic=fixture`
- `pnpm --filter @hachej/boring-ui-review-tools ui:review:automation:update`
- `pnpm --filter @hachej/boring-ui-review-tools ui:review -- review workspace-command-palette --critic=fixture`
- `pnpm check:generated-artifacts && pnpm check:agent-resources && pnpm audit:imports`
- `pnpm check:action-pins && pnpm check:dependency-age && git diff --check`
- `pnpm check:agent-resources` validates Pi discovery/frontmatter/pointers;
  manually invoke `/skill:autoresearch plugins/boring-automation goal=<goal> ui=automation-pane-popover max=5` in the worktree
- `test "$(gh pr view <pr> --json headRefOid -q .headRefOid)" = "$(git rev-parse HEAD)" && gh pr checks <pr>`
- Open the final `report.html`; inspect all four selected desktop/mobile images,
  compare each changed baseline with iteration 0, exercise New/Edit/Cancel/Create
  at 390×844 and desktop, and confirm labels, focus, scrolling, and touch targets

## Slice

### Slice: v1 skill and five-iteration Automations pilot

**Delivers:** the explicit controller, canonical procedure, iteration evidence,
responsive/touch-safe Automations UX, robustness/performance proof, and reviewed
stacked PR.

**Blocked by:** PR #874 provides the registered review spec; execution can proceed
on its branch and final merge order remains #874 before this PR.

**Proof:** commands above plus per-iteration Sol/Opus verdicts.

**Review budget:** inside; product scope remains one plugin and the workflow
surface is a compact skill/procedure.

## Out of Scope

- Unbounded autonomous execution or automatic merge.
- Changes to automation persistence, scheduling, authorization, routes, or data
  migrations unless a discovered blocker requires explicit owner approval.
- A generic plugin manifest system, automatic target discovery, or CI-wide
  autoresearch scheduling.
- Weakening review gates or accepting snapshots solely to make a run green.

## Open Questions

None blocking. Product-level choices that cannot be resolved by the stated goal,
existing design system, and objective evidence stop for owner intent.
