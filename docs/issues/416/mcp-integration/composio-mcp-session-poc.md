# Composio MCP session compatibility PoC

Date: 2026-06-29

## Goal

Verify the intended V0 architecture can avoid reinventing both OAuth and MCP plumbing:

```txt
Composio owns provider OAuth / connector auth.
MCP SDK or pi-mcp-adapter-style client owns MCP protocol/tool plumbing.
Constellation owns governance facade: source ownership, policy, search/describe/call, audit, redaction.
```

Specifically, test whether pi-mcp-adapter can connect to a Composio-like MCP session endpoint using HTTP headers, list tools, inspect schemas, and call a read-only tool.

## Setup

Created a mock Composio-like MCP server in the local `pi-mcp-adapter` checkout:

```txt
/tmp/pi-github-repos/nicobailon/pi-mcp-adapter/tmp-composio-like-mcp-server.ts
```

The server uses the MCP TypeScript SDK Streamable HTTP server transport and requires a mock Composio-style session header:

```txt
url: http://127.0.0.1:45873/mcp
header: x-consumer-api-key: mock-composio-session-key
```

It exposes two mock tools:

```txt
airtable_search_records  # read-only candidate
airtable_create_record   # mutating tool, should be denied by boring-mcp facade before provider call
```

Created a client PoC using `pi-mcp-adapter`'s `McpServerManager`:

```txt
/tmp/pi-github-repos/nicobailon/pi-mcp-adapter/tmp-composio-mcp-client-poc.ts
```

The client config uses a URL MCP server plus headers:

```ts
await manager.connect('mock-composio', {
  url: 'http://127.0.0.1:45873/mcp',
  headers: {
    'x-consumer-api-key': 'mock-composio-session-key',
  },
});
```

## Result

Green.

Output:

```txt
MOCK_COMPOSIO_MCP_URL=http://127.0.0.1:45873/mcp
MOCK_COMPOSIO_MCP_HEADER=x-consumer-api-key:mock-composio-session-key
STATUS=connected
TOOLS=airtable_search_records,airtable_create_record
READ_TOOL_SCHEMA_KEYS=baseId,tableName,query
CALL_RESULT={"content":[{"type":"text","text":"{\"provider\":\"mock-composio\",\"action\":\"AIRTABLE_SEARCH_RECORDS\",\"baseId\":\"app_mock\",\"tableName\":\"Customers\",\"query\":\"Example\",\"records\":[{\"id\":\"rec_1\",\"fields\":{\"Name\":\"Example\"}}]}"}]}
```

## Interpretation

The moving pieces are compatible in principle:

```txt
Composio MCP session URL + headers
  can be consumed by
MCP SDK / pi-mcp-adapter-style HTTP client
  behind
Constellation boring-mcp governance facade
```

This means hosted V0 can avoid:

```txt
rebuilding OAuth/token refresh/revoke for supported connectors
rebuilding MCP Streamable HTTP client/discovery/tool-call plumbing
```

Constellation still needs to build only the governance/product layer:

```txt
source registry
workspace/user/company-context ownership
normalized tool catalog
read-only allowlist / deny-before-allow policy
mcp_tools_search
mcp_tool_describe
mcp_readonly_call
audit/redaction wrappers
Composio provider spikes and production gates
```

## Caveats

This was a mock Composio endpoint, not a live Composio session.

Still required:

- create a real Composio session with `session.mcp.url` and `session.mcp.headers`;
- verify pi/MCP SDK client connects to the real Composio MCP endpoint;
- verify Notion/Airtable/Microsoft tool metadata richness;
- verify read-only allowlist can be enforced before Composio calls;
- verify revoke/disconnect behavior;
- verify no raw provider tokens reach browser/agent/logs.

## Plan impact

This supports the selected architecture:

```txt
boring-mcp → MCP SDK/pi-adapter-style client → Composio MCP endpoint
```

as an acceptable implementation of `ComposioConnectorProvider`, while keeping this behind the thin connector seam.
