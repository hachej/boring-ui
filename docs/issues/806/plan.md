---
github: https://github.com/hachej/boring-ui/issues/806
issue: 806
state: deferred
phase: plan
track: owner
flag: not-needed
updated: 2026-07-17
---

# #806 MCP ingress and shareable artifacts

## Canonical entry

This issue owns Managed MCP ingress, shareable artifacts, MCP agent surfaces, and environment projection. The physical plan move from #391 is complete; this
file is the canonical entry and index. These plans are outside #391's static
P0→N1 critical path and remain subject to [Decision 25](../../DECISIONS.md#25-static-multi-agent-composition-after-agenthost-removal).

## Canonical documents

- [`M1-mcp-managed-agent`](runtime-refactor/work/M1-mcp-managed-agent)
- [`AR1-shareable-artifacts`](runtime-refactor/work/AR1-shareable-artifacts)
- [`M2-mcp-agent-surface`](runtime-refactor/work/M2-mcp-agent-surface)
- [`E2-mcp-projection`](runtime-refactor/work/E2-mcp-projection)

Historical #391 architecture and the static multi-agent plan remain at
[`../391/plan.md`](../391/plan.md) and are context, not this issue's work-order
authority.
