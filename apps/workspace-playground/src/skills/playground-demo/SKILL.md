---
name: local-test
description: Local test skill seeded into the workspace playground. Use it to verify the Skills overlay, workspace-local skill discovery, and UI-bridge open-file behavior.
---

# Local Test Skill

This skill is intentionally tiny and workspace-local. It is copied into:

`.agents/skills/playground-demo/SKILL.md`

when the workspace playground starts, then loaded through `pi.additionalSkillPaths`.

Use it to verify:

- the Skills overlay shows workspace-local skills;
- clicking a skill opens its `SKILL.md` through the UI bridge;
- reloading skills picks up the seeded workspace copy.
