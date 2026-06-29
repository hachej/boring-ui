# Composio Notion live MCP PoC

Date: 2026-06-29

## Goal

Verify the real hosted V0 architecture with live Composio and Notion:

```txt
Composio owns provider OAuth / connector auth.
MCP SDK or pi-mcp-adapter-style client owns MCP protocol/tool plumbing.
Constellation owns governance facade: source ownership, policy, search/describe/call, audit, redaction.
```

## Secret handling

Composio API key was read from local HashiCorp Vault:

```txt
path: secret/agent/composio
field: api_key
```

The key value was not printed.

## Setup

Temporary local PoC project:

```txt
/tmp/composio-notion-poc
```

Installed:

```txt
@composio/core 0.13.1
@modelcontextprotocol/sdk
```

Created a Composio session:

```ts
const session = await composio.create('constellation-notion-poc-julien', {
  mcp: true,
  toolkits: ['notion'],
  manageConnections: { enable: true, waitForConnections: false },
});
```

Session result shape:

```txt
SESSION_ID=trs_N8_qyOFHF8c_
MCP_PRESENT=true
MCP_KEYS=headers,type,url
MCP_URL_PRESENT=true
MCP_HEADERS_KEYS=x-api-key
```

The live `session.mcp.url` and `session.mcp.headers` were written to temp files with mode `0600` and not committed.

## MCP connection through pi-mcp-adapter plumbing

Used `pi-mcp-adapter`'s `McpServerManager` with the Composio MCP URL and headers.

Result:

```txt
STATUS=connected
TOOL_COUNT=6
RESOURCE_COUNT=0
TOOLS_FIRST_50=COMPOSIO_MANAGE_CONNECTIONS,COMPOSIO_MULTI_EXECUTE_TOOL,COMPOSIO_REMOTE_BASH_TOOL,COMPOSIO_REMOTE_WORKBENCH,COMPOSIO_SEARCH_TOOLS,COMPOSIO_GET_TOOL_SCHEMAS
```

This proves a real Composio MCP session can be consumed by MCP SDK / pi-mcp-adapter-style Streamable HTTP client plumbing.

## Connection flow

Before user auth, `COMPOSIO_SEARCH_TOOLS` returned Notion tool metadata and reported:

```txt
has_active_connection=false
status_message=No Active connection for toolkit=notion. You MUST call COMPOSIO_MANAGE_CONNECTIONS ...
```

Called `COMPOSIO_MANAGE_CONNECTIONS` for `notion`, which generated a 10-minute Composio Connect link. Julien opened the link and completed Notion authorization.

After authorization, `COMPOSIO_SEARCH_TOOLS` reported:

```txt
has_active_connection=true
connected_account_id=ca_PZgk5gmJS5Y3
status=ACTIVE
workspace_name=<redacted>
account_type=PRIVATE
status_message=Connection is active and ready to use
```

## Tool discovery / schema quality

`COMPOSIO_SEARCH_TOOLS` for:

```txt
notion search pages read content fetch page
```

returned a rich plan and schemas for read-oriented tools, including:

```txt
NOTION_SEARCH_NOTION_PAGE
NOTION_GET_PAGE_MARKDOWN
NOTION_RETRIEVE_PAGE
NOTION_FETCH_DATA
NOTION_FETCH_BLOCK_CONTENTS
NOTION_FETCH_BLOCK_METADATA
NOTION_FETCH_DATABASE
NOTION_QUERY_DATABASE
```

The returned schema for `NOTION_SEARCH_NOTION_PAGE` included usable JSON schema fields such as:

```txt
query
page_size
filter_value
start_cursor
filter_properties
```

This is enough to populate `mcp_tools_search` and `mcp_tool_describe` from Composio metadata.

## Read-only execution

Called `COMPOSIO_MULTI_EXECUTE_TOOL` with:

```json
{
  "tools": [
    {
      "tool_slug": "NOTION_SEARCH_NOTION_PAGE",
      "arguments": {
        "query": "",
        "page_size": 3,
        "filter_value": "page"
      }
    }
  ],
  "thought": "Run a small read-only Notion page search to verify Composio MCP execution after connection.",
  "current_step": "verify_notion_readonly_search",
  "current_step_metric": "connection_smoke"
}
```

Result:

```txt
successful=true
success_count=1
error_count=0
tool_slug=NOTION_SEARCH_NOTION_PAGE
response.data.object=list
response.data.has_more=false
response.data.results.length=1
```

The result contained Notion page metadata. Page/user/workspace identifiers and URLs are sensitive enough for docs, so they are not copied here beyond the success summary above.

## Secret leak check

Checked the raw read-call result against the Composio MCP session header values.

Result:

```txt
HEADER_VALUE_LEAKS=none
```

This does not replace full redaction tests, but it confirms the live Composio MCP response did not echo the session API key/header value in this call.

## Interpretation

Live PoC validates the selected architecture:

```txt
boring-mcp → MCP SDK/pi-adapter-style client → Composio MCP endpoint → Notion
```

The system can avoid reinventing:

```txt
OAuth / token refresh / connected account lifecycle  → Composio
MCP Streamable HTTP client and tool-call plumbing    → MCP SDK / pi-mcp-adapter pattern
```

Constellation still needs to implement:

```txt
source registry and ownership
normalized tool catalog over Composio metadata
read-only allowlist and deny-before-allow policy
mcp_tools_search
mcp_tool_describe
mcp_readonly_call wrapper around COMPOSIO_MULTI_EXECUTE_TOOL
audit/redaction wrappers
provider-specific allowlist for Notion/Airtable/Microsoft
```

## Caveats / required follow-up

- Composio exposed broad meta-tools, including remote bash/workbench. Constellation must not expose those directly to agents in hosted V0.
- `COMPOSIO_MULTI_EXECUTE_TOOL` is marked destructive/open-world. The boring-mcp facade must enforce allowlisted read-only `tool_slug`s before calling it.
- Composio search output includes account/user/workspace metadata. Redaction/audit filtering must treat this as sensitive contextual data.
- Need equivalent live PoCs for Airtable and Microsoft/SharePoint.
- Need disconnect/revoke behavior verification.
- Need DPA/security/subprocessor/incident-history acceptance before production.
