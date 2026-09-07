# @hachej/boring-sandbox/providers

Concrete sandbox providers live behind this subpath as they move out of
`@hachej/boring-agent`. The authoritative provider capability facts live in
`@hachej/boring-sandbox/shared`; provider code must not define a second matrix.

| Runtime mode | Sandbox provider | Notes |
| --- | --- | --- |
| `direct` | `direct` | Trusted host mode; no isolation. |
| `local` | `bwrap` | Linux bubblewrap. The mode id intentionally differs from the provider id. |
| `vercel-sandbox` | `vercel-sandbox` | Optional remote PROXY provider. |
| `blaxel` | `blaxel` | EU-region remote provider with a persistent Volume at `/workspace`; SDK 0.3.11 output caps are local and cancellation is best effort. |
| `remote-worker` | `remote-worker` | Client/provider split from the app-owned worker server. Worker-dependent facts stay `unknown` until the P5 handshake reports them. |
| pure/headless | `none` | No boring-bash environment. |
| readonly files | `readonly` facade | File UI/search/watch without exec. |

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
