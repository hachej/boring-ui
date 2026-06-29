# pi-mcp-adapter Notion MCP auth spike

Date: 2026-06-29

## Goal

Test whether `pi-mcp-adapter` / MCP SDK OAuth can handle Notion MCP authorization better than the Nango free self-host `notion-mcp` path.

## Isolation

Token storage was isolated to:

```txt
/tmp/pi-mcp-notion-oauth-spike
```

Temporary helper files were used under:

```txt
/tmp/pi-github-repos/nicobailon/pi-mcp-adapter/tmp-notion-auth-*.ts
/tmp/pi-mcp-notion-auth-url.txt
/tmp/pi-mcp-notion-redirect.txt
/tmp/pi-mcp-notion-auth.log
```

No production Pi auth directory was used.

## What worked

Calling `pi-mcp-adapter`'s `startAuth()` against:

```txt
https://mcp.notion.com/mcp
```

with OAuth enabled succeeded.

The adapter / MCP SDK performed dynamic client registration and generated a Notion MCP authorization URL containing:

- `client_id` from dynamic registration;
- PKCE `code_challenge`;
- loopback redirect URI;
- MCP resource parameter `https://mcp.notion.com/mcp`;
- state.

The user opened the authorization URL and Notion returned an authorization code.

This is a stronger result than the Nango `notion-mcp` free self-host spike, which failed before producing a working Notion authorization URL.

## What failed

The long-running helper process timed out before the authorization code was pasted back, so the in-memory pending MCP SDK transport was gone.

The stored auth file still had:

```txt
serverUrl=https://mcp.notion.com/mcp
clientInfo.clientId=<dynamic client id>
clientInfo.redirectUris=[http://localhost:<port>/callback]
codeVerifier=<present>
```

A direct token exchange was attempted using the stored dynamic client id, redirect URI, and PKCE verifier. Both form-encoded and JSON requests to:

```txt
https://mcp.notion.com/token
```

failed with Cloudflare:

```txt
HTTP 403
error_code=1010
error_name=browser_signature_banned
message=The site owner has blocked access based on your browser's signature.
```

This appears environmental: the sandbox can generate the auth URL and the user's browser can authorize, but server-side token exchange from this environment is blocked by Notion/Cloudflare.

## Interpretation

`pi-mcp-adapter` is a good building block for MCP-native OAuth:

- it generated a valid Notion MCP authorization URL;
- it handled dynamic client registration and PKCE;
- it models the right local/headless auth-start/auth-complete flow.

However, this sandbox could not complete Notion MCP token exchange due Cloudflare 1010. That means a hosted Constellation deployment must verify that its runtime egress is accepted by Notion MCP before relying on direct MCP OAuth.

## Constellation implication

For MCP-native providers, especially Notion MCP, a `pi-mcp-adapter`-style OAuth core plus a hosted DB-backed credential store is promising:

```txt
MCP OAuth core
  discovery / dynamic registration / PKCE / auth URL / token exchange / refresh

Storage adapters
  local file store for CLI mode
  encrypted DB store for hosted Constellation mode
```

But the hosted deployment must pass a provider egress test:

```txt
POST https://mcp.notion.com/register
POST https://mcp.notion.com/token
```

from the actual production/staging infrastructure.

## Next steps

- Retry with a fresh code while the helper is still waiting, to avoid manual direct exchange.
- If it still fails, confirm token exchange is blocked by environment egress rather than helper timeout.
- Test the same flow from intended deployment infrastructure.
- If Notion MCP blocks server-to-server exchange from our runtime, fallback to regular Notion OAuth/API first.
