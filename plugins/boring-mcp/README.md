# `@hachej/boring-mcp`

Reusable boring-ui MCP/Sources plugin foundation.

This package is the generic MCP capability that child apps can enable. It owns:

- generic Sources left-tab and MCP Sources panel shell;
- provider template, source, tool, policy, redaction, status, and facade contracts;
- deny-before-allow read-only policy helpers;
- fake-transport-testable facade seams;
- normalized tool catalog search/describe contracts;
- governed `mcp_readonly_call` execution boundary with audit metadata;
- thin agent bridge tool registry for the seven stable boring-mcp operations;
- server-only managed connector adapter seam with app-injected secret resolution.

It intentionally does **not** perform real connector-provider calls, OAuth, provider execution, secret storage, or app-specific environment binding in the foundation PR.

## Enable in an app

Static front composition is still required when a shipped app needs the UI to render:

```tsx
import { createBoringMcpPlugin } from '@hachej/boring-mcp/front'

const boringMcpPlugin = createBoringMcpPlugin({
  providers: [/* optional app provider templates */],
  enabledProviderIds: ['notion', 'airtable'],
  label: 'Sources',
})

<CoreWorkspaceAgentFront plugins={[boringMcpPlugin]} />
```

Server composition can use the server plugin once an app wants the boring-mcp prompt/seams at boot:

```ts
import { createBoringMcpServerPlugin } from '@hachej/boring-mcp/server'

createCoreWorkspaceAgentServer({
  plugins: [createBoringMcpServerPlugin()],
})
```

Apps may also list the package in `package.json#boring.defaultPluginPackages`, but core-based shipped apps should still statically compose front plugins when the UI must render.

## Security boundaries

Managed connector adapters must pass the [Composio security preflight](./docs/composio-security-preflight.md) and the executable `validateManagedConnectorPreflight` server check before real product provider calls. The generic `createManagedConnectorAdapter` seam accepts provider config plus an app-owned server secret resolver; reusable boring-mcp never binds app env/Vault details.

- Browser UI never receives provider OAuth tokens, connector API keys, or MCP session headers.
- Raw provider meta-tools are not exposed by this foundation.
- Unknown tools are disabled by default.
- Mutating/admin tool names are denied before any provider call.
- Provider results pass redaction and secret-leak checks before agent/UI use.

## Production launch gate / smoke checklist

Before enabling boring-mcp in a shipped app, operators should verify:

1. `evaluateBoringMcpLaunchGate` passes for the app composition: plugin id, registry list/get/disconnect, transport, provider templates, all seven bridge tools, timeout, rate/budget gate, readonly input limit, and reviewed docs.
2. Managed providers pass `validateManagedConnectorPreflight`; app secrets stay server-side and never appear in browser/workspace files.
3. Source list/status/probe/tool catalog/read-only call responses pass the secret-leak guard using representative OAuth/session canaries.
4. Provider metadata calls use timeout + retry policy; read-only tool calls use timeout but no automatic retry.
5. Rate/budget hooks block before provider `listTools`/`callTool` when local limits are exceeded.
6. Disconnect/revoke is verified through the injected registry status/result and never performs provider tool execution.
7. Local smoke with a fake managed connector: connect -> status connected -> search tools -> describe tool -> governed readonly call -> disconnect -> verify non-connected status.

## Current status

Foundation plus source handlers, executable preflight, generic managed connector adapter seam, normalized tool catalog search/describe, governed fake-transport-testable read-only execution, exported agent bridge tool definitions, and production launch-gate helpers. Real Composio SDK/API calls, route/app registration, and Constellation binding land in later PRs.
