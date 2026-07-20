---
name: skill-management
description: Explicit router for creating a skill or reducing an existing skill's active context size.
disable-model-invocation: true
---

# Skill Management

Route exactly one explicit subskill; load only its procedure.

| Subskill | Procedure |
| --- | --- |
| `reduce-size <skill-path>` | Read `docs/kanzen/procedures/skill-size-reduction.md`, then preserve behavior while shrinking active context. |
| `create <name-or-goal>` | Read `docs/kanzen/procedures/skill-authoring.md`, including its pinned Matt Pocock reference, then create and validate the skill. |

Invocation:

```text
/skill:skill-management reduce-size <skill-path>
/skill:skill-management create <name-or-goal>
```

For missing or unknown branches, return this usage and stop. Do not load both
procedures unless the user explicitly requests both operations.
