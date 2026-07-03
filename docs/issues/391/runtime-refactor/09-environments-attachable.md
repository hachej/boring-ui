# 09 — Environments as attachable resources

Status: v2 addition. Generalizes the #416 filesystem-binding model: **a filesystem + its sandbox is a resource you attach to an agent, not a feature of the agent.** `company_context` was the first instance; this file makes attachment the only model.

## Intent

- One environment (fs + optional exec), many consumers: the main agent, subagents, *other* boring agents, and **external agents** (Claude Code, Codex, any MCP client).
- One agent, many environments: zero (pure mode), its private `user` workspace, readonly `company_context`, a shared team scratch fs, an ephemeral per-task sandbox.
- Attachment is the only coupling, in both directions. No implicit cwd inheritance anywhere.

## Contracts

Builds directly on the landed #416 shapes (`FilesystemId`, `FilesystemBinding`, `FilesystemBindingProvider`, `PreparedFilesystemBinding`, `ScopedFilesystemRuntimeBindingManager`) — generalized, not replaced:

```ts
// boring-bash/shared — type-only for the agent core
interface Environment {
  id: string                        // stable identity, independent of any agent
  provider: string                  // direct | bwrap | vercel-sandbox | remote-worker | fixture | ...
  capabilities: EnvironmentCapabilities   // fs: none|readonly|readwrite, exec, realBash, watch, search, networkIsolation
  fs?: EnvironmentFsOps             // the SessionEnv-style universal ops (02)
  exec?: EnvironmentExecOps
  lifecycle: { prepare(ctx): PreparedEnvironment; dispose?; invalidate? }
}

interface EnvironmentAttachment {
  environmentId: string
  filesystem: FilesystemId          // model-visible identity, e.g. 'user' | 'company_context' | 'team_scratch'
  access: FilesystemAccess          // readonly | readwrite
  scope?: { subpath?: string }      // scoped view: same env, jailed subdir (Flue createCwdSessionEnv pattern)
  execPolicy: 'none' | 'attached'   // whether bash/exec runs against this env (02/#416 exec rules apply)
}

// what an agent/session receives — resolved by the host, never self-served
interface ResolvedEnvironments { attachments: PreparedEnvironmentAttachment[] }
```

Registry: hosts own an `EnvironmentRegistry` (create/get/list/dispose by `id`), living in boring-bash/server; the agent core only sees `ResolvedEnvironments` via injection (type-only import, invariant-checked).

## Consumers

| Consumer | How it attaches |
| --- | --- |
| Main agent | host resolves attachments per session (today: binding resolver — unchanged) |
| Subagent | inherits by **explicit attachment**, either the same environment handle (shared workspace) or a `scope.subpath` view; never by cwd inheritance |
| Another boring agent (multi-agent, Phase 7) | same registry, attachment keyed by `agentId` — binding scope keys already include it |
| **External agent** | **MCP projection** — see below |

## MCP projection: external reuse for free

Any environment can be projected as an **MCP server**: fs ops (`read/list/stat/search/grep`, plus `write/edit` when `access: readwrite`) and optionally `exec` exposed as MCP tools. Enforcement stays in the projection layer we already have — readonly/management projection operations and the no-leak conformance suite (#416) run *under* the MCP surface, so a denied file is absent over MCP exactly as it is in-process.

- Every external agent already speaks MCP → zero boring-specific code on their side.
- Identity/audit: MCP sessions map to a `BoundFilesystemContext` (actor, workspaceId, sessionId, requestId) — same audit spine as internal attachments.
- The remote-worker protocol is reclassified: **a transport for an environment**, peer to in-process and MCP, not a special provider.

## Security invariants

1. Attachment carries policy; an environment has no ambient authority. `filesystem + path + operation + actor` remains the resource identity (#416).
2. Scoped views are enforced by the environment host (physical projection or jailed ops), never by consumer-side path filtering.
3. Credential brokering happens at the environment boundary (08 trust rule); MCP clients never receive broker secrets.
4. Exec against a governed filesystem follows the #416 exec rules unchanged; `execPolicy: 'none'` is the default for any non-`user` attachment.

## What changes vs 02

`BashEnvironment` (02) remains the concrete implementation surface. Ownership framing flips: boring-bash is an **environment host**, not "the fs/bash feature of an agent". `createBashAgentFeature()` becomes sugar over "attach these environments to this agent". No landed #416 contract changes; `company_context` becomes the reference `Environment` + readonly `EnvironmentAttachment`.

## Conformance

The environment conformance suite (07/08) runs identically against: in-process attachment, scoped-view attachment, remote-worker transport, and the MCP projection. One suite, four mounts — same rule as harness/transport conformance.
