# Composio full-catalog capability spike

Date: 2026-07-22
Issue: #900
Scope: live provider capability proof only; no customer tool/account execution and no product implementation

## Result

**Pass after owner project selection and the valid-account follow-up. Slice
900.1 implementation may proceed.**

The initial synthetic-user Session probe proved the full-catalog,
context-efficient wrapper shape but intentionally stopped before account
execution. On 2026-07-24 the owner selected the existing Composio project and
a separate follow-up proved exact, owned, single-account Session pinning with a
temporary GitHub connection. No customer account was selected or executed.

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

## Owner project decision

On 2026-07-24 the owner confirmed that the existing key at
`secret/agent/composio` is the Composio project intended for this Seneca work.
This resolves the product/project selection gate. It is an owner attestation,
not a claim that the API can prove organizational isolation.

## Exact valid-account pin proof

After the owner authorized a temporary GitHub connection for the synthetic
spike user, the server-side proof ran one harmless authenticated-profile read.
It never printed the account ID, profile value, MCP URL/header, OAuth material,
or tool output.

Observed at: `2026-07-24T18:42Z`
Command exit: `0`

```json
{
  "connectedAccountFound": true,
  "connectedAccountUnique": true,
  "pinnedSessionCreated": true,
  "returnedConfigPinnedExactAccount": true,
  "crossUserInvalidPinRejected": true,
  "githubIdentityToolSelected": true,
  "githubIdentityReadSucceeded": true,
  "explicitAccountArgumentSupported": false,
  "executionResponseReferencedPinnedAccount": false,
  "accountRevokedAndVerified": true,
  "sessionsDeletedAndVerified": true,
  "cleanupComplete": true,
  "exactValidAccountPinProved": true
}
```

The MCP execution meta-tool did not accept an explicit per-call account field and
did not echo the account ID. Account identity was instead bound and verified at
the Session boundary:

1. the Session request pinned exactly one owned account with
   `connected_accounts`;
2. returned Session config preserved that exact ID;
3. the same account ID under a different Composio user was rejected;
4. the pinned Session completed the harmless GitHub identity read; and
5. Composio's documented precedence selects `connectedAccounts` before every
   other account source.

Cleanup revoked the temporary connected account, verified it absent, deleted
both original and pinned Sessions, and verified both returned `404`. The Vault
link is overwritten with `REVOKED` and status `completed-revoked`.

## Gate outcome

The two pre-implementation stop conditions are resolved by owner project
selection plus the exact valid-account proof above. Slice 900.1 may proceed with
these mandatory implementation requirements:

- raw wire `workbench: { enable: false }`;
- exact MCP origin allowlist before forwarding the project key;
- exact user/toolkit filtering of any connected-account result;
- Session-level `connected_accounts` pinning and drift invalidation;
- no raw multi-execute exposure; and
- bounded, redacted, cleanup-verified provider calls.

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
