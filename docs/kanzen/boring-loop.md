# Boring Loop v2

The loop is intentionally small:

```text
feedback -> triage -> plan -> exec
```

Use `ask-boring` when the next step is unclear.

## One screen

| Step | Output | Next |
| --- | --- | --- |
| `feedback` | GitHub issue with safe context | `triage` |
| `triage` | category, state, first blocker, next action | `plan`, `exec`, `ready-for-human`, or `needs-info` |
| `plan` | spec/plan, proof path, slices only if needed | `exec` or `ready-for-human` |
| `exec` | reviewed, proven PR plus runnable validation handoff | owner review |

## Labels

Category:

- `bug`
- `enhancement`

State:

- `needs-triage` — not evaluated yet
- `needs-info` — waiting on specific answers
- `ready-for-agent` — agent can plan or execute safely
- `ready-for-human` — human judgment/access/approval required
- `wontfix` — rejected, duplicate, out of scope, or already solved

Keep labels boring. Do not add taxonomy labels or old Kanzen routing labels.

## First blocker

Use this in comments/handoff cards, not labels:

- `clarity`
- `risk`
- `plan`
- `implementation`
- `proof`
- `review`
- `merge`
- `none`

Rule: stop at the first blocker that prevents safe progress.

## Proof bar

Implementation is not done until proof is recorded with at least one of:

- exact command
- screenshot/demo
- manual steps
- explicit waiver with residual risk

Do not write “tested” without evidence.

## Planning bar

A useful plan names:

- problem and solution
- decisions
- flag/abstraction/rollback path when relevant
- test seams
- acceptance
- proof path
- slices and blockers only when needed

Prefer one implementable slice. Split only when the work would exceed review budget or needs parallel/stacked work.

For wide mechanical refactors, use:

```text
expand -> migrate batches -> contract
```

## Execution bar

`exec` loops until:

- PR exists, unless user explicitly asked for local-only work
- proof is current
- required review tiers are clean or findings have dispositions
- every code change has a thermo review; docs/config-only work is exempt
- user-facing work has a running demo and exact test playbook
- next action is owner validation

If the next action needs human review or a decision, use `ask_user` when available so the request appears in the Boring UI inbox. If not available, use a GitHub/PR comment.

## Human safety defaults

Default to `ready-for-human` for:

- auth, billing, permissions, secrets
- migrations or public API changes
- releases
- deletion-heavy work
- broad refactors
- unclear rollback
- manual-only or waived proof on risky work

## Legacy note

Old Kanzen used `state:*`, `phase:*`, `track:*`, gates, and `/loop-*` commands. Those are archived concepts. Boring v2 keeps the useful safety ideas but uses the simpler label/state model above.
