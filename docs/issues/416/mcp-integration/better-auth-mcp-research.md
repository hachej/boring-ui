# Better Auth research for MCP / connector credential storage

Date: 2026-06-29

## Question

Can Better Auth serve as the encrypted credential store for Constellation `boring-mcp`, including MCP-native auth and outbound SaaS connector tokens?

## Findings

### Better Auth has an MCP plugin, but it is for inbound MCP auth

Better Auth docs/issues show an MCP plugin:

- docs: <https://better-auth.com/docs/plugins/mcp>
- issues/PRs include MCP OAuth metadata, OAuth 2.1 compliance, and refresh-token fixes.

The MCP plugin lets **your app act as an OAuth provider for MCP clients**. It helps when Constellation exposes its own MCP server and wants clients to authenticate to Constellation.

It does **not** solve the opposite problem by itself:

```txt
Constellation user connects to third-party MCP provider, e.g. Notion MCP
Constellation stores/refreshes the third-party provider token
boring-mcp calls the provider MCP server on behalf of the user
```

So Better Auth MCP plugin is relevant later if boring-ui/Constellation exposes an MCP server, but it is not the hosted outbound MCP credential broker we need for Notion MCP.

### Better Auth account table can store OAuth provider tokens

Better Auth account docs/options say OAuth account records store provider-returned data including access tokens, refresh tokens, scopes, etc.

Better Auth supports:

```ts
auth.api.getAccessToken({
  body: { providerId, accountId, userId },
  headers,
});
```

Docs say this returns a valid access token and refreshes if expired.

### Token encryption exists but is opt-in

Better Auth does **not** encrypt OAuth tokens by default. It provides:

```ts
account: {
  encryptOAuthTokens: true,
}
```

Docs/issues confirm token encryption support and fixes around encrypted token refresh. Production Constellation should enable this if Better Auth stores any provider tokens.

### Generic OAuth has known rough edges

Relevant findings from GitHub issues/docs:

- Generic OAuth supports `accessType: "offline"` and `accessTokenExpiresIn` for providers that omit `expires_in`.
- Issues discuss generic OAuth `getAccessToken` support and refresh-token behavior.
- Issue #9040 notes `getAccessToken()` cannot pass extra token params such as `resource`; workaround is direct DB token handling/manual refresh.
- Issue #7554 / PR #9948 discuss forwarding `refreshTokenParams` to the token endpoint.
- Issues mention refresh token expiry metadata not always updated and refresh-token edge cases.

Implication: Better Auth is good for normal social/provider OAuth, but we should be cautious using Generic OAuth for providers with unusual refresh/resource requirements, especially Microsoft resource/audience and MCP-specific OAuth.

## Recommendation

Use Better Auth where it naturally fits:

```txt
Better Auth
  users / sessions / orgs
  regular linked OAuth accounts
  encrypted OAuth tokens when provider flow is supported
```

Do not force MCP-native provider auth into Better Auth unless a specific provider flow is proven.

Use `boring-mcp` DB credential storage for MCP-native gaps:

```txt
MCP dynamic client registration metadata
PKCE verifier
OAuth state
pending source-bound auth rows
third-party MCP tokens when Better Auth cannot own/refresh them
```

Suggested credential provider matrix:

| Flow | Credential store |
| --- | --- |
| Regular social/provider OAuth supported by Better Auth | Better Auth account table with `encryptOAuthTokens: true` |
| Generic OAuth with simple refresh and no extra resource params | Better Auth Generic OAuth, after provider-specific spike |
| MCP-native OAuth, e.g. Notion MCP | `boring-mcp` encrypted DB store using MCP SDK/pi-mcp-adapter-derived auth core |
| Providers requiring special refresh/resource params Better Auth cannot handle | narrow Constellation credential store or Nango adapter |
| Constellation exposing its own MCP server | Better Auth MCP plugin may be useful for inbound client auth |

## Constellation plan impact

Keep `McpCredentialProvider` pluggable:

```txt
better-auth-account
mcp-db
nango
local-file
```

Enable Better Auth token encryption for any Better Auth-owned OAuth tokens. Store only source metadata and Better Auth account references in `boring-mcp` where possible.

For Notion MCP specifically, Better Auth is not the primary auth mechanism; the MCP SDK/pi-mcp-adapter-derived flow remains the preferred path.
