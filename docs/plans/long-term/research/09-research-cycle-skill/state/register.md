# Findings register

Built mechanically from report frontmatter. One row per finding, newest run last.

| id | kind | statement | conf | sev | subsystem | status | filed |
|---|---|---|---|---|---|---|---|
| _(seeded from the 2026-W33 deep cycle — see docs/research/runs/2026-W33/)_ | | | | | | | |

## Invariants

- No row without evidence.
- `reported` rows may not be cited as justification for work.
- `disproven` rows are kept, never deleted — they are how the register stays honest.
- A row unchanged for 8 cycles is closed as `wontfix` with a reason, or promoted to an issue.
