# @hachej/boring-sandbox/providers

Concrete sandbox providers live behind this subpath as they move out of
`@hachej/boring-agent`. The authoritative provider capability facts live in
`@hachej/boring-sandbox/shared`; provider code must not define a second matrix.

| Runtime mode | Sandbox provider | Notes |
| --- | --- | --- |
| `direct` | `direct` | Trusted host mode; no isolation. |
| `local` | `bwrap` | Linux bubblewrap. The mode id intentionally differs from the provider id. |
| `vercel-sandbox` | `vercel-sandbox` | Optional remote PROXY provider. |
| `remote-worker` | `remote-worker` | Client/provider split from the app-owned worker server. Worker-dependent facts stay `unknown` until the P5 handshake reports them. |
| pure/headless | `none` | No boring-bash environment. |
| readonly files | `readonly` facade | File UI/search/watch without exec. |

`resolveMode()` itself is owned by `@hachej/boring-bash/modes`. It resolves a
mode id to one of these provider values; providers do not resolve modes.
