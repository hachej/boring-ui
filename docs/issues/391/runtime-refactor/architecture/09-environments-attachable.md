# 09 — Environments as attachable resources

> **V1 scope amendment.** The generic E1 attachment registry and external
> projections are post-v1. V1 reuses the current workspace composition and
> implements only the attachment/runsc changes required by the D1 dedicated
> workspace path. Every v1 run is workspace-backed and has an approved
> runtime/environment; a workspace-less zero-environment run is not a v1 mode.

Status: v2 addition. Generalizes the #416 filesystem-binding model: **a filesystem + its sandbox is a resource you attach to an agent, not a feature of the agent.** `company_context` was the first instance; this file makes attachment the only model.

## Intent

- One environment (fs + optional exec), many consumers: the main agent, subagents, *other* boring agents, and **external agents** (Claude Code, Codex, any MCP client).
- One agent, many environments over time. V1 requires at least the approved
  workspace runtime/environment; zero-environment execution is post-v1.
- **One workspace/project, many agents (post-v1 P7).** A workspace may hold N
  `AgentDeployment`s referencing versioned `AgentDefinition`s. Environments are
  project-scoped resources with agent-independent ids. Trusted identifiers are
  validated and encoded as a structured scope tuple; delimiter concatenation
  and UUID uniqueness are not security boundaries.
- **Sharing semantics.** Shared **readonly** (e.g. `company_context`, a team reference fs) is clean — many agents, no contention. Shared **writable** (e.g. `team_scratch`) is genuine concurrent access: it must be an **explicit authored choice** in both agents' `environmentAttachments` (`access: 'readwrite'`), and v1 provides **no cross-agent locking** — semantics are last-writer-wins at the filesystem layer and readers may observe partial writes. Accidental write-sharing is prevented by the default: any non-`user` attachment defaults to readonly/`execPolicy: 'none'` (security invariant 4). Multi-agent *within one project* is a different axis from multi-**project** navigation (issues #361/#363/#377, the cross-project left bar) — those are separate workspaces each with their own registry and pool; do not conflate.
- Attachment is the only coupling, in both directions. No implicit cwd inheritance anywhere.

## Contracts

Builds directly on the landed #416 shapes (`FilesystemId`, `FilesystemBinding`, `FilesystemBindingProvider`, `PreparedFilesystemBinding`, `ScopedFilesystemRuntimeBindingManager`) — generalized, not replaced:

Type ownership: the **rich** `Environment`/`EnvironmentAttachment` and
operation-bearing `PreparedEnvironmentAttachment` types live in `boring-bash`;
`Environment.capabilities` is a type-only alias/pick of the authoritative
`ProviderCapabilities` from `@hachej/boring-sandbox/shared` (no second
capability contract). The agent core owns only methodless `ResolvedEnvironment`
facts. The host owns preparation and disposal, then flattens prepared
attachments into the core's existing injected tools, prompt fragments,
readiness requirements, and input-asset handler. The agent core imports
**nothing** from boring-bash or boring-sandbox and never receives raw `exec`,
filesystem handles, or provider lifecycle authority.

```ts
// boring-bash/shared — the rich, host-facing environment types
interface Environment {
  id: string                        // stable identity, independent of any agent
  provider: string                  // direct | bwrap | vercel-sandbox | remote-worker | fixture | ...
  capabilities: EnvironmentCapabilities   // type-only alias/pick of boring-sandbox/shared ProviderCapabilities
  // NO fs/exec ops member and no `lifecycle` member. The Environment carries only identity,
  // provider, and typed capability facts — `Environment = { id, provider, capabilities }`.
  // Operations are NOT a field on the Environment: they are constructed on the PREPARED
  // bindings by `prepareAttachmentLifetime` (host-supplied mount facts + the #416 projection ops).
  // Preparation and disposal flow through the existing `ScopedFilesystemRuntimeBindingManager`
  // via the E1 `prepareAttachmentLifetime` reduction — the environment carries no prepare/dispose/
  // invalidate of its own, and its mount path is host-supplied per attachment entry.
}

interface EnvironmentAttachment {
  environmentId: string
  filesystem: FilesystemId          // model-visible identity, e.g. 'user' | 'company_context' | 'team_scratch'
  access: FilesystemAccess          // readonly | readwrite
  scope?: { subpath?: string }      // scoped view: same env, jailed subdir (Flue createCwdSessionEnv pattern)
  execPolicy: 'none' | 'attached'   // whether bash/exec runs against this env (02/#416 exec rules apply)
}

// @hachej/boring-agent/shared — public facts only: no methods, handles, cwd,
// raw exec value, or lifecycle authority.
interface ResolvedEnvironment {
  id: string
  filesystem?: {
    access: 'readonly' | 'readwrite'
    acceptsInputAssets?: boolean
    defaultInputAssetSink?: boolean
  }
  tools: string[]
  provider?: string
  label?: string
}
```

Resolution (no registry vocabulary in E1): the host prepares an
`EnvironmentAttachment[]` through `prepareAttachmentLifetime` in
boring-bash/server. A stable `AttachmentLifetimeKey` contains trusted storage/
workspace/subject/agent/runtime-instance identity, optional session identity,
and `attachmentSetDigest` derived from the canonical selected catalog entries;
it explicitly excludes per-request ids. `prepareAttachmentLifetime` recomputes
and verifies that digest before cache lookup. A separate authenticated request
context authorizes each route/UI/tool access through
`AttachmentLifetimeOwner.withAuthorizedView(requestContext, lifetimeKey, fn)`.
The callback receives a short-lived lease; it cannot be retained and becomes
invalid when the callback settles. `prepareAttachmentLifetime(...)` returns
only `{ facts, contributions }`: methodless `ResolvedEnvironment[]` plus
auth-gated tool/route/UI/prompt/input-asset contribution closures. It never
returns raw `PreparedEnvironmentAttachment[]` to a consumer. Each operation on
a contribution enters `withAuthorizedView`, so a long-lived route, tool, or UI
binding cannot bypass a later authorization check. One host-owned lifetime owner
prepares each attachment once for that stable key; tools, routes, and UI resolve
through the same view across many authorized operations. The landed
`ScopedFilesystemRuntimeBindingManager` remains the
filesystem preparation primitive, but receives a stable preparation context,
never the current HTTP request id. Eviction, invalidation, failure, and shutdown
dispose a prepared attachment exactly once. The agent receives only flattened
capability inputs plus matching `ResolvedEnvironment[]` facts. E1 itself adds no
registry. P6-R, the first real v1 lookup consumer, owns a minimal host-only
`DeploymentAttachmentCatalog` from opaque deployment ref to validated E1 entry;
it is injected, workspace-scoped, and has no lifecycle or global singleton.

## Consumers

| Consumer | How it attaches |
| --- | --- |
| Main agent | workspace host resolves the approved v1 runtime/environment using the current composer; generic attachment resolution is post-v1 |
| Subagent | inherits by **explicit attachment**, either the same environment handle (shared workspace) or a `scope.subpath` view; never by cwd inheritance |
| Another boring agent (multi-agent, Phase 7) | same registry, attachment keyed by `agentId` — binding scope keys already include it |
| **External agent** | **MCP projection** — see below |

## MCP projection: external reuse for free

Any environment can be projected as an **MCP server**: fs ops (`read/list/stat/search/grep`, plus `write/edit` when `access: readwrite`) and optionally `exec` exposed as MCP tools. Enforcement stays in the projection layer we already have — readonly/management projection operations and the no-leak conformance suite (#416) run *under* the MCP surface, so a denied file is absent over MCP exactly as it is in-process.

- Every external agent already speaks MCP → zero boring-specific code on their side.
- Identity/audit: MCP sessions map to a `BoundFilesystemContext` (actor, workspaceId, sessionId, requestId) — same audit spine as internal attachments.
- Duality: `plugins/boring-mcp` **consumes MCP** into boring agent tools, while E2 **exposes boring environments** out as MCP servers. Same protocol, opposite directions; no shared runtime machinery.
- **Remote-worker ownership (deferred direction — NOT a live instruction):** in this epic remote-worker **remains a provider** (the concrete provider adapters — including `remote-worker` — live in **`@hachej/boring-sandbox`**, moved there by `TODO-P2`; its capability facts come only from the `TODO-P5` handshake). Reclassifying it as *a transport for an environment* (peer to in-process and MCP) is an attractive future direction but is **explicitly DEFERRED to a post-E2 follow-up, to be filed at P8**. Nothing here overrides or contradicts the P2/P5 remote-worker-as-provider design.

## Two access paths for external agents (projection vs native mount)

An external agent can reach an environment two ways, and the choice is a **policy decision, not a capability accident**:

1. **MCP projection (E2)** — **governed, policy-filtered** access. The agent speaks MCP; every op runs *under* the readonly/management projection ops + no-leak conformance (#416), so denied files are physically absent and writes are policy-gated. Use for **governed context** (`company_context`, any regulated/filtered filesystem).
2. **Native S3 mount (`TODO-X1`)** — **prefix-granular** access where the external agent uses its **own native tools** (`bash`/`grep`/`git`, **untranslated** — no MCP tool surface in between) against a mounted prefix. Use for **trusted shared workspaces** (a shared team scratch prefix, a cross-org delivery prefix — 08 cross-org artifact direction).

**Rule:** governed context → **projection**; trusted shared workspaces → **native mount**. Never raw-mount a governed filesystem (#416; `TODO-X1` `user`-fs-only scoping). Both paths sit on the **same Environment identity, the same credential broker (host-side, secrets never reach the client/sandbox), and the same audit spine** (`BoundFilesystemContext` — actor/workspaceId/sessionId/requestId) — the access mechanism differs, the identity/brokering/audit do not.

## Security invariants

1. Attachment carries policy; an environment has no ambient authority. `filesystem + path + operation + actor` remains the resource identity (#416).
2. Scoped views are enforced by the environment host (physical projection or jailed ops), never by consumer-side path filtering. Containment must be **realpath-based with symlink denial** (`lstat` each path component; reject a symlink, or resolve it and re-check the result is still inside the jail) — not lexical `resolve()` alone — and E1 ships an explicit **symlink-escape conformance test**. (The landed `readonlyProjectionOperations.ts` jails lexically via `resolve()` only; E1 hardens it.)
3. Credential brokering happens at the environment boundary (08 trust rule); MCP clients never receive broker secrets.
4. Exec against a governed filesystem follows the #416 exec rules unchanged; `execPolicy: 'none'` is the default for any non-`user` attachment.
5. **Workspace-bound context is required for v1 execution.** Every v1 run and
   every environment attachment requires a real authorized
   `BoundFilesystemContext.workspaceId` (the locked #416 shape, unchanged).
   Surfaces never synthesize a workspace id. A future workspace-less consumer
   may run with no attachment only after passing decision 21's reintroduction
   gate; that future possibility does not weaken v1 authorization.

## What changes vs 02

`BashEnvironment` (02) remains the concrete implementation surface. Ownership framing flips: boring-bash is an **environment host**, not "the fs/bash feature of an agent". `createBashAgentFeature()` becomes sugar over "attach these environments to this agent". No landed #416 contract changes; `company_context` becomes the reference `Environment` + readonly `EnvironmentAttachment`.

## Conformance

Where these environments actually run — the isolation tiers (dev bwrap / hardened gVisor systrap / VM-grade Kata·Cloud-Hypervisor+virtiofs), the FUSE×isolation matrix, EU providers, and the host-side-mount-never-in-guest-creds rule — is specified in [`10-sandbox-deployment-eu.md`](10-sandbox-deployment-eu.md). Governed filesystems (`company_context`) are never raw-mounted; they stay projection-based (#416).

The environment conformance suite (07/08) runs identically against the **delivered mounts** — the in-process attachment, the scoped-view (+ symlink-escape) attachment, and the MCP projection (E2) — plus the **deferred remote-worker (provider) attachment mount, gated on the P5 remote-worker handshake work** (owning bead: `../work/P5-provisioning-secrets/TODO.md` BBP5-010). One suite, N mounts — same rule as harness/transport conformance; a mount is added by the phase that delivers its implementation, and mounts are named, never numbered.
