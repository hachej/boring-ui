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
