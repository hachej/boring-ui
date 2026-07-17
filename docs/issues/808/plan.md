---
github: https://github.com/hachej/boring-ui/issues/808
issue: 808
state: deferred
phase: plan
track: owner
flag: not-needed
updated: 2026-07-17
---

# #808 Sandbox provider extraction and S3/FUSE mounts

## Canonical entry

This issue owns Sandbox-provider extraction and native S3/FUSE mount planning. The physical plan move from #391 is complete; this
file is the canonical entry and index. These plans are outside #391's static
P0→N1 critical path and remain subject to [Decision 25](../../DECISIONS.md#25-static-multi-agent-composition-after-agenthost-removal).

## Canonical documents

- [`P2-sandbox-providers`](runtime-refactor/work/P2-sandbox-providers)
- [`X1-s3-fuse-mounts`](runtime-refactor/work/X1-s3-fuse-mounts)

Historical #391 architecture and the static multi-agent plan remain at
[`../391/plan.md`](../391/plan.md) and are context, not this issue's work-order
authority.
