# Proof of work

Every implementation needs auditable proof. Do not say “tested” without evidence.
[Risk-based delivery](boring-loop.md) decides who approves; this procedure owns
the evidence required on both automatic and owner-reviewed paths.

## Accepted proof types

- **Exact command** — command, environment, revision, result and short output.
- **Runtime evidence** — scenario assertions and artifact/URL showing the actual
  feature path, not only compilation or an agent's self-report.
- **Manual steps** — exact reproduction/verification path, with who ran it and
  the observed result; a proposed test is not an executed test.
- **Waiver** — a scoped owner decision, why proof is unavailable, and residual
  risk. Never self-grant; a waiver disqualifies automatic merge and cannot waive
  the cross-package abstraction gate or frozen architectural invariants.

Use the proof appropriate to the change; these are not interchangeable ways to
avoid required automated checks, independent review or UI video.

## PR proof comment

Before owner review or merge, post proof for the current PR head SHA, subject/
title carrying the bead ID (`[br-###]`). Keep the implementation PR's
`present-pr` artifact (`.agents/skills/present-pr/`): context, area/package flow,
importance-ordered diffs and runnable validation. Link evidence from the PR and
Bead rather than duplicating a new ledger.

```md
Proof of work

What changed:
Issue / Bead / PR:
Base / head SHA:
Risk route and matched triggers:
Package production additions + deletions / exclusions:

Automated verification:
- `command` — environment, revision, result

Independent review:
- reviewer, reviewed revision, verdict, finding dispositions

Abstraction review:
- PASS / BLOCKED; link the complete coding-invariants review record
  (docs-only: explain why no code/contracts changed; policy risks still apply)

UI evidence:
- before / after revisions, scenario, assertions, video and report / N/A

Integration proof:
- current main SHA, candidate revision, checks and result

Waiver / known gaps:
- None / scoped owner decision and residual risk

Rollback:
- exact change to revert or flag to disable, limits and authorization needed
```

A new commit, changed base/integration candidate or changed scenario invalidates
affected evidence. Re-run the relevant checks, review and captures. Read back
artifact links through the actual PR/Inbox surface before claiming delivery;
worktree-relative files must resolve to the bound worktree, not an unrelated
canonical checkout. Evidence must survive session loss and remain accessible to
the owner; record demo expiry separately from durable recordings.

## UI proof: Playwright before and after

For UI appearance/behavior changes, including plugin UI, provide a short
Playwright-recorded comparison before merge. A pair of labeled clips or one
combined video is acceptable. A screenshot or narrated claim alone is not.

1. Run the same relevant user journey on the actual base and candidate revisions
   in isolated environments with the same fixture data, viewport and scenario.
   Record both SHAs and the scenario command. Use applicable desktop/mobile
   viewports; make omissions explicit.
2. Show the interaction and outcome, not only static pages. Supply short captions
   or a companion timestamped explanation of what changed and why.
3. Include deterministic assertions for the intended behavior and applicable
   accessibility/layout/focus checks. For a bug fix, label the expected base
   failure and candidate success. For a new feature, show the real prior state
   (including absence); never fabricate a matching before implementation.
4. Publish the recordings plus scenario/assertion results to an owner-accessible
   artifact surface and link them from the PR/review artifact. Strip secrets,
   customer data and sensitive host information. If using a local playground,
   never post public host/IP addresses; safe preview URLs and operator-local
   paths are OK.
5. Independent review checks the actual evidence. Missing, failed, stale or
   inaccessible capture blocks automatic merge; repair first or request a
   scoped owner proof exception. A video does not substitute for passing tests
   or the abstraction gate.

**Plugin UI does not wait for the owner to watch or approve the video** when no
protected boundary applies and automatic admission is enabled. Shared design
system/global UX changes still follow the owner route. The video remains in the
post-merge receipt for later inspection. Use existing
[visual-review](visual-review.md) scenarios; this docs change does not claim the
current UI tooling already produces or enforces the required videos.
