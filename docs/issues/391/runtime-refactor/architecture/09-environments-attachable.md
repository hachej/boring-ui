# 09 — Environments as attachable resources

Status: v2 addition. Generalizes the #416 filesystem-binding model: **a filesystem + its sandbox is a resource you attach to an agent, not a feature of the agent.** `company_context` was the first instance; this file makes attachment the only model.

## Intent

- One environment (fs + optional exec), many consumers: the main agent, subagents, *other* boring agents, and **external agents** (Claude Code, Codex, any MCP client).
- One agent, many environments: zero (pure mode), its private `user` workspace, readonly `company_context`, a shared team scratch fs, an ephemeral per-task sandbox.
- Attachment is the only coupling, in both directions. No implicit cwd inheritance anywhere.

## Contracts

Builds directly on the landed #416 shapes (`FilesystemId`, `FilesystemBinding`, `FilesystemBindingProvider`, `PreparedFilesystemBinding`, `ScopedFilesystemRuntimeBindingManager`) — generalized, not replaced:

Type ownership (one dependency direction, boring-bash → agent): the **rich** `Environment`/`EnvironmentAttachment` types live in `boring-bash/shared`; the **minimal core-facing** `ResolvedEnvironments` type — the existing **operation-bearing binding array** `{ bindings: RuntimeFilesystemBinding[] }` — lives in `@hachej/boring-agent` shared contracts. boring-bash's `resolveAttachments` imports the agent-defined `ResolvedEnvironments` type-only and returns it. The agent core imports **nothing** from boring-bash.

```ts
// boring-bash/shared — the rich, host-facing environment types
interface Environment {
  id: string                        // stable identity, independent of any agent
  provider: string                  // direct | bwrap | vercel-sandbox | remote-worker | fixture | ...
  capabilities: EnvironmentCapabilities   // fs: none|readonly|readwrite, exec, realBash, watch, search, networkIsolation
  // NO fs/exec ops member and no `lifecycle` member. The Environment carries only identity,
  // provider, and typed capability facts — `Environment = { id, provider, capabilities }`.
  // Operations are NOT a field on the Environment: they are constructed on the PREPARED
  // bindings by `resolveAttachments` (host-supplied mount facts + the #416 projection ops).
  // Preparation and disposal flow through the existing `ScopedFilesystemRuntimeBindingManager`
  // via the E1 `resolveAttachments` reduction — the environment carries no prepare/dispose/
  // invalidate of its own, and its mount path is host-supplied per attachment entry.
}

interface EnvironmentAttachment {
  environmentId: string
  filesystem: FilesystemId          // model-visible identity, e.g. 'user' | 'company_context' | 'team_scratch'
  access: FilesystemAccess          // readonly | readwrite
  scope?: { subpath?: string }      // scoped view: same env, jailed subdir (Flue createCwdSessionEnv pattern)
  execPolicy: 'none' | 'attached'   // whether bash/exec runs against this env (02/#416 exec rules apply)
}

// @hachej/boring-agent shared — the minimal core-facing shape the agent OWNS.
// The agent-side injection type IS the existing operation-bearing binding array. There is NO
// separate `PreparedEnvironmentAttachment { handle: unknown }` (deleted): the agent never
// receives an opaque handle, it receives prepared, operation-bearing bindings.
// `resolveAttachments` RETURNS these directly (it wraps prepare + operations construction).
// (boring-bash imports this type-only; the agent imports nothing from boring-bash)
//
// what an agent/session receives — resolved by the host, never self-served
interface ResolvedEnvironments {
  bindings: RuntimeFilesystemBinding[]   // the landed agent shape: { filesystem, access, operations }
}
```

Resolution (no registry vocabulary in E1): hosts reduce an `EnvironmentAttachment[]` to the landed #416 `FilesystemBinding[]` via a thin `resolveAttachments` adapter in boring-bash/server (E1) — there is **no `EnvironmentRegistry` class** and **no new prepare/dispose lifecycle** (the existing `ScopedFilesystemRuntimeBindingManager` still owns preparation and disposal). The agent core only sees `ResolvedEnvironments` via injection — and it **owns** that type (defined in `@hachej/boring-agent` shared), importing nothing from boring-bash; boring-bash's `resolveAttachments` imports the agent-defined `ResolvedEnvironments` type-only. The one cross-package type edge is boring-bash → agent (invariant-checked). An **address-by-id lookup (a plain `Map<environmentId, Environment>`) is introduced later in E2**, where the MCP projection actually needs to resolve an environment by id — not in E1.

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
5. **Workspace-bound context is required for any environment attachment.** Environment attachments (`company_context`, any governed fs, the E2 MCP projection) REQUIRE a workspace-bound context — `BoundFilesystemContext.workspaceId` is **real** (the locked #416 shape, unchanged). Workspace-less / pure surfaces run `runtime: 'none'` with **no attachments** until the host binds them to a workspace; surfaces **never synthesize a `workspaceId`**. This is the attachment-side counterpart to 08's optional-`SessionCtx.workspaceId` rule: a session may omit tenancy, but the moment it attaches a governed environment it must be workspace-bound — `resolveAttachments`/MCP projection are never invoked to attach governed context for a session that has no `workspaceId`.

## What changes vs 02

`BashEnvironment` (02) remains the concrete implementation surface. Ownership framing flips: boring-bash is an **environment host**, not "the fs/bash feature of an agent". `createBashAgentFeature()` becomes sugar over "attach these environments to this agent". No landed #416 contract changes; `company_context` becomes the reference `Environment` + readonly `EnvironmentAttachment`.

## Conformance

Where these environments actually run — the isolation tiers (dev bwrap / hardened gVisor systrap / VM-grade Kata·Cloud-Hypervisor+virtiofs), the FUSE×isolation matrix, EU providers, and the host-side-mount-never-in-guest-creds rule — is specified in [`10-sandbox-deployment-eu.md`](10-sandbox-deployment-eu.md). Governed filesystems (`company_context`) are never raw-mounted; they stay projection-based (#416).

The environment conformance suite (07/08) runs identically against the **delivered mounts** — the in-process attachment, the scoped-view (+ symlink-escape) attachment, and the MCP projection (E2) — plus the **deferred remote-worker (provider) attachment mount, gated on the P5 remote-worker handshake work** (owning bead: `../work/P5-provisioning-secrets/TODO.md` BBP5-010). One suite, N mounts — same rule as harness/transport conformance; a mount is added by the phase that delivers its implementation, and mounts are named, never numbered.
