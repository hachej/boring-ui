---
name: ui
description: Review the named UI scenario or emit one bounded improvement packet.
disable-model-invocation: true
---

# UI

Read `docs/kanzen/procedures/visual-review.md` before acting; it owns commands,
hard-gate authority, critic bounds, packet rules, providers, and owner handoff.
Also follow `docs/kanzen/MODEL-CARD.md`.

Accept only explicit `review command-palette` or `improve command-palette`.
Reject URLs and other scenarios.

- `review` is read-only and leaves a bounded desktop/mobile report.
- `improve` creates one checkout-bound execution packet; validate it, then invoke
  `/skill:exec <run>/execution-packet.json` exactly once.

Never apply packet fixes here, recurse into `improve`, auto-run provider hooks,
or treat advisory critic scores as hard gates.
