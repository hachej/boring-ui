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

This issue owns Sandbox-provider extraction and native S3/FUSE mount planning. The physical plan move from #391 is complete; this file is the canonical entry and index. Decision 26 places provider extraction in Step 3 only after demonstrated package pressure; S3/FUSE stays later until a named mount consumer exists. Neither gates typed workspaces or same-workspace multi-agent composition. See [`../391/ROADMAP-ALIGNMENT.md`](../391/ROADMAP-ALIGNMENT.md).

## Canonical documents

- [`P2-sandbox-providers`](runtime-refactor/work/P2-sandbox-providers)
- [`X1-s3-fuse-mounts`](runtime-refactor/work/X1-s3-fuse-mounts)

Historical #391 architecture and the active phased product plan remain at
[`../391/plan.md`](../391/plan.md). The latter controls shared sequencing; this
issue regains dispatch authority only after its own Decision 26 recut.
