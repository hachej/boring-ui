# Boring Loop — Risk-Based Delivery

Owner-approved process amendment, 2026-09-07. This file owns workflow, human-review
boundaries, and merge eligibility. Factory seats/tools live in
`.agents/factory/README.md`; they wrap this procedure, not replace its gates.
This is adopted policy, **not a claim that merge automation is implemented**;
see [Rollout and precedence](#rollout-and-precedence).

## Default: small changes, frequent integration

```text
feedback → triage → plan → exec → verify/review → integrate → observe
                         ↑ owner decision only at a protected boundary
```

Use a tracked issue and the smallest independently useful, reversible slice.
Keep short-lived branches/worktrees under `.worktrees/`, retain PRs as the audit
and integration surface, and keep remote `main` protected. Trunk-based delivery
means frequent integration, not direct agent pushes or skipping CI. Respect
existing Factory epic ownership and the [worktree procedure](worktree-agent.md).
Titles follow [naming conventions](naming-conventions.md).

| Step | Required output |
| --- | --- |
| feedback | Deduplicated, redacted bug issue or feature-backlog item. Backlog capture is not implementation approval. |
| triage | Verified scope, risk triggers, first blocker, next action. |
| plan | Clear objective, acceptance, proof path, rollback, next ready slice/Bead; a short TODO suffices for routine work. Ask only for decisions the agent cannot safely make. |
| exec | Surgical implementation and regression tests in the owned worktree. |
| verify/review | Current proof, independent review, explicit package-abstraction verdict, and UI video where applicable. |
| integrate | Reclassify the final diff; use the automatic path only when eligible and enforced, otherwise the owner gate. Validate the integration candidate against current main. |
| observe | Record landed SHA, proof/video links, rollback and outcome; monitor main and stop further integration if it breaks. |

## Where the owner reviews

Protected boundaries override location, size, and an agent's claim that work is
safe. A plugin is not exempt from security or architectural rules.

| Trigger | Owner judgment needed |
| --- | --- |
| Product direction | New behavior with an unclear intended outcome, or a material departure from an approved plan. Not routine implementation choices. |
| Shared core/contracts | Public API or MCP contract changes, package-boundary/ownership changes, or **more than 500 added + deleted production-code lines under `packages/`** in the PR. |
| Security/authority | Authentication, permissions, tenant isolation, secrets, data disclosure, or changes to what agents may do autonomously. |
| Money/irreversibility | Billing behavior, new spending commitments, destructive migrations, data deletion, or hard-to-reverse releases. Existing explicit release/publish permissions remain required. |
| Shared design language | Shared design-system components/tokens or global navigation changes affecting multiple apps. Not ordinary plugin UI. |
| Automation's own rules | Risk classification, approval requirements, required checks, merge authority, safety bypasses, or instructions/skills that change those powers. |
| Exceptions | A proposal to ship with failed/missing proof, unresolved review findings, or uncertain rollback. Block by default; only an explicit, scoped owner decision can grant a permitted waiver. Architectural invariant violations cannot be waived by an ordinary merge approval. |

**Size calculation:** sum additions and deletions across production-code files
under `packages/` in the complete base-to-head PR diff, not net growth, per-file
size, or the last commit. Exclude tests, docs, generated output and snapshots
from this numerical trigger only; those files still receive risk classification
and review (including test weakening). Exactly 500 does not trigger size review;
501 does. In a mixed plugin/package PR count the package portion. Inspect both
old and new paths for moves/renames so relocation cannot hide package changes.
Unknown file classification or unreadable diff blocks automatic admission. Do
not split a coherent risky change or relabel source as generated/test code to
avoid review; genuinely independent, safe slices are encouraged.

**Otherwise automatic-eligible:** plugin/peripheral features and fixes within
an agreed objective; small internal package changes; routine docs/tests and
maintenance. Eligibility still requires every gate below. **Plugin UI may
merge without waiting for the owner to watch its before/after video.** Video
availability and behavioral proof are requirements, not owner approval.

Record the matched triggers, package line count/exclusions, base/head SHAs and
classification reason in the PR proof. Classification uses deterministic,
versioned rules with protected paths evaluated first; labels or the implementing
agent's opinion cannot grant merge authority. Semantic risk discovered in review
can only escalate the route. Unknown risk is blocked pending resolution.

## When to ask, and when not to

- **Before implementation:** obtain the product, architecture, security or
  irreversible-action decisions needed to choose a safe plan. For an expected
  >500-line package change, agree scope/slicing before coding. Where Gate 1 is
  required, approval covers the plan and its Bead graph, not an unseen final diff.
- **Before merge:** obtain approval for protected-boundary changes against the
  actual reviewed revision. Plan approval is not merge approval.
- **After merge:** routine work gets a digest/PR receipt with proof, UI video and
  rollback links, not another decision request.
- Ordinary failed checks and review findings go back to the agent for repair
  within the configured attempt/review caps. Ask only for a genuine decision or
  an exhausted recovery path; never silently reset budgets or infer approval.

Use [owner review cards](owner-review-card.md) through Inbox/`ask_user` (GitHub
comment fallback). Preserve unanswered existing decisions. Material scope or
revision changes invalidate the affected approval; do not manufacture, transfer,
or silently broaden approval.

## Mandatory verification and review gates

1. Run relevant lint, typecheck, tests, invariants and applicable E2E in a
   controlled environment against committed code; use bounded sandboxes rather
   than parallel whole-repo builds on the editing host. Never weaken assertions
   or skip required checks to make work green.
2. Obtain independent standards/spec review and thermo for code, at the tiers
   in [MODEL-CARD](MODEL-CARD.md). Worker self-check is not independent review.
   No blocker/major finding may remain open on the automatic path.
3. **Every code PR must pass the [cross-package abstraction gate](coding-invariants.md#cross-package-abstraction-review-hard-gate).**
   This includes plugin-only and one-line changes. Passing tests, a video,
   reviewer silence or owner merge approval cannot replace this verdict.
4. For UI behavior/appearance changes, attach the Playwright before/after video
   and deterministic scenario proof specified in [proof-of-work](proof-of-work.md).
   Missing, stale or inaccessible evidence blocks automatic merge.
5. Bind classification, checks, review and artifacts to the final revision.
   Re-run affected verification/review after changes. Validate the candidate
   combined with current `main` before landing, using a merge queue or equivalent
   controlled integration step; stale branch-green results alone are insufficient.
   If main moves, validate the new combination before admitting it.
6. Keep required GitHub checks and broad main checks. Merge is not permission to
   deploy/publish; existing release policy remains separate. On failure, stop
   integration and repair or use an authorized rollback; preserve the incident
   and re-review evidence rather than reporting a false close.

Every implementation PR retains the runnable proof and `present-pr` artifact
required by [proof-of-work](proof-of-work.md). Automatic delivery removes human
waiting, not independent review, evidence or traceability.

## State model

- Category: `bug` or `enhancement` (one when possible).
- State: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, or
  `wontfix` (exactly one).
- First blocker: `clarity`, `risk`, `plan`, `implementation`, `proof`, `review`,
  `merge`, or `none`.

Put detail in comments, not new gate/track labels. Use `ready-for-human` for an
actual owner decision, not routine test/review iteration. Default is one issue
per PR; preserve the [rolling small-fixes batch](rolling-small-fixes.md) exception
and existing epic branch ownership. No new scheduler, ledger or runtime is
introduced by this process.

## Rollout and precedence

This owner amendment replaces blanket owner review for routine work and the
old class-A eligibility description with the boundary policy above. It aligns
with the [ratified vision](../plans/long-term/ratified/VISION.md): authority is
host-owned, approvals cannot be fabricated, verification is independent, and
recovery preserves honest outcomes. It changes no package ownership or frozen
architectural ruling; changing one requires an explicit owner decision and an
amendment to the ratified plan before the abstraction gate can pass.

**Not enabled by this docs change:** `.agents/factory/policy.yaml` still has the
old allowlist/300-line class-A predicate; Factory stage/skill prompts and live
host gates may still require both owner gates. Risk classification, video
admission, the explicit abstraction verdict, and current-main integration must
be wired and tested before the broader automatic path is enabled. Until then,
keep existing enforced restrictions and owner merge handoffs; never bypass
branch protection or interpret this document as a fabricated gate answer.
The rollout gates Factory delivery under issue #1508.

**Unchanged exceptions:** rolling batches remain `owner-flush` until
[their procedure](rolling-small-fixes.md) is explicitly amended. AGENTS.md's
written permission requirement for file deletion/destructive operations remains
in force. Existing pending owner decisions are not retroactively auto-approved.
Policy/CI/merge-control changes themselves take the owner route. No host restart,
GitHub configuration change, deployment or merge is authorized by this rewrite.
