---
github: https://github.com/hachej/boring-ui/issues/775
issue: 775
state: ready-for-agent
updated: 2026-07-25
flag: not-needed
track: owner
---

# gh-775 host-owned native Pi session capability

## Problem

PR #811 gates native Pi session creation by runtime mode. That is unnecessary: runtime mode only decides where workspace tools execute.

The actual app shapes are simpler:

- standalone/CLI/playground hosts are single-user;
- the full app is multi-user and already gives each user + workspace its own `sessionNamespace` directory;
- unknown embedded hosts must remain disabled unless they explicitly opt in.

The full app's existing path is already complete:

```text
verified user + workspace
  -> fullAppAgentSessionNamespace
     (defined as boringMcpAgentSessionNamespace in
      plugins/boring-mcp/src/server/appServerBinding.ts, re-exported by
      apps/full-app/src/server/boringMcp.ts)
  -> registerAgentRoutes runtime-scope key
  -> PiSessionStore session directory (PiSessionStore sets sessionDir itself
     via sessionDirForNamespace; there is no separate Pi SessionManager hop)
```

No new storage abstraction is needed.

## Solution

Remove `nativeSessionStartEnabledForRuntime(runtimeMode)`.

Use one existing-style host capability instead:

```ts
nativeSessionStartEnabled?: boolean
```

Rules:

- opt-in everywhere: both `createAgentApp` and `registerAgentRoutes` default the capability to `false`;
- every first-party host (CLI, agent playground, workspace playground including remote-worker mode, full app/core host) explicitly enables it, regardless of runtime mode;
- rationale for no default-true: `createAgentApp` has multiple call sites (e.g. `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`) and "single-user" is a property of the host, not of the function — a silent default could enable native sessions in a future multi-user embedding;
- full app namespace resolution must require a verified user and must not place native sessions in the shared `anonymous` namespace.

The option is a trusted host-composition seam. It says, “the session directory selected for this request is safe for contextless native Pi files.” It does not describe the runtime or introduce a new policy model. This contract is not type-checkable — record it as a doc comment on the `nativeSessionStartEnabled` option at both host entry points.

## Decisions

### Keep the existing directories

Do not create a new folder layout. The full app already stores sessions under a namespace equivalent to:

```text
<workspace>_user_<hash(userId)>
```

Existing wrappers and new native transcripts stay together in that directory. Listing, loading, deletion, binding caches, and Pi interoperability continue to use the existing `PiSessionStore`.

### Full app owns its multi-user guarantee

Before enabling native start in the full app:

- obtain the user only from `request.user.id` or trusted dispatcher `userId`;
- use the already authorized workspace id;
- resolve the same namespace for HTTP and dispatcher paths;
- reject a missing verified user instead of falling back to `anonymous` for native-capable agent routes.

Because the binding key already contains `sessionNamespace`, different users/workspaces already receive different harness/store instances.

### Unknown embedded hosts fail closed

`registerAgentRoutes` defaults the capability to `false`. A custom host must explicitly enable it after providing its own safe `sessionDir` or request-scoped `getSessionNamespace`.

This retains a safe library default without creating `single-user-host` versus `user-workspace-namespace` policy types.

## Actual Build

1. Delete the runtime-mode capability helper and its runtime matrix
   (`packages/agent/src/server/nativeSessionStartCapability.ts`).
2. Add/pass through `nativeSessionStartEnabled?: boolean` at the trusted host options:
   - `createAgentApp` default `false`;
   - `registerAgentRoutes` default `false`;
   - include the safety-contract doc comment on both options.
3. Enumerate all `createAgentApp`/`registerAgentRoutes` call sites
   (`grep -rn "createAgentApp(\|registerAgentRoutes(" packages apps plugins`)
   and explicitly enable the capability in every first-party host:
   - CLI;
   - agent playground;
   - workspace playground, including remote-worker mode
     (covers `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`);
   - full app/core host.
4. Make full-app session namespace resolution require a verified user for
   native-capable agent requests; the concrete edit target is the `anonymous`
   fallback in `plugins/boring-mcp/src/server/appServerBinding.ts`
   (`boringMcpAgentSessionNamespace`); keep HTTP and dispatcher identity
   resolution consistent.
5. Pass the capability to the existing route and harness flags already present in PR #811.
6. Verify-only: `WorkspaceAgentFront` already accepts `nativeSessionStartEnabled`
   and drives the native-first UI path (`localCreateUntilPrompt`) — confirm the
   value still flows correctly once the source changes from runtime mode to the
   host boolean; no new plumbing expected.
7. Add focused isolation and runtime-independence tests.

## Explicitly Not Building

- no storage-isolation policy enum;
- no new session-store class;
- no new directory layout;
- no database or transcript index;
- no migration or compatibility reader;
- no Pi JSONL changes;
- no remote-specific session implementation.

## Test Seams

### Host capability

- both `createAgentApp` and `registerAgentRoutes` omit native start by default;
- host with explicit capability enables it independently of runtime mode, for direct, local, and representative remote/custom adapters;
- every first-party host wiring is covered: capability reaches the routes for CLI, playgrounds (including remote-worker mode), and full app.

### Full-app isolation

Using one session root:

- user A/workspace 1 and user B/workspace 1 resolve different namespaces;
- user A/workspace 1 and user A/workspace 2 resolve different namespaces;
- HTTP and trusted dispatcher calls resolve the same namespace;
- missing verified user does not receive a native-capable binding;
- user B cannot list or load user A's known native session id because B's store only sees B's namespace directory.

### Existing regression seams

- `packages/agent/src/server/__tests__/registerAgentRoutes.test.ts`
- `packages/agent/src/server/__tests__/registerAgentRoutes.lifecycle.test.ts`
- `packages/agent/src/server/harness/pi-coding-agent/__tests__/createHarness.test.ts`
- PR #811 native-first and rename tests
- full-app session namespace tests

## Acceptance

1. Runtime mode no longer controls native session availability.
2. Workspace playground native first-send works in remote-worker mode.
3. Full app native sessions use its existing user + workspace namespace.
4. Missing full-app user identity fails closed rather than using `anonymous`.
5. Two users in the same workspace cannot see each other's native sessions.
6. Existing wrapper sessions remain visible because directory selection does not change.
7. All hosts remain disabled by default; native start is active only where a first-party host explicitly opted in.
8. PR #811 first-send, idempotency, adoption, rename, delete, and `pi /resume` behavior remains green.

## Proof

```bash
pnpm --filter @hachej/boring-agent test
pnpm --filter @hachej/boring-agent typecheck
pnpm --filter @hachej/boring-agent build
pnpm --filter full-app test
pnpm lint:invariants
```

Manual:

1. Start workspace playground in remote-worker mode and verify native first-send/adoption.
2. On one full-app host, create sessions as two users in one workspace.
3. Verify each user sees only their own native ID.
4. Attempt cross-user load with a known ID and receive non-disclosing not-found.
5. Verify standalone Pi can resume a native transcript from that user's existing namespace directory.

Record sanitized evidence in `docs/issues/775/proof.md`.

## Slices

### Slice: replace runtime gating with host capability

**Delivers:** Host option plumbing, full-app verified namespace guard, first-party wiring, focused tests, and proof.

**Blocked by:** None.

**Review budget:** One small corrective slice; no new storage implementation.

## Out of Scope

- Shared chats among workspace collaborators.
- Legacy migration.
- Generic hosted durability or indexing.
- Moving Pi execution into the worker.

## Open Questions

None.
