# Three-stack runtime

```mermaid
flowchart TB
  host[Workspace, Core, or CLI host]

  subgraph agent[boring-agent — orchestration]
    gateway[AgentGateway + session service]
    mode[RuntimeModeAdapter]
    harness[Pi harness + tool assembly]
    gateway --> harness
    mode -->|paired RuntimeBundle| harness
  end

  subgraph bash[boring-bash — environment operations]
    factories[Pi shell + file tool factories]
    fsStrategy{filesystem strategy}
    shellStrategy{shell strategy}
    boundFs[boundFs operations]
    localShell[local BashOperations + spawn hook]
    remoteWorkspace[remote Workspace operations]
    remoteSandbox[remote Sandbox operations]
    factories --> fsStrategy
    factories --> shellStrategy
    fsStrategy -->|host| boundFs
    fsStrategy -->|remote| remoteWorkspace
    shellStrategy -->|host or local| localShell
    shellStrategy -->|remote| remoteSandbox
  end

  subgraph sandbox[boring-sandbox — isolation and providers]
    provider[SandboxProviderV1]
    backends[direct · bwrap · Vercel · remote worker]
    pair[WorkspaceSandboxPairV1]
    backends -->|implement| provider
    provider -->|atomic create| pair
    pair --> workspace[Workspace]
    pair --> executor[Sandbox]
  end

  storage[adapter-private host storage root]
  spawn[host process or bwrap spawn hook]

  host --> gateway
  host --> mode
  mode -->|create| provider
  pair -->|returns one pair| mode
  mode -. storageRoot .-> storage
  mode -. runtimeHost .-> spawn
  harness --> factories
  boundFs -->|local files · search| storage
  localShell -->|direct or wrapped exec| spawn
  remoteWorkspace -->|remote files| workspace
  remoteSandbox -->|remote exec| executor
```

Agent owns gateway and harness composition, boring-bash owns consumer-visible
shell/file operations, and boring-sandbox owns provider confinement. The mode
adapter wraps one atomic Workspace/Sandbox pair in the runtime bundle.

## Depicted files

- `docs/DECISIONS.md` (Decisions 28 and 29)
- `docs/procedures/coding-invariants.md`
- `packages/agent/src/server/runtime/mode.ts`
- `packages/agent/src/server/runtime/modes/providerAdapter.ts`
- `packages/agent/src/server/agent-host/buildAgentComposition.ts`
- `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`
- `packages/boring-bash/src/agent/tools/harness/index.ts`
- `packages/boring-bash/src/agent/tools/harness/bashToolOptions.ts`
- `packages/boring-bash/src/agent/tools/filesystem/index.ts`
- `packages/boring-bash/src/agent/tools/operations/bound.ts`
- `packages/boring-bash/src/agent/tools/operations/remoteWorkspace.ts`
- `packages/boring-bash/src/agent/tools/operations/remoteSandbox.ts`
- `packages/boring-sandbox/src/shared/providerV1.ts`
- `packages/boring-sandbox/src/providers/direct/createDirectProvider.ts`
- `packages/boring-sandbox/src/providers/bwrap/createBwrapProvider.ts`
- `packages/boring-sandbox/src/providers/vercel-sandbox/createVercelSandboxProvider.ts`
- `packages/boring-sandbox/src/providers/remote-worker/createRemoteWorkerProvider.ts`
