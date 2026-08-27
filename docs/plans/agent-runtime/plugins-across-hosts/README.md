# Plugins across hosts

This area covers how a plugin contributes agent behavior consistently across
every host surface (workspace UI, CLI, Slack, and future channels) instead of
each surface reimplementing its own integration.

The model in one breath: there are **two plugin kinds** (workspace plugins
and agent plugins) contributing on **two planes** (the UI plane and the agent
plane), with tool authority tracked in explicit ledgers, plugin state scoped
to named levels rather than ambient globals, and rules for what happens when
several hosts run the same plugin at once. A plugin marketplace is
explicitly deferred. The full detail — including the workspace-plugin vs
agent-plugin split and the multi-host rules — lives in the companion doc.

## Files

- `plugin-contribution-model.md` — the plugin contribution model, companion
  to [the gateway plan](../gateway/plan.md).

## Status — analysis with known caveats; read before quoting

Owner analysis, converged through nine internal adversarial review rounds
("hardening", v2 of the doc). **Analysis, not a ratified decision.** The
2026-08-26 area review found later rulings that supersede parts of it:

- **Marketplace architecture crosses D28's amendment gate.** The model's
  workspace-scoped plugin installation with a mutable registry is exactly
  what D28 rejects (deploy/restart composition; per-Workspace fleets are a
  named re-evaluation trigger). Building it needs an explicit D28 amendment,
  not just "deferred".
- **Remote-host generations are pre-gate.** Host pools / immutable
  generations / drain rules belong to the #905 remote tier, which D29
  reserves and DIRECTION gates behind three rulings — standing rules only
  after that.
- **Hostname authority superseded by D30**: hostname selects presentation
  only, never Workspace routing or agent selection.
- **UI territory superseded by the ratified shell ruling**: nav is domains
  and the plugin rail is tools (RECONCILIATION §8); the model's
  app-left/workbench split by plugin kind — and its "active agent" notion,
  which multi-seat Threads do not expose — needs a shell-specific
  reconciliation before use.
- **The `plugins-workspace/`/`plugins-agent/` folder move** conflicts with
  the later ratified move policy (moves only when pulled by security, Rule
  of Three, or a product slice).
- **Its automation-dispatcher inventory is obsolete** (the resolver's method
  is `runWithWorkspaceAgent`, not `send()`).

On canonical plugin IDs the picture is inverted: **shipped code follows this
model** (optional `boring.id` with package-name fallback,
`canonicalPluginId.ts`), while the normative spec
`packages/workspace/docs/PLUGIN_SYSTEM.md:169` still says `boring.id` is
rejected — the spec is the stale document there and needs its own small
repair PR.
