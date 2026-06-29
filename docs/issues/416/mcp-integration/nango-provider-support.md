# Nango provider support check: Constellation targets

Date: 2026-06-29

Sources:

- local Nango `providers.yaml` fetched from `NangoHQ/nango` master during self-host spike: `/tmp/nango-selfhost-providers.yaml`;
- Nango docs pages for Airtable, Notion, Notion MCP, Microsoft, SharePoint Online.

## Summary

Nango has provider entries for all three Constellation target families:

| Target | Nango provider keys found | Auth modes | Proxy base | Notes |
| --- | --- | --- | --- | --- |
| Airtable | `airtable`, `airtable-pat` | OAuth2, API key/PAT | `https://api.airtable.com` | OAuth app path and PAT fallback both available. |
| Notion | `notion`, `notion-mcp`, `notion-scim` | OAuth2, MCP OAuth2, API key | `https://api.notion.com`, Notion MCP endpoints | Strongest fit: Nango has both regular Notion API OAuth and Notion MCP OAuth with dynamic client registration. |
| Microsoft / SharePoint | `microsoft`, `microsoft-tenant-specific`, `microsoft-oauth2-cc`, `sharepoint-online`, `sharepoint-online-oauth2-cc`, `sharepoint-online-v1` | OAuth2, OAuth2 client credentials, two-step legacy client assertion | `https://graph.microsoft.com`, SharePoint tenant URL for v1 | Multiple options. V2/Graph path is likely preferred for Constellation read-only SharePoint. |

## Airtable

### `airtable`

Registry excerpt:

```yaml
airtable:
  display_name: Airtable
  auth_mode: OAUTH2
  authorization_url: https://airtable.com/oauth2/v1/authorize
  token_url: https://airtable.com/oauth2/v1/token
  authorization_method: header
  proxy:
    base_url: https://api.airtable.com
```

Docs: <https://nango.dev/docs/api-integrations/airtable>

Docs mention a maintained guide for registering an Airtable OAuth app and pre-built syncs for bases, records, tables, views, and webhooks. Free self-host does **not** include Nango functions/syncs, but the provider auth/proxy entry is still relevant.

### `airtable-pat`

Registry excerpt:

```yaml
airtable-pat:
  display_name: Airtable (Personal Access Token)
  auth_mode: API_KEY
  proxy:
    base_url: https://api.airtable.com
    headers:
      authorization: Bearer ${apiKey}
```

Docs: <https://nango.dev/docs/integrations/all/airtable-pat>

Implication: if OAuth app setup is slow, PAT can be a local/internal fallback, but OAuth is better for Constellation users.

## Notion

### `notion`

Registry excerpt:

```yaml
notion:
  display_name: Notion
  auth_mode: OAUTH2
  authorization_url: https://api.notion.com/v1/oauth/authorize
  token_url: https://api.notion.com/v1/oauth/token
  authorization_params:
    response_type: code
    owner: user
  authorization_method: header
  body_format: json
  token_response_metadata:
    - workspace_id
  proxy:
    base_url: https://api.notion.com
    headers:
      notion-version: '2022-06-28'
```

Docs: <https://nango.dev/docs/api-integrations/notion>

Docs mention a maintained guide for registering a Notion OAuth app and pre-built syncs for content metadata, data sources, entries, templates, and users. Again, free self-host does not include functions/syncs, but auth/proxy is useful.

### `notion-mcp`

Registry excerpt:

```yaml
notion-mcp:
  display_name: Notion (MCP)
  categories:
    - mcp
  auth_mode: MCP_OAUTH2
  client_registration: dynamic
  authorization_url: https://mcp.notion.com/authorize
  token_url: https://mcp.notion.com/token
  registration_url: https://mcp.notion.com/register
  refresh_params:
    grant_type: refresh_token
```

Docs: <https://nango.dev/docs/api-integrations/notion-mcp>

Docs state Notion MCP uses OAuth 2.0 with dynamic client registration and requires no MCP app registration.

Important caveat: Nango's self-host feature table says **Nango MCP server** is not available in free self-host. That does not necessarily mean `MCP_OAUTH2` auth cannot be used, but it must be verified in a real Notion MCP OAuth spike.

### `notion-scim`

Registry excerpt:

```yaml
notion-scim:
  auth_mode: API_KEY
  proxy:
    base_url: https://api.notion.com/scim
    headers:
      authorization: Bearer ${apiKey}
```

This is likely admin/SCIM, not the primary Constellation read-content path.

## Microsoft / SharePoint

### `microsoft`

Registry excerpt:

```yaml
microsoft:
  display_name: Microsoft
  auth_mode: OAUTH2
  authorization_url: https://login.microsoftonline.com/common/oauth2/v2.0/authorize
  token_url: https://login.microsoftonline.com/common/oauth2/v2.0/token
  default_scopes:
    - offline_access
    - .default
  token_params:
    grant_type: authorization_code
  refresh_params:
    grant_type: refresh_token
  proxy:
    base_url: https://graph.microsoft.com
```

Docs: <https://nango.dev/docs/api-integrations/microsoft>

This is the generic Microsoft Graph OAuth path.

### `microsoft-tenant-specific`

Registry excerpt:

```yaml
microsoft-tenant-specific:
  auth_mode: OAUTH2
  authorization_url: https://login.microsoftonline.com/${connectionConfig.tenant}/oauth2/v2.0/authorize
  token_url: https://login.microsoftonline.com/${connectionConfig.tenant}/oauth2/v2.0/token
  default_scopes:
    - offline_access
  refresh_params:
    grant_type: refresh_token
  proxy:
    base_url: https://graph.microsoft.com
```

Likely useful for enterprise tenant-specific Constellation deployments.

### `sharepoint-online`

Registry excerpt:

```yaml
sharepoint-online:
  display_name: SharePoint Online (v2)
  alias: microsoft
  post_connection_script: onedrivePostConnection
```

Docs: <https://nango.dev/docs/api-integrations/sharepoint-online>

Docs state SharePoint Online v2 is aligned with Microsoft Graph API and includes sync templates for sites, drives, drive-items, lists, list-items, pages, etc. Free self-host does not include sync functions, but the provider entry confirms Nango models SharePoint Online.

### `sharepoint-online-oauth2-cc`

Registry excerpt:

```yaml
sharepoint-online-oauth2-cc:
  auth_mode: OAUTH2_CC
  token_url: https://login.microsoftonline.com/${connectionConfig.tenantId}/oauth2/v2.0/token
  token_params:
    grant_type: client_credentials
  proxy:
    base_url: https://graph.microsoft.com
```

Docs: <https://nango.dev/docs/integrations/all/sharepoint-online-oauth2-cc>

This is app-only/client-credentials. It may fit company-wide context if Constellation needs an app-owned SharePoint source rather than per-user delegated access.

### `sharepoint-online-v1`

Registry excerpt:

```yaml
sharepoint-online-v1:
  auth_mode: TWO_STEP
  token_url: https://login.microsoftonline.com/${connectionConfig.tenantId}/oauth2/token
  token_params:
    resource: https://${connectionConfig.tenantId}.sharepoint.com
  proxy:
    base_url: https://${connectionConfig.tenantName}.sharepoint.com
```

Docs describe v1 as older SharePoint REST API. Prefer v2/Graph unless a client requires legacy SharePoint REST behavior.

## Recommendation

Nango appears to support all three target provider families at the provider-registry/docs level.

Preferred Constellation paths to spike next:

1. **Notion**: `notion-mcp` if free self-host can run the MCP OAuth auth mode without Nango MCP server; otherwise regular `notion` OAuth + direct Notion API/MCP separately.
2. **Airtable**: `airtable` OAuth; `airtable-pat` only as fallback/internal bootstrap.
3. **SharePoint/Microsoft**: start with `sharepoint-online` / Microsoft Graph delegated OAuth for user-owned sources; consider `sharepoint-online-oauth2-cc` for company-owned context sources.

Unproven until real provider OAuth spike:

- refresh/revoke behavior for each provider;
- whether `notion-mcp` works in free self-host despite free self-host lacking Nango MCP server;
- exact scopes required for read-only Constellation;
- Connect UI wording for each provider;
- production allowlist outbound policy for provider domains.
