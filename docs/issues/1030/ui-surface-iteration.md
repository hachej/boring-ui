# Issue 1030: Surface-by-surface UI iteration

Tracking issue: https://github.com/hachej/boring-ui/issues/1030

Use this workflow when a broad UI redesign contains useful ideas but is too large or regressive to merge safely. It converts the prototype into small, owner-validated surface PRs.

## Authority and intent

- The existing prototype is the **design and code starting point**, not a patch to merge wholesale.
- The owner’s visual judgment is authoritative. Automated checks catch regressions; they do not overrule taste.
- Work on one named surface at a time in a dedicated branch, worktree, playground, review spec, and PR.
- Preserve the current application-wide palette and foundation unless the owner explicitly approves a foundation change.
- Do not modify, clean, or depend on the prototype worktree. Treat it as read-only reference material.
- Never merge without explicit owner approval.

## Inputs

Record these before implementation:

1. **Prototype source:** branch, worktree, commit, session, screenshots, and reports being used as reference.
2. **Target surface:** the single bounded product area under review.
3. **Explicit exclusions:** broad changes that must not be carried over, especially palette, tokens, or unrelated surfaces.
4. **Known owner feedback:** accepted ideas, rejected ideas, and unresolved visual questions.
5. **Current base:** current `origin/main`, not the prototype’s potentially stale base.

## Workflow

### 1. Inventory the prototype

Read the source session and inspect the prototype diff. Produce a surface-specific inventory of visible changes and their implementation files.

Classify each change as:

- **Candidate:** worth carrying into the isolated surface.
- **Rejected:** explicitly declined by the owner.
- **Dependency:** required to make a candidate work; challenge whether it can remain surface-local.
- **Unrelated:** belongs to another surface and must stay out.

Do not copy broad token or foundation changes merely because the prototype used them. Re-express approved behavior using the current design system wherever possible.

### 2. Create an isolated implementation

Create a fresh worktree under `.worktrees/` and a dedicated branch from current `origin/main`.

Port the prototype selectively:

- Use its code and visual decisions as the starting point.
- Reimplement when direct copying would import regressions, stale assumptions, broad dependencies, or poor abstractions.
- Keep the diff limited to the target surface, its tests, its private review fixture/spec, and narrowly necessary shared code.
- Preserve the existing application palette unless separately approved.

### 3. Build a dedicated playground

Provide a stable way to inspect the surface without navigating unrelated application state. Cover representative states, including where relevant:

- default, loading, empty, error, and active states
- short and long content
- collapsed and expanded controls
- keyboard and pointer interaction
- desktop and mobile widths
- light and dark themes
- overflow, truncation, and reduced motion

Prefer an existing app playground for real behavior. Keep review-only fixtures under `tools/ui-review/fixtures/`; never add review-only code to product source.

### 4. Register the UI review scenario

Add or extend an exact registered spec for the surface in `tools/ui-review`. The spec owns its route or fixture, viewports, checkpoints, hard gates, evidence, and owner spot checks.

Use the repository UI tooling:

```text
pnpm --filter @hachej/boring-ui-review-tools ui:review -- review <registered-spec> --critic=fixture
pnpm --filter @hachej/boring-ui-review-tools ui:review -- improve <registered-spec> --critic=fixture [--baseline-dir <prior-run>]
pnpm --filter @hachej/boring-ui-review-tools ui:improve:validate -- <run-directory>
```

Deterministic accessibility, layout, focus, touch, request, behavior, and approved pixel-baseline gates are authoritative. Model critic findings are advisory.

### 5. Iterate with the owner

Expose the running playground URL and give exact inspection steps. Present changes as discrete decisions the owner can keep, revise, or revert.

For this surface-by-surface workflow, iteration is **not capped at three fixes or two rounds**. Continue for as many bounded rounds as needed, while maintaining these safeguards:

- Keep each round understandable and reviewable.
- Do not silently expand into another surface.
- Re-run relevant hard gates after meaningful changes.
- Compare against the prior accepted baseline, not only the latest experiment.
- Stop and ask when a dependency would alter the app-wide foundation.
- Record owner decisions so rejected ideas do not return in later rounds.

### 6. Prove and review

Before handoff:

- Run relevant unit, integration, typecheck, lint, and UI-review gates.
- Capture the final playground URL and visual evidence.
- Verify desktop/mobile and light/dark behavior where supported.
- Run independent standards and spec review; add a deeper maintainability review for broad or structural changes.
- Document residual risks and rollback.

### 7. Open the dedicated PR

The PR must contain only the approved surface slice and its proof infrastructure. Include:

- prototype provenance
- accepted and rejected decisions
- explicit exclusions
- changed surface behavior
- exact test and review commands
- playground URL and manual spot checks
- screenshots/report artifacts
- risk and rollback notes

Request owner validation against the playground. Merge only after explicit approval.

### 8. Repeat for the next surface

After merge, start the next surface from updated `origin/main`. Do not stack future surface work on an unmerged visual branch unless the owner explicitly requests a stack.

## Surface record template

```md
# <Surface name>

## Prototype source
- Session/worktree/branch:
- Relevant reports/screenshots:

## Scope
- Included:
- Excluded:
- Palette/foundation policy:

## Change inventory
| ID | Visible change | Prototype files | Decision | Notes |
| --- | --- | --- | --- | --- |
| 1 | | | candidate / keep / revise / revert | |

## Playground
- Command:
- URL:
- States:

## UI review
- Registered spec:
- Baseline run:
- Latest run:
- Hard gates:
- Advisory findings:

## Owner decisions
- Accepted:
- Rejected:
- Remaining:

## Proof
- Automated commands:
- Manual spot checks:
- Artifacts:

## PR
- URL:
- Risk/rollback:
- Approval status:
```

## First application: chat surface

For the chat slice derived from Claude Code session `41f9141f-ebae-4e10-9cfa-9adce4b02488`:

- Use `.worktrees/ui-aaa-polish` as a read-only prototype reference.
- Start from current `origin/main`; do not merge or clean the prototype branch.
- Preserve the original application palette. Ignore the prototype’s app-wide color/foundation redesign.
- Begin with the transcript, tool/reasoning rows, typography, expanded tool output, and the owner-requested visible collapsed-tool treatment.
- Create a dedicated chat playground and registered UI-review spec.
- Iterate improvement-by-improvement until owner approval, then open a chat-only PR.
