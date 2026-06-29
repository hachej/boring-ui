# Nango `notion-mcp` free self-host spike

Date: 2026-06-29

## Goal

Verify whether free self-hosted Nango can use the `notion-mcp` provider enough to start Notion MCP OAuth, before requiring a real Notion account login/consent.

## Result

**Not green yet.**

Nango free self-host can create a `notion-mcp` integration record and render the Connect UI, but the tested backend/API path failed before reaching Notion OAuth.

## What worked

Created integration via Nango public backend API:

```json
{
  "unique_key": "constellation-notion-mcp-test",
  "provider": "notion-mcp",
  "display_name": "Constellation Notion MCP test"
}
```

Response:

```txt
200 OK
provider=notion-mcp
logo=http://localhost:3003/images/template-logos/notion-mcp.svg
```

Created Connect session:

```txt
POST /connect/sessions
allowed_integrations=["constellation-notion-mcp-test"]
```

Rendered Connect UI with local API URL:

```txt
http://localhost:3009/?session_token=...&apiURL=http://localhost:3003
```

Visible UI text:

```txt
Link Constellation Notion MCP test Account
We'll connect you to Constellation Notion MCP test.
Connect
Secured by
```

## What failed

Clicking `Connect` did not redirect to Notion. It stayed in Nango Connect UI and showed:

```txt
Connection failed

An error occurred during authorization. Please reach out to our support team.

Provider Config "constellation-notion-mcp-test" is missing client ID, secret and/or scopes.
```

No Notion account login/consent happened. Julien's Notion account was not needed yet.

## Root cause found

The Nango `notion-mcp` provider declares:

```yaml
notion-mcp:
  auth_mode: MCP_OAUTH2
  client_registration: dynamic
  authorization_url: https://mcp.notion.com/authorize
  token_url: https://mcp.notion.com/token
  registration_url: https://mcp.notion.com/register
  refresh_params:
    grant_type: refresh_token
```

Nango source code shows dynamic client registration is implemented in the **private/dashboard v1 integration creation path**:

```ts
if (provider.auth_mode === 'MCP_OAUTH2') {
  const clientRegistration = provider.client_registration;
  if (clientRegistration === 'dynamic') {
    const mcpRegistration = await mcpClient.registerClientId({ provider, environment, team: account });
    config.oauth_client_id = mcpRegistration.client_id;
    config.oauth_client_secret = mcpRegistration.client_secret || '';
  }
}
```

But the public `/integrations` API path used in the spike created the config without dynamic registration. DB inspection confirmed:

```txt
unique_key=constellation-notion-mcp-test
provider=notion-mcp
oauth_client_id=null
oauth_client_secret=null
oauth_scopes=null
```

So Connect UI correctly failed because the provider config lacked client id/secret/scopes.

## Attempted workaround

Tried to call Notion MCP dynamic client registration directly:

```http
POST https://mcp.notion.com/register
{
  "redirect_uris": ["http://localhost:3003/oauth/callback"],
  "token_endpoint_auth_method": "none",
  "client_name": "Constellation local - prod - Notion MCP"
}
```

Result:

```txt
HTTP 403
error code: 1010
```

Likely Cloudflare/bot protection from this environment or a registration-policy issue. This means the direct workaround was not usable from the current sandbox.

## Interpretation

This does **not** prove free self-host cannot support `notion-mcp`.

It proves only:

1. The simple public API integration creation path is insufficient for `notion-mcp` dynamic registration.
2. The current local/sandbox environment could not directly register a Notion MCP OAuth client due HTTP 403.
3. We did not reach the stage where a Notion user account can authorize.

Possible ways `notion-mcp` could still work:

- create the integration through Nango dashboard/private v1 path, which runs dynamic registration;
- provide an already-registered client id/secret/scopes if Notion supports static registration for this flow;
- use Nango Cloud/Enterprise if their managed path bypasses the self-host/public API limitation;
- use regular `notion` OAuth instead of `notion-mcp` for V0.

## Constellation implication

Do **not** assume Nango free self-host gives Notion MCP OAuth out of the box through backend API.

For V0, safer options are:

1. Use regular Nango `notion` OAuth + Notion REST/API access first.
2. Implement/own Notion MCP OAuth in `boring-mcp` if Notion MCP is mandatory.
3. Keep `notion-mcp` as an experimental path until dashboard/private integration creation or direct dynamic registration is proven.

## Next verification options

- Try creating `notion-mcp` from the Nango dashboard UI instead of public API and inspect whether `oauth_client_id` gets populated.
- Try Notion dynamic client registration from a normal browser/network, not this sandbox, to see if HTTP 403 is environmental.
- Ask Nango docs/support whether `MCP_OAUTH2` providers work in free self-host and which API shape should be used to create them programmatically.
- If a real Notion account test is desired, first produce a working authorization URL; only then user login/consent matters.
