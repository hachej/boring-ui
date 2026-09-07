# Trunk, Flags, And Review Budget

## Integrate frequently, keep isolation

Default: trunk-based delivery through small, short-lived PRs. Protect remote
`main`; agents do not push directly to it. Keep the canonical checkout on `main`
as the coordination anchor and do coding in `.worktrees/` per AGENTS.md and
[worktree-agent](worktree-agent.md). This supersedes the older recommendation
to use local `main` as the coding bench. Never repair a dirty anchor by
stashing, resetting or overwriting another agent's work.

| Case | Path |
| --- | --- |
| routine plugin/peripheral change | small PR; independent proof and abstraction review; automatic merge when the policy is enforced |
| plugin UI | same, plus accessible Playwright before/after video; no owner watch/approval wait |
| internal package change | same unless the package line threshold or another protected boundary applies |
| protected boundary | owner decision before implementation when needed; actual-diff approval before merge |
| not safely releasable yet | feature flag, expand/contract, or branch-by-abstraction; every landed slice must remain safe |
| intentional package ownership/contract change | plan first, owner decision, ratified contract update where required, then abstraction review against that contract |

Human-review triggers and counting are owned by
[boring-loop](boring-loop.md#where-the-owner-reviews): **more than 500 added +
deleted production-code lines under `packages/`**, excluding tests/docs/generated
output/snapshots for size only. This replaces the former approximately 1,500
added-line review budget; it is not a blanket plugin size exemption from risk.

Validate the combined candidate against current main before landing; a merge
queue or equivalent controlled integration step must prevent stale-green races.
A changed base requires current integration proof, not necessarily a new product
decision. Preserve existing epic/rolling worktree ownership; small slices do not
authorize concurrent writers to overwrite one another or dismantle active epics.
Keep required CI, and stop integration on red main. Merge and deployment remain
separate decisions. Do not introduce a PR-less path under this procedure.

## Feature flags

```text
flag:
default:
owner:
blastRadius:
rollback:
removeBy:
```

- Production default: off.
- Dev/demo default: on only when useful.
- No flag: say why.
- No safe flag: abstraction, shadow mode, expand/contract, or worktree.
- A flag does not waive package ownership, security review or the abstraction
  gate; disabled code can still introduce forbidden dependencies and authority.

See [rollout restrictions](boring-loop.md#rollout-and-precedence) before treating
any automatic-eligible change as authorized for automatic merge.
