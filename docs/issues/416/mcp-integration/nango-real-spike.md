# Nango real isolated spike

Date: 2026-06-29

## Goal

Understand what self-hosted Nango actually gives Constellation for provider credential lifecycle, user-facing Connect UI, credential storage, and proxy credential injection.

## Scope

This spike avoided real Notion/Airtable/Microsoft credentials. It used:

- local self-hosted Nango;
- Nango `private-api-generic` provider;
- a local mock provider container on the same Docker network;
- dummy API-key credentials.

This proves API-key connection and proxy behavior, not OAuth refresh behavior.

## Setup

Nango throwaway directory:

```txt
/tmp/nango-selfhost-poc
```

Mock provider:

```txt
/tmp/nango-mock-provider.py
```

Relevant local services:

```txt
Nango server:     http://localhost:3003
Nango Connect UI: http://localhost:3009
Mock provider:    http://nango-mock-provider:38991 inside Docker network
```

Important config needed for local self-host:

```txt
NANGO_ENCRYPTION_KEY=<base64 256-bit throwaway key>
NANGO_SERVER_URL=http://localhost:3003
NANGO_PUBLIC_SERVER_URL=http://localhost:3003
FLAG_SERVE_CONNECT_UI=true
NANGO_PUBLIC_CONNECT_URL=http://localhost:3009
NANGO_CONNECT_UI_PORT=3009
```

For the local mock provider only, the spike temporarily relaxed Nango's outbound URL policy:

```txt
NANGO_PROXY_BASE_URL_OVERRIDE_ENABLED=true
NANGO_OUTBOUND_URL_POLICY={"mode":"permissive","blockPrivateIps":false,"blockLinkLocal":true,"maxRedirects":3}
```

Do not use that permissive policy in production.

## Findings

### 1. Local API access works

The Nango self-host DB created default encrypted customer API keys. For this throwaway instance, the local API key was recovered by decrypting the local `customer_keys` row with the generated `NANGO_ENCRYPTION_KEY`.

No real secrets were used. Do not rely on DB decryption for production operations; production should create/manage keys through Nango's UI or admin process.

Authenticated API probe:

```txt
GET /integrations -> 200 {"data":[]}
```

### 2. Integration creation works through backend API

Created integration:

```json
{
  "unique_key": "constellation-docker-mock",
  "provider": "private-api-generic",
  "display_name": "Constellation Docker mock",
  "integration_config": {
    "keyPlacement": "header",
    "keyName": "X-Test-Api-Key",
    "valueTemplate": "Token ${apiKey}",
    "baseUrl": "http://nango-mock-provider:38991",
    "keyLabel": "Test API key"
  }
}
```

Nango response included:

```txt
unique_key=constellation-docker-mock
provider=private-api-generic
credentials_label.apiKey=Test API key
```

### 3. Importing an existing connection works

Imported connection:

```json
{
  "provider_config_key": "constellation-docker-mock",
  "connection_id": "local-user-docker-mock",
  "credentials": { "type": "API_KEY", "apiKey": "dummy-secret-for-nango-spike" },
  "tags": {
    "end_user_id": "local-user",
    "organization_id": "constellation-local"
  }
}
```

Response included raw dummy credentials. Implication: Constellation backend must treat Nango API responses as secret-bearing and redact logs.

### 4. Credentials are encrypted at rest

DB check on `_nango_connections` showed encrypted credential payloads plus IV/tag:

```txt
credentials = {"encrypted_credentials":"..."}
credentials_iv is not null
credentials_tag is not null
```

This confirms `NANGO_ENCRYPTION_KEY` causes Nango to encrypt stored connection credentials for this path.

### 5. Proxy credential injection works

Nango Proxy call:

```txt
GET /proxy/headers?from=ui-connection
Authorization: Bearer <local-nango-api-key>
Provider-Config-Key: constellation-docker-mock
Connection-Id: <connection-id>
```

Mock provider observed:

```json
{
  "x-test-api-key": "Token ui-entered-secret"
}
```

This proves Nango can inject stored credentials server-side via Proxy without the browser/agent seeing provider credentials.

### 6. Connect UI works, but has visible Nango branding/default UI

A Connect session was created via:

```txt
POST /connect/sessions
allowed_integrations=["constellation-docker-mock"]
tags={end_user_id, organization_id}
```

Response included:

```txt
token=nango_connect_session_...
connect_link=http://localhost:3009/?session_token=...
expires_at=+30 minutes
```

Important self-host detail: the generated `connect_link` alone rendered as expired because the Connect UI bundle defaulted to `https://api.nango.dev`. Passing the local API URL fixed it:

```txt
http://localhost:3009/?session_token=...&apiURL=http://localhost:3003
```

Rendered UI text for API-key provider:

```txt
Link Constellation Docker mock Account
Test API key *
Connect

Need help? View connection guide

Secured by
```

After entering a dummy key and submitting:

```txt
Success!

You've successfully set up your Private API (Generic) integration. You can now close this tab.

Secured by
```

Implications:

- Free self-host Connect UI is Nango's default UI, not fully Constellation-branded.
- The flow exposes some Nango-flavored language such as `Secured by` and generic provider naming unless carefully configured.
- For a polished client-facing app, Constellation may want a custom wrapper or provider-specific OAuth buttons.

### 7. UI-created connection works

Connect UI created a UUID connection ID:

```txt
connection_id=6ec109c1-91ab-4f4f-a957-9f8ce5b65c8b
provider_config_key=constellation-docker-mock
```

Backend `GET /connections/:connectionId?provider_config_key=...` returned raw credentials:

```json
{
  "credentials": {
    "type": "API_KEY",
    "apiKey": "ui-entered-secret"
  },
  "tags": {
    "end_user_id": "local-user",
    "organization_id": "constellation-local"
  }
}
```

Proxying with that connection ID injected the UI-entered secret into the mock provider request.

## What this proves

Nango self-host free can provide a real credential lifecycle substrate for **Auth + Proxy** style connections:

- integration registry;
- connect session creation;
- hosted/default Connect UI;
- API-key credential collection;
- encrypted credential storage;
- connection IDs and tags;
- backend credential retrieval;
- server-side credential injection through Proxy.

For Constellation, this maps cleanly to:

```txt
Constellation source record
  providerConfigKey
  connectionId
  sourceId
  workspaceId/userId

boring-mcp facade
  uses connectionId as credentialRef
  calls Nango Proxy or getConnection server-side
  enforces MCP/tool policy itself
```

## What this does not prove

Still unproven:

- real OAuth flow for Notion/Airtable/Microsoft;
- refresh token rotation;
- revoke/disconnect semantics;
- provider-specific scopes and Microsoft resource/audience quirks;
- whether official Notion/Airtable/Microsoft providers in Nango match Constellation's MCP needs;
- production-grade branding/custom UI in free self-host;
- production dashboard hardening, backup/restore, metrics, and key rotation story.

## Security notes

- Nango API responses can include raw credentials. Treat Nango backend API as secret-bearing.
- Prefer Nango Proxy when possible so Constellation code does not need raw provider tokens.
- If `getConnection` is used, only the server-side credential provider/facade may call it, and responses must pass redaction/log guards.
- Production must not use permissive outbound URL policy. Use allowlist mode for provider domains.
- Production must secure Nango dashboard/API behind private network/auth.

## Recommendation after spike

Nango is more compelling after the real spike than after docs-only review, but it should still be optional behind `McpCredentialProvider`.

Good reason to use Nango:

- future integration velocity;
- common Connect UI/session flow;
- encrypted connection storage;
- Proxy injection path;
- connection IDs/tags map well to Constellation sources.

Reasons to avoid or delay:

- extra service/operator burden;
- ELv2/source-available license;
- free self-host lacks custom branding, RBAC, webhooks, functions, MCP server, and full observability;
- raw credentials are retrievable by backend API, so Constellation still needs strict secret handling;
- real OAuth refresh/revoke for target providers is still unproven.

Decision rule:

```txt
If the next OAuth spike proves Notion/Airtable/Microsoft refresh/revoke works cleanly in free self-host, use Nango as Constellation's hosted credential provider.
Otherwise build a narrow Constellation token broker for the first providers and keep Nango as a future adapter.
```
