# `@hachej/boring-mcp`

Reusable boring-ui MCP/Sources plugin foundation.

This package is the generic MCP capability that child apps can enable. It owns:

- generic Sources left-tab and MCP Sources panel shell;
- provider template, source, tool, policy, redaction, status, and facade contracts;
- deny-before-allow read-only policy helpers;
- fake-transport-testable facade seams.

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

- Browser UI never receives provider OAuth tokens, connector API keys, or MCP session headers.
- Raw provider meta-tools are not exposed by this foundation.
- Unknown tools are disabled by default.
- Mutating/admin tool names are denied before any provider call.
- Provider results pass redaction and secret-leak checks before agent/UI use.

## Current status

Foundation only. Real connector providers, route registration, agent bridge tools, and provider execution land in later PRs.
