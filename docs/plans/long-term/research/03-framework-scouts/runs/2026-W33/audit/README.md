# 2026-08-14 four-census audit — sources for ARCHITECTURE-PLAN.md

Four parallel Sonnet censuses against `main`:
1. workspace-contents — classification of all 459 files / 93k LOC of packages/workspace
2. agent-standalone — reverse edges (zero value imports), shared leaf-cleanliness,
   durable-write map, standalone bin inventory, MCP ownership
3. env-exec — 15-site spawn/env table (zero filtering), exec projection gap
   (three named pieces, RemoteWorkerExec schema reusable)
4. security — four AgentScopeVerifier impls (WeakMap identity), CLI header-based
   scope minting, approval states confirmed dead

Full agent outputs are in the session task transcripts; the plan carries every
load-bearing file:line inline so it stands alone.
