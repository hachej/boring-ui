# `@hachej/boring-mcp`

Reusable boring-ui MCP/Sources plugin foundation.

This package is the generic MCP capability that child apps can enable. It owns:

- generic Sources left-tab and MCP Sources panel shell;
- provider template, source, tool, policy, redaction, status, and facade contracts;
- deny-before-allow read-only policy helpers;
- reusable Composio managed connector provider for hosted OAuth/session onboarding;
- MCP SDK Streamable HTTP transport for real MCP-compatible endpoints, including Composio session MCP URLs;
- fake-transport-testable facade seams;
- normalized tool catalog search/describe contracts;
- governed `mcp_readonly_call` execution boundary with audit metadata;
- thin agent bridge tool registry for the seven stable boring-mcp operations;
- server-only managed connector adapter seam with app-injected secret resolution.

It intentionally does **not** own app-specific secret storage or app identity. Apps provide the Composio API key resolver, source persistence, enabled provider config, and actor resolution; boring-mcp owns generic Composio session creation, hosted connect URL creation, MCP protocol transport, catalog, policy, bridge tools, redaction, and read-only execution path.

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

Server composition can enable just the prompt, or the full generic bridge tool stack. For hosted Composio-backed sources, the app supplies only source persistence, the server-side API key resolver, enabled provider config, and actor resolution:

```ts
import {
  createBoringMcpServerPlugin,
  createComposioManagedConnectorProvider,
  createComposioMcpTransport,
  createManagedConnectorAdapter,
} from '@hachej/boring-mcp/server'

const configs = [
  { provider: 'notion', displayName: 'Notion', toolkitId: 'notion', connectUrlOrigins: ['https://app.composio.dev'] },
]
const secretResolver = {
  async resolveSecret() {
    return { storage: 'server-env' as const, value: process.env.COMPOSIO_API_KEY! }
  },
}

const connector = createManagedConnectorAdapter({
  registry: mcpSourceRegistry,
  provider: createComposioManagedConnectorProvider(),
  secretResolver,
  configs,
  preflightEvidence,
})

const transport = createComposioMcpTransport({ secretResolver, configs })

createCoreWorkspaceAgentServer({
  plugins: [createBoringMcpServerPlugin({
    registry: mcpSourceRegistry,
    transport,
    resolveActor: async (_params, ctx) => resolveActorForAgentSession(ctx.sessionId),
  })],
})
```

When `registry`, `transport`, and `resolveActor` are provided, the plugin contributes the seven stable agent tools automatically: `mcp_servers_list`, `mcp_server_status`, `mcp_server_doctor`, `mcp_server_probe`, `mcp_tools_search`, `mcp_tool_describe`, and `mcp_readonly_call`.

For non-Composio MCP endpoints, apps can still use `createMcpSdkStreamableHttpTransport({ endpoint })` directly.

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
8. Protocol smoke with a fake Streamable HTTP MCP server: real MCP SDK client transport -> list tools -> describe -> governed readonly call -> block mutating tool -> disconnect blocks future call.
9. Composio smoke with fake Composio HTTP API + fake MCP server: create session -> hosted connect URL -> session MCP headers -> search/readonly call -> raw `COMPOSIO_*` meta-tools hidden.

## Current status

Reusable boring-mcp now includes source handlers, executable preflight, generic managed connector adapter seam, reusable Composio managed connector provider, MCP SDK Streamable HTTP transport, normalized tool catalog search/describe, governed read-only execution, exported/generic agent bridge tools, and production launch-gate helpers. Real app secret binding remains app-owned; Constellation-specific code is not required for the generic MCP feature to run against Composio or another MCP-compatible endpoint.
