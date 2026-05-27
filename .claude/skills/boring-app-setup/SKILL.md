---
name: boring-app-setup
description: Claude wrapper for the canonical boring-ui app-shipping skill. Read the project-local `.agents/skills/boring-app-setup/SKILL.md` and follow it when the user wants a new boring-ui app, a branded child app, or an idea shipped to production.
---

# Boring App Setup

Canonical source of truth lives here:

- `.agents/skills/boring-app-setup/SKILL.md`

Before doing anything else, read that file in full and follow it.

Why this wrapper exists:

- some agents read `.claude/skills`
- some agents read `.agents/skills`
- the canonical router and workflow live in `.agents/skills` so project-local agents share one source of truth

If the user wants the routing-first version, also read:

- `.agents/skills/boring-app-setup/references/README.md`

If the user also needs plugin work, then read:

- `.agents/skills/boring-plugin-build/SKILL.md`
- `packages/pi/skills/boring-plugin-authoring/SKILL.md`
