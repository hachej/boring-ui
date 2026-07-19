---
name: ui
description: Review named UI scenarios with deterministic browser gates and a structured visual critic, while indexing specialist UI providers.
disable-model-invocation: true
---

# UI Review

## Commands

Only the named local `command-palette` scenario is accepted; reject URLs and
other scenarios.

```text
pnpm --filter workspace-playground ui:review -- review command-palette --critic=fixture
pnpm --filter workspace-playground ui:review -- improve command-palette --critic=fixture [--baseline-dir <prior-run>]
```

`review` is read-only. It captures desktop/mobile states, applies versioned hard
gates, validates the critic contract, and writes CSP-safe HTML/Markdown plus
non-sensitive calibration metadata. A baseline pairs only the six known
checkpoints and renders runner-computed before/after deltas; unmatched Bombadil
states are omitted from pair mode.

`improve` is explicit-only. After the completed review it creates exactly one
strict `execution-packet.json`: at most three fixes with confidence `>= 0.8`
(sorted by confidence, then critic order), at most two rounds, explicit stops,
and the exact owner spot-check playbook. The packet grants no edit or merge
authority. Validate it with
`pnpm --filter workspace-playground ui:improve:validate -- <run-directory>`,
then invoke `/skill:exec <run>/execution-packet.json` exactly once; this skill never applies
fixes and never invokes `improve` recursively. `/exec` owns the rounds and final
Inbox Human Intention handoff. Live vision calls remain opt-in and
credential-free CI remains review-only.

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
