# 05 — Multi-agent workspaces, sessions, and hooks

## Goal

Allow one deployed app/workspace to compose multiple agents with different tools, files, shell access, channels, and durability behavior.

This is the platform layer needed for child apps like Macro and for multiple agent roles in the same full-app deployment.

## Agent concepts

| Concept | Environment | Use case |
| --- | --- | --- |
| `AgentProfile` | same parent bash environment, maybe narrower cwd/view | cheap delegated tasks, same trust boundary |
| `AgentNode` | own config, tools, channels, sandbox policy, durability | specialist agents with different tools/provider/mount/network policy |

Defaults:

- declared child agents inherit nothing unless explicit;
- copy/current-agent delegation may share sandbox state only when explicit;
- narrower views are okay;
- wider views require owner/workspace policy approval;
- delegation depth is capped;
- shared-sandbox write access needs stale-write or non-overlapping write scopes.

## Workspace agent registry

A workspace may declare:

```ts
agents: [
  { id: 'coding', package: '@hachej/coding-agent', bash: true },
  { id: 'reviewer', package: '@hachej/review-agent', bash: { fs: 'readonly', exec: false } },
  { id: 'concierge', package: '@hachej/email-agent' }
]
```

There is **no `features` config member**. Each agent's environment attachment is explicit: `bash: true` (or a `bash: { fs, exec }` scope) tells the host to spread the plain `createBashAgentFeature(...)` tool bundle into that agent's `createAgent().tools`; omitting `bash` yields a pure agent with no file/bash tools. (For richer multi-environment agents this generalizes to an `environments: [...]` attachment list per 09; the point is explicit host-side composition, never an `AgentFeature`/`features` abstraction.) Child-app defaults can seed this registry, but workspace/user policy can narrow it.

## Route/session namespace

Required scoping:

- routes: the canonical `/api/v1/agents/:agentId/...` path-prefix family (locked at pass 3; no header/request-scope alternative);
- add `agentId` to the real per-workspace runtime binding/scope used by `registerAgentRoutes` and core workspace server caches; do not assume a preexisting single composite key has every field;
- `sessionNamespace` includes `agentId`; legacy fields such as root/template/pi/session namespace must remain isolated where they currently exist;
- session root layout preserves AGENTS.md rule: transcripts live under host durable `BORING_AGENT_SESSION_ROOT`, not workspace/container home;
- tool catalog is per agent;
- provisioning is per `(workspaceId, agentId, bashPlanFingerprint)`;
- UI commands include `agentId` for attribution where useful, while workspace UI state remains shared.

Isolation test: two agents in one workspace with same `sessionId` do not share bindings, tool catalogs, transcripts, or provisioning readiness incorrectly.

## Session history search (#379)

Add a session index/search API independent of boring-bash.

Scope:

- `workspaceId`;
- `agentId`;
- `sessionId`;
- title/name;
- messages/content;
- operational events;
- links/deep-link metadata.

Requirements:

- Pi-native content search parity;
- no filesystem requirement;
- redaction for private/tool outputs;
- URL/deep-link compatibility;
- multi-project browse support without loading every workspace.

## Deep links and session links (#243, #211)

The multi-agent route model must support:

- opening a specific session history;
- preserving focused session in URL;
- resolving inaccessible/deleted sessions gracefully;
- not overwriting active work without user intent;
- later multi-pane layout encoding.

## External harness review/question hooks (#380)

External systems can create review/question/approval hooks against a workspace/agent/session. The authoritative contract is defined in [`01-agent-core-runtime-free.md`](01-agent-core-runtime-free.md); this file only defines multi-agent routing requirements.

Requirements:

- authenticate caller;
- validate target workspace/agent/session;
- redact before writing to history;
- route to correct UI/HITL channel;
- audit attribution;
- no boring-bash dependency.

## User as principal

Do not model human user as a model-callable max-power agent.

Model user as:

- principal;
- supervisor;
- approval channel;
- grant source;
- audit actor.

Agents request grants; users approve/reject through UI/HITL channels. Privileged host actions stay in trusted app tools.

## Concurrency

Shared environment risks:

- simultaneous writes;
- one agent invalidating another agent’s read stamps;
- session transcript confusion;
- tool readiness bleed;
- child agent widening access.

Required safeguards:

- write scopes;
- stale-write stamps;
- merge/patch artifacts for isolated agents;
- per-agent tool catalog;
- per-agent readiness;
- explicit delegation depth cap.

## Tests

- resolved child-app/default agent set can seed the agent registry before plugin/runtime policy uses it;
- two agents same workspace/session id do not collide;
- session namespace includes agent id;
- binding cache includes agent id;
- per-agent tool catalog differs as expected;
- reviewer has readonly fs/no exec while coding agent has bash;
- pure concierge has no boring-bash;
- session search scoped by workspace+agent;
- deep links open target session safely;
- external hooks authenticate/redact/route;
- delegation depth cap works;
- shared-sandbox stale-write protection works.
