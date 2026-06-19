# Core plugin integration

`@hachej/boring-core` consumes workspace plugins statically for now.

## Supported

- Front plugins are passed statically through `CoreWorkspaceAgentFront` / `WorkspaceAgentFront` props.
- Server plugins are passed through `createCoreWorkspaceAgentServer({ plugins })` using the standard workspace plugin entry shape.
- App package defaults are supported through `defaultPluginPackages` or `appPackageJsonPath` (`package.json#boring.defaultPluginPackages`).
- Front/Pi-only default packages are valid; core scans their package metadata without forcing a server import.

## Hot reload is disabled in core

Core exposes a symmetric app-level contract on front and server:

```ts
hotReload?: false
```

Passing `hotReload: true` fails fast. Directory plugin entries must also omit `hotReload` or set `hotReload: false`.

Use standalone `createWorkspaceAgentServer()` when plugin hot reload, plugin SSE, and `/reload` asset-manager behavior are required.

## UiBridge limitation

Core is multi-workspace. Static server plugin factories are resolved at boot, before a request workspace is known, so core does not provide a generic plugin-context `UiBridge` yet. Request-scoped agent UI tools and `/api/v1/ui` routes continue to use the correct per-workspace bridge.

A future parity pass can add a request/workspace-scoped plugin bridge contract for core.
