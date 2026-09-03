# Naming convention

Every durable or owner-facing item leads with the feature name in square
brackets, then what it is. IDs and codes come after, never first — the owner
must understand at a glance what a title is about.

**Feature name**: 2–4 words, Title Case, chosen once when the epic is created
from the owner's request (e.g. `Farewell API`, `Inbox Naming`, `Sandbox
Recovery`). Its kebab-case slug is the epic key (`epic:farewell-api`) and the
branch name (`epic/farewell-api`). Never rename a feature mid-epic.

| Item | Pattern | Example |
| --- | --- | --- |
| GitHub issue title | `[Feature Name] <what the owner wants>` | `[Farewell API] Add a farewell endpoint` |
| Epic Bead | `[Feature Name] Epic` | `[Farewell API] Epic` |
| Child Bead | `[Feature Name] <verb phrase>` | `[Farewell API] Add farewell export and test` |
| Inbox entry (`ask_user` title) | `[Feature Name] Plan approval` / `Merge approval` / `Blocked: <one line>` / `Question: <one line>` | `[Farewell API] Merge approval` |
| PR title | `[Feature Name] <what changed>` | `[Farewell API] Add farewell export, test, docs` |
| Commit subject | `[Feature Name] <imperative summary> (br-<id>)` | `[Farewell API] Add farewell export (br-42)` |
| Bead handoff comment | `[Feature Name] handoff · <bead id> · <short sha>` | `[Farewell API] handoff · br-42 · a1b2c3d` |
| Bead recovery comment | `[Feature Name] recovered stale claim from <session>` | `[Farewell API] recovered stale claim from sess-9f2` |
| Session title | `[Feature Name] Orchestrator` / `Worker` / `Review @ <short sha>` | `[Farewell API] Review @ a1b2c3d` |
| Show-me plan doc (Gate 1) | `docs/issues/<issue>/show-me-plan.md` | docs/issues/1508/show-me-plan.md |
| Show-me PR doc (Gate 2) | `docs/issues/<issue>/show-me-<short sha>.md` | docs/issues/1508/show-me-a1b2c3d.md |
| Show-me Gate 1 artifact title | `[Feature Name] Plan, visually` | `[Farewell API] Plan, visually` |
| Show-me Gate 2 artifact title | `[Feature Name] What changed, visually` | `[Farewell API] What changed, visually` |

**Inbox `context` field**: the first line is one plain sentence saying what
this is about, with no ids in it. IDs (Bead id, PR number, SHA, URLs) come
after that line, never in it and never first.

```text
title:   [Farewell API] Merge approval
context: The farewell export is ready to merge.
         PR #128 · head a1b2c3d · target main
         Proof: 6 tests green, thermo clean.
         ...
```

Rules of thumb:

- The feature name is chosen once, at epic creation, and never abbreviated to
  an id, ticket number, or internal code in owner-facing text.
- Every item above names the feature before it names anything else. A title
  like `br-42: fix farewell bug` is wrong order; `[Farewell API] Fix farewell
  bug (br-42)` is right.
- Ids still exist and still matter for correlation — they just come after the
  name, not instead of it.
