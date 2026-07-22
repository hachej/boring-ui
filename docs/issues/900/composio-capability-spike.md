# Composio full-catalog capability spike

Date: 2026-07-22  
Issue: #900  
Scope: live provider capability proof only; no customer tool/account execution and no product implementation

## Result

**Partial pass. Implementation remains stopped.**

A synthetic Composio user and disposable Sessions proved the full-catalog,
context-efficient wrapper shape. The available Vault key was sufficient for a
session-only catalog probe, but this run did **not** prove that the Composio
project is isolated. No customer account was selected, connected, or executed.

Every created Session was registered for cleanup before its MCP URL was trusted,
deleted in `finally`, and then verified absent with `GET ... -> 404`. The actual
sanitized run recorded `cleanupComplete: true`. No Session ID, MCP URL path,
header, API key, account row, schema body, search body, or tool output appears in
this document or the script output.

## Proved live

1. `POST /api/v3.1/tool_router/session` succeeds with:
   - `mcp: true`;
   - no `toolkits` field;
   - managed connection support; and
   - `workbench: { enable: false }`.
2. The returned config reported zero enabled-toolkit filters, and an unfiltered
   query returned GitHub app-native tools.
3. The Session reports workbench disabled and lists all four required
   non-sandbox meta-tools:
   - `COMPOSIO_SEARCH_TOOLS`;
   - `COMPOSIO_GET_TOOL_SCHEMAS`;
   - `COMPOSIO_MANAGE_CONNECTIONS`; and
   - `COMPOSIO_MULTI_EXECUTE_TOOL`.
4. `COMPOSIO_REMOTE_WORKBENCH` and `COMPOSIO_REMOTE_BASH_TOOL` are absent, and a
   direct call to the disabled bash name returns an MCP error.
5. Query-driven search returned one bounded GitHub result; exact schema retrieval
   returned both requested schemas.
6. A no-auth Hacker News toolkit correctly rejects connection-link creation as
   unnecessary (`400`, provider code `4326`) rather than creating a credential.
7. A Session pin to an intentionally invalid connected-account ID is rejected
   with a provider 4xx.
8. The live MCP origin was `https://backend.composio.dev`. The script rejects URL
   credentials, redirects, and every origin outside that exact allowlist before
   forwarding secrets.
9. Returned Session headers alone received `401`; MCP currently requires the
   operator API key. The successful retry forwarded it only to the exact reviewed
   Composio origin and recorded booleans, never the key or provider body.
10. API and MCP requests used a 15-second timeout, redirect rejection, and a
    512-KiB response cap. Search additionally rejects more than 10 result groups,
    and schema retrieval requests and requires exactly two schemas.

## Provider behavior that changes implementation

### Use the raw wire key `workbench`, not `sandbox`

The raw v3.1 API accepted and reported:

```json
{ "workbench": { "enable": false } }
```

The same automated run created a paired Session using the SDK-documented
`sandbox` alias; its returned raw config did not report workbench disabled
(`sandboxAliasIgnoredByRawApi: true`). The thin adapter must send the wire-schema
key and verify returned config plus tool list. Do not assume SDK aliases are
normalized by the raw endpoint.

### The operator key currently crosses the Session MCP boundary

The returned Session headers were insufficient; the live MCP endpoint required
`x-api-key`. Product code may send that key only after exact HTTPS origin
validation. A provider-returned arbitrary HTTPS URL is not enough.

### Raw execution must remain hidden

The full-catalog Session necessarily exposes `COMPOSIO_MULTI_EXECUTE_TOOL`.
Boring must keep the raw name unreachable and expose execution only through the
approval-gated host call. Search/schema may be used internally, but model input
cannot invoke raw execution around approval.

## Actual sanitized run record

Command exit: `0`  
Observed at: `2026-07-22T20:50:37.665Z`

```json
{
  "observedAt": "2026-07-22T20:50:37.665Z",
  "projectIsolationProved": false,
  "sessionCreated": true,
  "fullCatalogUnfiltered": true,
  "reportedToolkitFilterCount": 0,
  "sandboxDisabled": true,
  "metaToolControlRequired": true,
  "sessionHeadersSufficient": false,
  "sessionHeadersFailureStatus": 401,
  "rawApiKeyForwardedToMcp": true,
  "observedMcpOrigin": "https://backend.composio.dev",
  "searchWorked": true,
  "searchWasGitHubScoped": true,
  "searchResultCount": 1,
  "schemaWorked": true,
  "requestedSchemaCount": 2,
  "schemaCount": 2,
  "noAuthConnectionCorrectlySkipped": true,
  "invalidAccountPinRejected": true,
  "exactValidAccountPinProved": false,
  "listedMetaTools": [
    "COMPOSIO_GET_TOOL_SCHEMAS",
    "COMPOSIO_MANAGE_CONNECTIONS",
    "COMPOSIO_MULTI_EXECUTE_TOOL",
    "COMPOSIO_SEARCH_TOOLS"
  ],
  "reportedWorkbenchEnabled": false,
  "sandboxAliasIgnoredByRawApi": true,
  "cleanupComplete": true,
  "stopReason": "A dedicated Composio project and exact valid-account execution pinning with a disposable owned account are still required."
}
```

Meta-tool names and counts are capability metadata, not account/provider values.
Counts can evolve and are not acceptance constants.

## Remaining stop conditions

Implementation cannot start until both are true:

1. The owner creates or identifies a dedicated non-customer Composio project and
   stores its project key separately from the current generic key.
2. In that project, one disposable owned account proves exact execution pinning:
   - connect through a one-time hosted link;
   - create a Session with exact
     `connected_accounts: { github: [<owned-account-id>] }`;
   - verify the returned config pins that ID;
   - execute one harmless identity/read tool through Session MCP;
   - verify the selected account without logging its value;
   - prove a different-user/invalid pin fails; and
   - revoke the connection and delete/verify the Session.

## Reproduction

From a trusted operator shell, using a project key and synthetic Session only:

```bash
cd plugins/boring-mcp
COMPOSIO_SPIKE_ACKNOWLEDGE_SYNTHETIC_USER_ONLY=1 \
COMPOSIO_API_KEY="$(env -u VAULT_TOKEN vault kv get \
  -field=api_key secret/agent/composio)" \
pnpm spike:composio
unset COMPOSIO_API_KEY COMPOSIO_SPIKE_ACKNOWLEDGE_SYNTHETIC_USER_ONLY
```

The acknowledgement does not prove project isolation. It only confirms that the
operator intends this bounded Session/search/schema probe and will not connect
or execute an existing account.

## Sources

- <https://docs.composio.dev/docs/configuring-sessions>
- <https://docs.composio.dev/docs/managing-multiple-connected-accounts>
- <https://docs.composio.dev/reference/api-reference/tool-router/postToolRouterSession>
- <https://docs.composio.dev/reference/api-reference/tool-router/deleteToolRouterSessionBySessionId>
