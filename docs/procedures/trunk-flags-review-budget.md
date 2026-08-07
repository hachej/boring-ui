# Trunk, Flags, And Review Budget

- Default: trunk-based work.
- Protect: remote `main`.
- Live bench: local `main`.
- Keep running/reloadable: `full-app`, `workspace-playground`,
  `agent-playground`.
- If local main is not green: stop, repair, or use short-lived branch/worktree.

| Case | Default |
| --- | --- |
| plan-only work | edit on local `main`; no branch or worktree |
| small single-lane code | local trunk plus feature flag, then tiny PR |
| not flaggable | branch-by-abstraction or keystone interface last |
| still risky | short-lived worktree/branch |
| transversal | plan first, stacked PRs, owner gate |

- Review budget: about 1,500 added production-code lines per slice.
- Exclude: tests, docs, generated output, snapshots.
- Larger slice: record why; get owner approval before implementation/review.

Flag record:

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
