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
  -> registerAgentRoutes runtime-scope key
  -> PiSessionStore session directory
  -> Pi SessionManager sessionDir
```

No new storage abstraction is needed.

## Solution

Remove `nativeSessionStartEnabledForRuntime(runtimeMode)`.

Use one existing-style host capability instead:

```ts
nativeSessionStartEnabled?: boolean
```

Rules:

- standalone `createAgentApp`: enabled by default because it is a single-user app shape;
- embedded `registerAgentRoutes`: disabled by default;
- first-party CLI/playgrounds explicitly enable it regardless of runtime mode;
- full app explicitly enables it because its session namespace is already user + workspace scoped;
- full app namespace resolution must require a verified user and must not place native sessions in the shared `anonymous` namespace.

The option is a trusted host-composition seam. It says, “the session directory selected for this request is safe for contextless native Pi files.” It does not describe the runtime or introduce a new policy model.

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

1. Delete the runtime-mode capability helper and its runtime matrix.
2. Add/pass through `nativeSessionStartEnabled?: boolean` at the trusted host options:
   - `createAgentApp` default `true`;
   - `registerAgentRoutes` default `false`.
3. Enable it in first-party hosts:
   - CLI;
   - agent playground;
   - workspace playground, including remote-worker mode;
   - full app/core host.
4. Make full-app session namespace resolution require a verified user for native-capable agent requests; keep HTTP and dispatcher identity resolution consistent.
5. Pass the capability to the existing route and harness flags already present in PR #811.
6. Pass the capability into `WorkspaceAgentFront`/playground metadata so the native-first UI path is used.
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

- standalone `createAgentApp` enables native start for direct, local, and representative remote/custom adapters;
- embedded `registerAgentRoutes` omits native start by default;
- embedded host with explicit capability enables it independently of runtime mode.

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
7. Unknown embedded hosts remain disabled by default.
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
