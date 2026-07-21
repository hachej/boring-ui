> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# TODO-06 — Multi-agent routing, sessions, search, hooks

## Purpose

Enable multiple agents inside one deployed app/workspace with isolated bindings, sessions, tools, readiness, and policy.

This TODO exists because a single full-app deployment must eventually host several agent roles at once: a coding agent with full boring-bash, a reviewer with readonly files/no shell, a concierge/support agent with no filesystem at all, Macro-specific agents in Macro child-app workspaces, and external harnesses that can create review/question hooks. The implementation must preserve the host-owned session-history rule from `AGENTS.md`: transcripts live under durable `BORING_AGENT_SESSION_ROOT`, not in the workspace or sandbox.

## Shared vocabulary for this TODO

- **AgentNode**: addressable runtime agent with its own id, features, tool/channel configuration, generic requirements/feature grants, optional boring-bash requirement, session namespace, and policy. Use this for specialist agents with different sandbox/tool/network/readiness needs.
- **AgentProfile**: reusable delegated behavior pack that normally runs inside the parent agent/environment unless a parent policy explicitly narrows or isolates it. Use this for cheap subtasks that should not silently widen access.
- **Default agent**: compatibility agent used by existing routes until multi-agent routes are adopted.
- **Principal/user**: human actor and approval/grant source. Never expose the human as a model-callable max-power agent.

## Beads / tasks

### BBA-060 — Introduce AgentRegistry data structure

**Phase:** 6 seed interface, completed before Phase 7 route/session migration.

**Depends on:** BBA-012.

**Why:** Child apps and workspaces need to name available agents before route/session migration is complete. This registry must stay generic so pure agents do not depend on boring-bash concepts.

**Scope:**

- Add an `AgentRegistry` data structure for the workspace/default resolved agent set; child-app seeding from BBA-050 layers on top when available.
- Support the AgentNode vs AgentProfile distinction:
  - AgentNode is addressable and may have independent features/policy/session namespace;
  - AgentProfile is reusable delegation configuration and cannot widen the parent environment by default.
- Record agent id, package/source, label/description, features, generic requirements/featureGrants (no hardcoded bash concepts), tool/channel config, default session behavior, and optional attribution metadata.
- Provide a default-agent compatibility entry for existing single-agent routes.
- Validate ids early: safe path/URL segment, no duplicate ids, no reserved names, no collision with tool names where agent delegation becomes model-visible.
- Phase 6 can seed the registry from child-app defaults; Phase 7 implements route/session/search behavior against it.

**Unit tests:**

- Registry validates duplicate ids, unsafe ids, reserved ids, and tool-name collisions.
- Generic/default agent set resolves without child-app platform dependency.
- Child-app default agent set resolves when BBA-050 context is available.
- AgentProfile cannot accidentally widen environment or inherit parent tools/files/shell unless explicitly configured.
- Default-agent compatibility entry exists and is deterministic.

**E2E/smoke logging:**

- Registry smoke logs workspace id, childAppId/workspaceKind when present, registered agent ids, default agent id, rejected ids, and source of each agent definition.

**Acceptance:** Hosts can resolve a workspace agent set without enabling boring-bash and without loading child-app-specific code unless child-app context is supplied.

### BBA-061 — Add agentId route/request scoping

**Phase:** 7.

**Depends on:** BBA-060, BBA-006.

**Why:** Multiple agents need addressable routes without breaking existing single-agent callers. The route shape must be chosen in BBA-006 before implementation.

**Scope:**

- Add `/api/v1/agents/:agentId/...` or the BBA-006-approved equivalent scoped request mechanism.
- Keep backwards compatibility for default-agent routes by resolving missing `agentId` to the default agent with explicit diagnostics.
- Resolve agent before tool catalog/session/provisioning/readiness so the request never accidentally uses another agent's binding.
- Ensure route params and headers cannot disagree silently; reject conflicts with stable error code.
- Preserve existing UI bridge/RPC route ownership; agent scoping should not create a parallel UI bridge route family.

**Unit tests:**

- Unknown agent returns stable error with no fallback to another agent.
- Default-agent route compatibility works for existing endpoints.
- Conflicting path/header agent ids reject.
- Two agents expose different route/catalog behavior as configured.
- Pure agent route has no file/bash routes even when a coding agent in the same workspace has boring-bash.

**E2E/smoke logging:**

- Route smoke logs workspace id, requested agent id, resolved agent id, route pattern, default-agent fallback yes/no, and stable error code for unknown/conflicting agents.

**Acceptance:** Every agent-scoped request resolves exactly one agent before touching sessions/tools/runtime state.

### BBA-062 — Thread agentId through bindings and sessionNamespace

**Phase:** 7.

**Depends on:** BBA-061, BBA-006.

**Why:** The dangerous failure mode is transcript/binding cross-contamination: two agents in one workspace with the same `sessionId` must not share harness bindings, tool catalogs, readiness, or transcript files.

**Scope:**

- Add `agentId` to the real per-workspace runtime binding/scope caches used by agent routes and core workspace server composition.
- Add `agentId` to `sessionNamespace` and session root derivation.
- Preserve host durable `BORING_AGENT_SESSION_ROOT` for transcripts; do not store session history in workspace root, sandbox `/workspace`, container home, or repo checkout.
- Keep legacy fields such as root/template/pi/session namespace isolated where they currently exist.
- Normalize/sanitize agent id before using it in namespace/path segments.
- Ensure same `sessionId` across two agents does not collide.
- Ensure a provisioning/readiness failure for one agent does not poison another agent's binding cache.

**Unit tests:**

- Same workspace + same `sessionId` + two agents produce distinct transcript directories/records.
- Binding cache key includes agent id or equivalent scope component.
- Session roots stay under host session root and never under workspace/container home.
- Unsafe agent ids cannot escape or collide in session namespace.
- Failed binding for one agent does not replace healthy binding for another.

**E2E/smoke logging:**

- Session isolation smoke logs workspace id, agent id, session id, session namespace, session root, binding cache key hash, and transcript path root classification (`host-session-root`, never raw secrets or full private path contents).

**Acceptance:** Agent/session identity is `(workspaceId, agentId, sessionId)` everywhere user history or runtime binding state is addressed.

### BBA-063 — Per-agent tool catalogs and readiness

**Phase:** 7.

**Depends on:** BBA-062, BBA-043.

**Why:** Multi-agent value comes from different capabilities per role. A reviewer should not inherit a coding agent's raw bash, and a pure concierge should not be blocked by another agent's runtime dependency failure.

**Scope:**

- Tool catalog is per agent, assembled after agent resolution.
- Readiness gates are per agent/runtime requirement and preserve existing readiness tags.
- Reuse existing `mergeTools({ checkReadiness })`; do not create a parallel tool catalog system.
- Reviewer can have readonly/no exec while coding agent has bash.
- Concierge pure agent has no boring-bash.
- Plugin tool requirements are scoped to the target agent and cannot widen workspace/agent policy.
- Tool attribution includes agent id for audit/UI display.

**Unit tests:**

- Catalog differences by agent.
- Readiness failure for one agent does not block unrelated pure agent.
- Plugin tool requirements scoped correctly.
- Raw `bash` absent for reviewer/concierge when policy denies it.
- Existing default-agent tool catalog remains compatible.

**E2E/smoke logging:**

- Catalog/readiness smoke logs agent id, tool names, readiness tags, blocked/unblocked reason, requirement ids, policy source, and whether default-agent compatibility was used.

**Acceptance:** The model-visible tool set always matches the resolved agent policy, not the workspace's most powerful agent.

### BBA-064 — Session history index/search (#379)

**Phase:** 7.

**Depends on:** BBA-062.

**Why:** Session search is independent of boring-bash and must work for pure agents, multi-agent workspaces, and cross-project browsing without loading every workspace.

**Scope:**

- Add a session index/search API independent of boring-bash.
- Scope by workspaceId, agentId, sessionId.
- Index title/name/messages/content/operational events/deep-link metadata.
- Preserve Pi-native title/name parity.
- Redact sensitive tool outputs and external hook payloads before indexing.
- Handle session rename/title update, delete, compaction, and operational events.
- Do not assume file storage exists.

**Unit tests:**

- Search finds correct session for agent/workspace.
- Cross-agent and cross-workspace results do not leak.
- Redaction works for tool outputs and external hook content.
- Session rename/delete updates the index.
- No filesystem/boring-bash capability required.

**E2E/smoke logging:**

- Search smoke logs query id, workspace id, agent id, result count, redaction count, index update count, and latency. Logs must avoid raw secrets/tool payloads.

**Acceptance:** Users can find the right session history by workspace+agent without granting any file/bash access.

### BBA-065 — Deep-linkable sessions and session links (#243, #211)

**Phase:** 7.

**Depends on:** BBA-064.

**Why:** Proof-of-work comments, notifications, run history, and future operator surfaces need links to a specific agent/session history without clobbering the user's active work.

**Scope:**

- URL/session link model includes workspace and agent.
- Existing focused-session behavior preserved.
- Missing/deleted/inaccessible sessions show clear empty/error state with stable error code.
- Does not overwrite active session without user intent.
- Compatible with existing `?component=`/workspace route patterns and future multi-pane layout.
- Start with focused-session URL semantics; full pane-layout-in-URL can remain a later extension.

**Unit tests:**

- Link opens target agent/session.
- Invalid/deleted/inaccessible session fallback.
- Browser back/forward preserves expected focused session.
- Link to another agent in same workspace does not mutate current agent's active session unless user confirms.

**E2E/smoke logging:**

- Deep-link smoke logs URL, workspace id, agent id, session id, fallback reason, active/focused pane, and whether localStorage was updated.

**Acceptance:** Session links are shareable/bookmarkable and agent-scoped without surprising session switches.

### BBA-066 — External hook routing in multi-agent world (#380)

**Phase:** 7.

**Depends on:** BBA-015, BBA-062, BBA-064.

**Why:** External harnesses need to create review/question/approval hooks against the correct agent/session, and those hooks must be searchable/auditable after redaction.

**Scope:**

- Route external hooks to correct workspace/agent/session.
- Support no-session/new-session policy.
- Preserve auth/redaction/audit from BBA-015.
- Persist routed hooks into the correct session history and search index.
- Callback delivery must be idempotent or carry stable ids so retries do not duplicate user-visible hooks.

**Unit tests:**

- Hook to agent A not visible in agent B.
- Missing target stable error.
- Redacted hook searchable in session index.
- Duplicate/retried hook with same external id is idempotent or clearly versioned.
- Unauthorized hook cannot reveal whether another agent/session exists beyond allowed error semantics.

**E2E/smoke logging:**

- Hook smoke logs source harness id, target workspace/agent/session ids, redaction count, routed event id, external id/idempotency key, search index update id, and callback status.

**Acceptance:** External hooks are multi-agent-safe, redacted, auditable, and work without boring-bash.

### BBA-067 — Delegation depth and shared-sandbox write safeguards

**Phase:** 7.

**Depends on:** BBA-063, BBA-036.

**Why:** Delegation is powerful but can accidentally widen access or cause concurrent file edits. Flue and eve both show the need to distinguish cheap shared-env profiles from isolated agent nodes.

**Scope:**

- Cap delegation depth.
- AgentProfile shares parent env only explicitly and cannot widen policy.
- Shared-sandbox concurrent writes require stale-write stamps/non-overlapping write scopes.
- Isolated AgentNode produces patch/artifact merge path instead of mutating source directly unless policy permits.
- Human users are principals/supervisors/approval channels, not model-callable root agents; any escalation must be attributed to a user grant.
- UI/provenance should distinguish human, agent, subagent/profile, plugin, and system writes where possible.

**Unit tests:**

- Depth cap rejects excessive delegation.
- Shared stale write rejected.
- Non-overlapping write scopes can proceed.
- Isolated agent patch does not mutate source until merge.
- User approval/grant is audit-attributed and not exposed as a model-callable super-agent tool.

**E2E/smoke logging:**

- Delegation smoke logs parent/child agent ids, delegation type (AgentProfile vs AgentNode), depth, sharing mode, write-scope decision, stale-write result, patch/artifact id, and user grant id when present.

**Acceptance:** Delegated work is useful without making specialist agents silently more powerful than their parent/workspace policy allows.
