# Trunk, Flags, And Review Budget

Use trunk-based work by default, but keep remote `main` protected.

Golden rule: the `boring-ui-v2` checkout stays on local `main` as Julien's live
review bench. Keep the three Docker review surfaces running/reloadable and easy
to inspect: `full-app`, `workspace-playground`, and `agent-playground`. Agents
should keep local main green/reloadable; if they cannot, they must stop, repair,
or escalate to a short-lived isolated branch/worktree.

| Case | Default |
| --- | --- |
| plan-only work | edit on local `main`; no branch or worktree |
| small single-lane code | local trunk plus feature flag, then tiny PR |
| not flaggable | branch-by-abstraction or keystone interface last |
| still risky | short-lived worktree/branch |
| transversal | plan first, stacked PRs, owner gate |

Review budget: decompose plans and PRs so each reviewable slice is about 1,500
added production-code lines max. Exclude tests, docs, generated output, and
snapshots from the count. If a slice must exceed the budget, record why and get
explicit owner approval before implementation or review.

Feature flags are the isolation boundary for non-trivial runtime behavior:

```text
flag:
default:
owner:
blastRadius:
rollback:
removeBy:
```

Default flags off in production and on only in dev/demo when useful. If no flag
is needed, say why. If no safe flag exists, use abstraction, shadow mode,
expand/contract migration, or a short-lived worktree.
