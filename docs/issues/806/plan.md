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

This issue owns managed MCP ingress, shareable artifacts, MCP agent surfaces, and environment projection. The physical plan move from #391 is complete; this file is the canonical entry and index. Decision 26 makes authenticated MCP Step 1B immediately after #391's Step 1A Seneca proof. M1/M2 must then be recut to resolve the persisted typed workspace and sole static agent; obsolete AgentHost/deployed-default/registry dependencies are non-dispatchable. AR1/E2 remain Step 3/later inputs. See [`../391/ROADMAP-ALIGNMENT.md`](../391/ROADMAP-ALIGNMENT.md).

## Canonical documents

- [`M1-mcp-managed-agent`](runtime-refactor/work/M1-mcp-managed-agent)
- [`AR1-shareable-artifacts`](runtime-refactor/work/AR1-shareable-artifacts)
- [`M2-mcp-agent-surface`](runtime-refactor/work/M2-mcp-agent-surface)
- [`E2-mcp-projection`](runtime-refactor/work/E2-mcp-projection)

Historical #391 architecture and the active phased product plan remain at
[`../391/plan.md`](../391/plan.md). The latter controls shared sequencing; this
issue regains dispatch authority only after its own Decision 26 recut.
