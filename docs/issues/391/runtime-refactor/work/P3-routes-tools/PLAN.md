# P3-routes-tools — Plan

> Phase: Phase 3 — Move server routes and tools (bash track) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [00-global-isa.md](../../architecture/00-global-isa.md) — seams to reuse (`disableDefaultFileTools`, `buildHarnessAgentTools`, `buildFilesystemAgentTools`, `buildUploadAgentTools`, readiness tags); zero agent→bash value imports.
- [02-boring-bash-environment.md](../../architecture/02-boring-bash-environment.md) — layered exports (`/server`, `/agent`); "Tools to move or consciously assign"; one-namespace / source-of-truth rules.
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) — Route-family scope: file/git routes are workspace/environment-scoped, deliberately outside the locked `/api/v1/agents/:agentId/...` family, so they keep their existing paths.

## Design context
Phase 3 moves the file/tree/search/fs-events/stat/dir/git routes into `boring-bash/server` and the filesystem/`bash`/`execute_isolated_code`/upload tools into `boring-bash/agent`. This is a **code move under behavior-freeze**: tool names, schemas, prompt snippets, error codes, readiness tags, the `(filesystem, path)` addressing, `assertNotFilesystemPathSpoof`, and readonly `rejectMutation` from #416 are preserved verbatim. Tools are contributed via `createBashAgentFeature()` — which returns a plain boring-bash-local bundle `{ tools, readinessRequirements }` (NOT a core `AgentFeature`; there is no `features` config member) that host composition **spreads into `createAgent()`'s `tools`**. Routes are mounted by host composition (`registerBashRoutes`) next to the agent routes; `packages/agent` never constructs the bundle nor mounts bash routes. This is the second composition cutover (P2 = runtime-mode, P3 = routes/tools) — API-breaking for in-repo composers, migrated per-consumer, external wire paths byte-identical.

## Deliverables
- move file/tree/search/fs-events/stat/dir routes to `boring-bash/server` — preserving the `(filesystem, path)` addressing **[landed for routes/tools wiring via #429/#454: `filesystem` param, spoof guard, readonly enforcement — this phase moves the code, not the behavior]**;
- move filesystem tools to `boring-bash/agent`; move or explicitly assign `bash`, `execute_isolated_code`, and upload tools;
- preserve readiness tags and `disableDefaultFileTools`;
- replace hardwired registration with `createBashAgentFeature()` — **defined once in Phase 3** — returning a plain boring-bash-local bundle `{ tools, readinessRequirements }` (not a core `AgentFeature` contract) that host composition **spreads into the `createAgent()` config** (`tools: [...bashBundle.tools]`, readiness gates from the bundle). There is no `features` config member.
- E1 (which depends on P2 **and** P3) may later re-implement the bundle's **internals** over environment attachments **without changing its public `{ tools, readinessRequirements }` signature**.

## Exit criteria
- workspace playground still opens file tree/editor; read/write/edit/find/grep/ls/bash work when boring-bash enabled;
- pure mode still has none of those routes/tools;
- company_context no-leak conformance still green.
