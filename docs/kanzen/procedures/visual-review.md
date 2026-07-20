# Visual Review

This is the operating policy for UI review, improvement packets, and owner visual
handoff. Evidence follows [`proof-of-work.md`](proof-of-work.md); owner decisions
follow [`owner-review-card.md`](owner-review-card.md).

## Registered review-spec loop

The private `tools/ui-review` engine accepts only exact names from its trusted
repository registry. A review spec owns its repository target, local
route/readiness, isolated fixture, viewports, known checkpoints, optional stable
pixel baselines, hard gates, optional Bombadil exploration, critic context, and
owner checks. Behavior specs may target any current or future `apps/*`
playground; component specs use private `tools/ui-review/fixtures/*` hosts so
review-only code never enters app source. Reject URLs, paths, config/module
names, commands, and unknown ids.

```text
pnpm --filter @hachej/boring-ui-review-tools ui:review -- review <registered-spec> --critic=fixture
pnpm --filter @hachej/boring-ui-review-tools ui:review -- improve <registered-spec> --critic=fixture [--baseline-dir <prior-run>]
pnpm --filter @hachej/boring-ui-review-tools ui:improve:validate -- <run-directory>
```

`workspace-command-palette` is the first proof spec, not the framework identity.
`workspace-component-baselines` owns the six deterministic component fixtures
that replaced the retired Storybook suite. Its narrow, rationale-bearing pixel
budgets are hard gates. Update snapshots only through
`ui:review:components:update` and inspect every changed image.

Deterministic browser, accessibility, layout, focus, touch, request, pixel-baseline, and
Bombadil property gates are authoritative. Critic scores and suggestions are
advisory. Live vision is explicit credential-gated opt-in and cannot run before
all hard gates pass; credential-free CI uses the fixture critic in `review`
mode only.

During frontend code review, reviewer agents should select the registered spec
covering the changed component or behavior and run `review`. If no spec covers
the change, add or extend a tool-owned component fixture or a real-app behavior
spec; never add review infrastructure to product/app source.

`review` is read-only. It captures the selected spec's known state matrix, runs
its optional bounded Bombadil exploration and replay, validates artifact
ownership, and writes CSP-safe HTML/Markdown plus non-sensitive calibration
metadata. With a local baseline, pair only the spec's known checkpoints and
render runner-computed signed deltas; unmatched exploration states remain
candidate-only evidence.

The Model Card selects a vision-capable L1 critic; Gemini latest Pro is the
default and Grok latest is only a second opinion for low confidence or a
material claimed regression. Record the resolved model id. The critic receives
only enumerated evidence, runs read-only/no-tools, and may not inspect or edit
the repository. Fable is off for this UI loop.

## Improvement packet

`improve` completes the same review, then creates exactly one
`execution-packet.json`. The packet may select at most three fixes per round,
with critic confidence `>= 0.8`, ordered by confidence then critic order. It
allows at most two rounds, carries explicit stop conditions and the exact owner
spot checks, and grants no edit or merge authority.

Validate the packet against the current checkout and worktree, then invoke
`/skill:exec <run>/execution-packet.json` exactly once. `/ui` never edits from a
packet or invokes `improve` recursively.

`/exec` alone owns implementation and review rounds and may apply only the
packet's three confidence-qualified fixes per round. The orchestrator retains
model and parallelism judgment within those bounds. After changes, rerun the
packet's registered spec with
`pnpm --filter @hachej/boring-ui-review-tools ui:review -- review <registered-spec>
--critic=<same-critic> --baseline-dir <prior-run>`; never run `improve`. Stop when hard
gates are green and no material high-confidence fix remains, the score/delta
stalls, remaining work is subjective or out of scope, two rounds complete, or
review budget is exhausted. Open `report.html` through `workspace.open.path`,
then finish with the packet's spot-check playbook and an Inbox/`ask_user` owner
handoff. Never merge without explicit approval.

## Provider index

Choose providers by fit. Audit licenses and bundles; never auto-run provider
scripts or hooks. Providers cannot override project context, architecture,
proof, or review policy.

| Provider | Use |
| --- | --- |
| [Impeccable](https://github.com/pbakaus/impeccable/tree/main/.pi/skills/impeccable) | Design direction, production UI, and token/component extraction. Installed as `design-impeccable`; upstream scripts remain untrusted by default. |
| [Emil Kowalski](https://github.com/emilkowalski/skills/tree/main/skills) | Design engineering and animation discovery/review. Indexed only. |
| [Jeffrey `ui-polish`](https://jeffreys-skills.md/skills/ui-polish) | Desktop/mobile polish after behavior works. Audited; Claude Desktop install only. |
| [shadcn `improve`](https://github.com/shadcn/improve/blob/main/skills/improve/SKILL.md) | Read-only audit and executor-ready improvement plans. Indexed only. |

For user-facing changes, preserve desktop/mobile behavior, accessibility,
performance, and visual proof. The owner card must include exact checks,
risk/rollback, and approve/request-changes choices. Never auto-approve mutable
source or create a second visual-review workflow.
