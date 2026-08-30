# @hachej/boring-sandbox/providers

Concrete sandbox providers live behind this subpath as they move out of
`@hachej/boring-agent`. The authoritative provider capability facts live in
`@hachej/boring-sandbox/shared`; provider code must not define a second matrix.

| Runtime mode | Sandbox provider | Notes |
| --- | --- | --- |
| `direct` | `direct` | Trusted host mode; no isolation. Explicit disposable mode removes its exact lease root; default retains it. |
| `local` | `bwrap` | Linux bubblewrap. Explicit disposable mode removes its exact lease root; default retains it. The mode id intentionally differs from the provider id. |
| `vercel-sandbox` | `vercel-sandbox` | Disposable named forks delete without resumable handles; persistent default is unchanged. |
| `blaxel` | `blaxel` | Disposable mode is fresh/no-Volume/no-resume; default remains an EU-region persistent Volume at `/workspace`. |
| `remote-worker` | `remote-worker` | Disposable mode requires negotiated `multi-sandbox-roots-v1` and transfers published cleanup to the pair; unqualified workers fail closed. |
| pure/headless | `none` | No boring-bash environment. |
| readonly files | `readonly` facade | File UI/search/watch without exec. |

The disposable refinement is a host-only construction option, never a model
input. It promises fresh creation, pre-effect correlated reconciliation,
returned-pair ownership after publication, retryable idempotent disposal, and
not-found convergence. Mechanical support does not grant D31 production
qualification: direct/bwrap remain unsuitable for hostile tenants, Blaxel live
qualification is profile-specific, and the current local gVisor profile cannot
advertise remote-worker multi-root support because `openat2` is unavailable.

## #1459 qualification status

| Provider | Lifecycle proof at this head | Live status |
| --- | --- | --- |
| direct | real create/execute/two-root isolation/exact cleanup/default retention | PASS locally |
| bwrap | real Linux bubblewrap create/execute/isolation/exact cleanup/default retention | PASS locally |
| Blaxel | mock fresh create, conflict ownership, create/close race, retry/not-found, no Volume/store | LIVE NOT RUN — no D31-qualified profile credentials |
| Vercel | named create, conflict ownership, ambiguity reconciliation, retry/not-found, keyed redaction | LIVE PASS on the exact reviewed working tree via Vault-backed credentials: create/readiness/read-write/exec/provider-close ownership/remote deletion |
| remote-worker | authenticated mock protocol, ownership races, retry/not-found, capability fail-closed | LIVE NOT QUALIFIED — installed gVisor returns `ENOSYS` for `openat2`; capability remains unadvertised |

Mock proof is mandatory but is not represented as live qualification. A host
must not grant a profile whose live row is not qualified for its tenant policy.

### Reproducible proof matrix

| Proof | Exact command | Result at delivery head |
| --- | --- | --- |
| Disposable 13-law pair surface | `pnpm -C packages/boring-sandbox exec vitest run src/providers/__tests__/dualTargetParity.test.ts src/providers/remote-worker/__tests__/createRemoteWorkerProvider.test.ts` | PASS: the shared seven Workspace plus six Sandbox law helper runs against direct, bwrap, Blaxel, Vercel, and remote-worker disposable pairs |
| Provider lifecycle/ambiguity | `pnpm -C packages/boring-sandbox exec vitest run --passWithNoTests --maxWorkers=4` | PASS: 69 files / 809 tests |
| Agent authority/registry/strict adapter | `pnpm --filter @hachej/boring-agent test` | PASS: 2,350 passed / 18 skipped |
| Canonical wrappers | `pnpm --filter @hachej/boring-bash test` | PASS: 90 tests |
| Direct/bwrap exact roots | `pnpm -C packages/boring-sandbox exec vitest run src/providers/__tests__/disposableLocalProviders.test.ts` | PASS: provider removes the exact owned child, sibling/parent survive, ancestor aliases and root swaps fail closed, default roots remain |
| Remote worker | `RUN_RUNSC_INTEGRATION=1 pnpm --filter @hachej/boring-sandbox test:remote-worker:multi-lease` | PASS evidence, `qualified:false`, capability unadvertised (`openat2` ENOSYS) |
| Vercel disposable live | Vault-backed `/tmp/prb-vercel-smoke.ts` using this factory | Run after the delivery commit; sanitized result is recorded in the review receipt, never with IDs or credentials |

Sequential `typecheck`, invariant, and build gates pass for sandbox, Agent, and
boring-bash. Blaxel remains `LIVE NOT RUN`; no credential or remote identifier
is stored in this repository.

`resolveMode()` itself is owned by `@hachej/boring-bash/modes`. It resolves a
mode id to one of these provider values; providers do not resolve modes.

## Bubblewrap namespace profiles

The bwrap provider defaults to `namespaceProfile: 'full'`, which preserves
`--unshare-all`. Hardened Docker hosts that reject a proc mount inside a nested
user namespace may opt into `namespaceProfile: 'docker'`. That profile keeps
mount, IPC, PID, UTS, cgroup, and optional network isolation without creating a
nested user namespace, and always emits `--cap-drop ALL`; callers cannot disable
that capability drop. In this profile, raw `extraArgs`/`postWorkspaceArgs` may
still add controlled mounts, but namespace controls, capability additions, and
indirect `--args` expansion are rejected so later arguments cannot counteract
the resolved policy.

Applications select the profile through Agent's built-in local adapter:

```ts
createSandboxRuntimeModeAdapter('local', {
  bwrap: { sandbox: { namespaceProfile: 'docker' } },
})
```

The adapter resolves one policy and carries it through provider `Sandbox.exec`,
Agent bash spawn hooks, and local provisioning commands.
