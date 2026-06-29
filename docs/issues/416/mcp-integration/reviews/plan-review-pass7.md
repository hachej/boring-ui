# Plan review pass 7 — GREEN

Date: 2026-06-29

Scope: rewritten `docs/issues/416/mcp-integration/plan.md` and updated README.

## Verdict

GREEN.

The pass 6 blockers are resolved. `plan.md` is now a canonical implementation handoff rather than an append-only decision log.

## Checks

### 1. Contradictory backend decisions resolved

Pass.

The plan now states one current decision:

```txt
Hosted V0 default: ComposioConnectorProvider
Future/private fallback: native/self-custody providers behind interfaces
```

Older Nango/Infisical/agent.pw/custom SecretStore findings are explicitly research/fallback/history and no longer active V0 instructions.

### 2. Document size and shape improved

Pass.

`plan.md` is reduced to 596 lines and organized as:

- current decision;
- source-of-truth rule;
- goals/non-goals;
- architecture;
- canonical V0 tool surface;
- Composio mapping;
- search/describe/call/materialization;
- provider policy;
- interfaces;
- SecretStore fallback;
- security/audit gates;
- implementation sequence;
- acceptance criteria.

This is now usable as an implementation plan.

### 3. Composio V0 execution boundary is clear

Pass.

The plan clearly says Composio owns hosted V0 connector auth/tool execution while Constellation owns governance, normalized catalog, search/describe/call, audit, redaction, and read-only policy.

### 4. Tool search/materialization abstraction survives Composio

Pass.

The normalized `NormalizedConnectorTool` with `nativeRef.provider = 'composio'` gives a clean adapter seam. V2 materialized tools remain sugar over `mcp_readonly_call`, so they will not bypass policy.

### 5. Credential-provider language is cleaned up

Pass.

Hosted V0 uses:

```txt
ConnectorCredentialProvider
ConnectorToolProvider
```

`SecretStore` is scoped to BYO LLM/private/fallback needs.

### 6. Security gates are first-class

Pass.

Composio production gates now include provider spikes, read-only allowlist enforcement, isolation, revoke/disconnect, no raw token exposure, audit/redaction, DPA/subprocessor/data-residency, incident-history acceptance, and fallback documentation.

## Residual implementation risks

These are not plan blockers but must be verified during implementation:

1. Composio provider metadata may not expose enough schema/action detail for our desired `mcp_tool_describe`; spike must verify.
2. Read-only classification may be imperfect across Composio actions; start with explicit allowlists for Notion/Airtable/Microsoft.
3. Composio audit/export metadata may be insufficient; Constellation may need wrapper audit events around every call.
4. Microsoft/SharePoint connector semantics may vary by tenant/scopes; spike must validate real refresh/revoke and least-privilege scopes.
5. BYO LLM SecretStore remains future work; do not accidentally route BYO LLM keys through Composio.

## Approval

Approved for implementation planning. Next work should be a Composio provider spike, not more plan churn.
