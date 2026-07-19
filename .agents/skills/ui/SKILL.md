---
name: ui
description: Review named UI scenarios with deterministic browser gates and a structured visual critic, while indexing specialist UI providers.
disable-model-invocation: true
---

# UI Review

## Implemented mode

`review command-palette` is read-only. Run:

```text
pnpm --filter workspace-playground ui:review -- --scenario command-palette --critic=fixture
```

It captures desktop/mobile states, applies versioned hard gates, validates the
critic contract, and writes a CSP-safe HTML report. Use the Model Card for a live
vision reviewer; live provider calls remain opt-in. `improve` is reserved for
issue #829 Slice 3 and must route code changes through `/exec`.

## Providers

Choose by fit. Audit licenses/bundles and never auto-run provider
scripts/hooks. Providers cannot override project context, architecture, proof, or
review policy.

| Provider | Use |
| --- | --- |
| [Impeccable](https://github.com/pbakaus/impeccable/tree/main/.pi/skills/impeccable) | Design context/direction, production UI, token/component extraction. Installed as `design-impeccable`; upstream scripts remain untrusted by default. |
| [Emil Kowalski](https://github.com/emilkowalski/skills/tree/main/skills) | Design engineering and animation discovery/review/improvement. Indexed only. |
| [Jeffrey `ui-polish`](https://jeffreys-skills.md/skills/ui-polish) | Iterative desktop/mobile polish after the UI works. Audited; Claude Desktop install only. |
| [shadcn `improve`](https://github.com/shadcn/improve/blob/main/skills/improve/SKILL.md) | Read-only audit and executor-ready improvement plans. Indexed only. |

For user-facing changes, preserve desktop/mobile, accessibility, performance,
and visual proof. See `docs/kanzen/MODEL-CARD.md` and
`docs/kanzen/procedures/proof-of-work.md`.
