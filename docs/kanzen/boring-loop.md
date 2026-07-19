# Boring Loop v2

```text
feedback → triage → plan → exec
```

Use `/skill:ask-boring` when routing is unclear.

| Step | Output | Next |
| --- | --- | --- |
| `feedback` | canonical bug issue or feature-backlog item | `triage` for bugs; stop for backlog |
| `triage` | category, state, first blocker, next action | `plan`, `exec`, or human |
| `plan` | TODO, canonical plan, or Beads graph with proof path | `exec` or human |
| `exec` | reviewed/proven PR plus runnable validation handoff | owner review |

## State model

- Category: `bug` or `enhancement` (one when possible).
- State: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, or
  `wontfix` (exactly one).
- First blocker: `clarity`, `risk`, `plan`, `implementation`, `proof`, `review`,
  `merge`, or `none`.

Put detail in comments, not labels. Do not revive `state:*`, `phase:*`, `track:*`,
or gate taxonomies.

## Quality bars

- **Feedback:** one deduplicated, redacted canonical item.
- **Triage:** verified when cheap; stop at the first blocker.
- **Plan:** problem/solution, decisions, rollback/flag when relevant, test seams,
  acceptance, proof, and only necessary slices. Wide refactors use
  `expand → migrate batches → contract`.
- **Exec:** current proof, required review dispositions, thermo for code, and a
  human-ready artifact/test playbook. Follow `procedures/proof-of-work.md` and
  `procedures/owner-review-card.md`.

Default to `ready-for-human` for auth, billing, permissions, secrets, migrations,
public APIs, releases, deletion-heavy/broad work, unclear rollback, or risky
proof waivers. Use `ask_user` for decisions; GitHub comments are the fallback.
