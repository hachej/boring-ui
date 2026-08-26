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

## Status

Owner analysis, converged through nine internal adversarial review rounds
("hardening", v2 of the doc). Analysis, not a ratified decision — the plugin
system's shipped spec remains `packages/workspace/docs/PLUGIN_SYSTEM.md`.
