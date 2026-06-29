# Nango self-host PoC for Constellation MCP auth

Date: 2026-06-29

## Question

Can Nango help Constellation avoid building OAuth/token refresh/revoke lifecycle for MCP provider access while keeping private/company data off a third-party managed broker?

## Doc finding

Source reviewed: <https://nango.dev/docs/guides/platform/self-hosting#feature-availability>

Free self-hosted feature availability:

| Feature | Free self-hosted | Enterprise self-hosted / Nango Cloud |
| --- | --- | --- |
| Auth | Yes | Yes |
| Proxy | Yes | Yes |
| Observability | Auth + proxy only | Full |
| OpenTelemetry export | No | Yes |
| Functions | No | Yes |
| Webhooks | No | Yes |
| MCP server | No | Yes |
| Customize auth branding | No | Yes |
| Role-based permissions | No | Yes |
| SAML SSO | No | On roadmap |
| Support SLA | No | Yes |

Important implications:

- Free self-host may be enough for Constellation's credential-provider use case if we only need Auth + Proxy.
- Free self-host does **not** provide Nango's MCP server feature.
- Enterprise self-host is required for the full feature set and support.
- `NANGO_ENCRYPTION_KEY` is required for encrypted credential storage; without it, credentials are stored unencrypted.
- Connect UI is available in self-hosted deployments via the main Docker image.

## Local smoke

Throwaway directory:

```txt
/tmp/nango-selfhost-poc
```

Commands used:

```bash
mkdir -p /tmp/nango-selfhost-poc
cd /tmp/nango-selfhost-poc
curl -fsSL https://raw.githubusercontent.com/NangoHQ/nango/master/docker-compose.yaml -o docker-compose.yaml
# wrote .env with NANGO_ENCRYPTION_KEY, NANGO_SERVER_URL=http://localhost:3003,
# FLAG_SERVE_CONNECT_UI=true, NANGO_PROXY_BASE_URL_OVERRIDE_ENABLED=false,
# NANGO_LOGS_ENABLED=false
curl -fsSL https://raw.githubusercontent.com/NangoHQ/nango/master/packages/providers/providers.yaml -o /tmp/nango-selfhost-providers.yaml
# patched compose provider mount to /tmp/nango-selfhost-providers.yaml
# patched DB/Redis host ports to avoid local conflicts
docker compose up -d
```

Ports had to be adjusted because local 5432 and 55432 were already occupied:

```txt
Postgres host port: 33263 -> container 5432
Redis host port:    53653 -> container 6379
Nango server:       3003
Nango Connect UI:   3009
```

Upstream `docker-compose.yaml` expects `./packages/providers/providers.yaml` next to the compose file. Because this was not a full repo clone, the PoC fetched the provider registry separately and mounted it into the container.

Smoke results:

```txt
GET http://localhost:3003          -> 200 text/html dashboard
GET http://localhost:3003/health   -> 200 {"result":"ok"}
GET http://localhost:3009          -> 200 text/html Connect UI
```

Docker services reached healthy/running state:

```txt
nango-db       postgres:16.0-alpine          Up
nango-redis    redis:7.2.4                   Up
nango-server   nangohq/nango-server:hosted   Up, ports 3003 and 3009
```

Warnings observed:

- `ORB_API_KEY` not set: billing warning, expected for local/free smoke.
- logs storage disabled: expected because `NANGO_LOGS_ENABLED=false`.
- update check failed warning: non-blocking.

Containers were stopped after the smoke with `docker compose stop`; files remain in `/tmp/nango-selfhost-poc`.

## What the smoke did not prove

The smoke did not complete a real OAuth connection because that requires a configured Nango integration and API key/session token.

Docs indicate the production embed flow is:

1. Backend creates a short-lived Connect session using a Nango API key with `environment:connect_sessions:write`.
2. Frontend opens Connect UI with that session token.
3. User authorizes provider.
4. Nango stores credentials.
5. Constellation stores the provider config key / integration ID + connection ID as a credential reference.
6. Backend retrieves credentials via `getConnection(providerConfigKey, connectionId)` or routes API calls through Nango Proxy.

## Constellation fit

Recommended use if selected:

```txt
Better Auth
  users / sessions / orgs

Self-hosted Nango
  provider OAuth connections
  token storage / refresh
  optional Proxy

boring-mcp
  source ownership
  search / describe / readonly_call
  tool policy / materialization
  redaction / audit
```

Credential ref shape:

```ts
interface NangoCredentialRef {
  provider: 'nango';
  providerConfigKey: string; // Nango integration ID / unique key
  connectionId: string;
}
```

`boring-mcp` should not depend on Nango directly. It should depend on `McpCredentialProvider`; Constellation can provide a `NangoMcpCredentialProvider`.

## Recommendation

Nango self-host is a credible candidate for Constellation's provider-token lifecycle, but only as **Auth + Proxy**, not as the MCP control plane in free self-host.

Next spike before committing:

- create one local Nango integration;
- create an API key/session token;
- complete one OAuth or API-key connection;
- verify `getConnection(providerConfigKey, connectionId)` returns/refreshes credentials;
- verify Proxy can call a harmless endpoint;
- verify encrypted-at-rest behavior with `NANGO_ENCRYPTION_KEY` set;
- decide whether free self-host feature limits are acceptable for Constellation.
