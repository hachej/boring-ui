---
name: ui
description: Open index of UI/design optimization providers. Routing policy is intentionally undecided.
---

# UI Provider Index

This is a **provider index**, not a prescribed workflow. Keep routing open until
we have enough Boring UI implementation evidence to decide which providers
compose well and where their boundaries belong.

Do not execute provider scripts/hooks automatically. Audit a provider bundle and
its license before copying it into project-owned skill paths or upgrading it.
Kanzen proof/review policy remains authoritative.

## Providers

| Provider | Best at | Intended role | Status |
| --- | --- | --- | --- |
| [pbakaus / Impeccable](https://github.com/pbakaus/impeccable/tree/main/.pi/skills/impeccable) | Design context, visual direction, production UI implementation, token/component extraction | Candidate primary implementation skill | Runtime `design-impeccable` is installed; upstream scripts are not implicitly trusted or run |
| [Emil Kowalski skills](https://github.com/emilkowalski/skills/tree/main/skills) | Design engineering, Apple-style design, animation opportunity discovery, animation review/improvement | Candidate animation and interaction specialist | Indexed only |
| [Jeffrey `ui-polish`](https://jeffreys-skills.md/skills/ui-polish) | Iterative desktop/mobile polish of an already functional UI | Candidate post-implementation polish pass | Audited and installed for Claude Desktop; not vendored into this repository |
| [shadcn `improve`](https://github.com/shadcn/improve/blob/main/skills/improve/SKILL.md) | Read-only codebase audit and self-contained implementation handoff plans | Candidate UI improvement advisor/planner | Indexed only; it does not implement code |

## Current constraints

- Use a provider only when its stated use case matches the work; do not turn a
  polish skill into a greenfield implementation method.
- Keep desktop, mobile, accessibility, and performance proof explicit for
  user-facing changes.
- A provider recommendation never overrides Boring architecture invariants,
  Kanzen review/proof requirements, or project design context.
- Revisit this file after real UI work to decide whether a stable router,
  provider pinning, or project-local audited copies are warranted.
