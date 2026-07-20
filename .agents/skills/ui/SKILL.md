---
name: ui
description: Review the named UI scenario or emit one bounded improvement packet.
disable-model-invocation: true
---

# UI

Read `docs/kanzen/procedures/visual-review.md` before acting; it owns commands,
hard-gate authority, critic bounds, packet rules, providers, and owner handoff.
Also follow `docs/kanzen/MODEL-CARD.md`.

Accept only explicit `review <registered-spec>` or
`improve <registered-spec>`. Resolve the exact name through the repository
registry; reject URLs, paths, configs, commands, and unknown names.

- `review` is read-only and reusable by reviewer agents for changed frontend
  components or behavior; it leaves a bounded spec-defined report.
- `improve` creates one checkout-bound execution packet; validate it, then invoke
  `/skill:exec <run>/execution-packet.json` exactly once.

Never apply packet fixes here, recurse into `improve`, auto-run provider hooks,
or treat advisory critic scores as hard gates.
