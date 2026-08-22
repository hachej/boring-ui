# @hachej/boring-sandbox/providers

Concrete sandbox providers live behind this subpath as they move out of
`@hachej/boring-agent`. The authoritative provider capability facts live in
`@hachej/boring-sandbox/shared`; provider code must not define a second matrix.

Every selectable runtime exports a `SandboxRuntimeModeDescriptorV1`. A
descriptor is self-contained: it declares its id, provider-pair identities,
capabilities, error-code namespace, adapter/host policies, runtime root, and a
lazy factory for the complete `WorkspaceSandboxPairV1`. Consumers resolve
descriptors through `@hachej/boring-sandbox/providers/registry`; they must not
select Workspace and Sandbox implementations independently.

| Runtime mode | Sandbox provider | Notes |
| --- | --- | --- |
| `direct` | `direct` | Trusted host mode; no isolation. |
| `local` | `bwrap` | Linux bubblewrap. The mode id intentionally differs from the provider id. |
| `vercel-sandbox` | `vercel-sandbox` | Optional remote PROXY provider. |
| `blaxel` | `blaxel` | EU-region remote provider with a persistent Volume at `/workspace`; SDK 0.3.11 output caps are local and cancellation is best effort. |
| `remote-worker` | `remote-worker` | Client/provider split from the app-owned worker server. Worker-dependent facts stay `unknown` until the P5 handshake reports them. |
| pure/headless | `none` | No boring-bash environment. |
| readonly files | `readonly` facade | File UI/search/watch without exec. |

The registry imports only lightweight descriptors. Concrete provider factories
are dynamically loaded on first runtime creation, so choosing one mode does not
eagerly initialize every provider SDK.
