# Plan review pass 6 — RED

Date: 2026-06-29

Scope: `docs/issues/416/mcp-integration/plan.md` after the Composio/Nango/SecretStore decision discussion.

## Verdict

RED. The underlying direction is now good, but the plan document is no longer maintainable as the source of truth.

## Findings

### 1. Append-only decision history creates contradictory current guidance — blocker

The plan contains all historical decisions as if they are active:

- embedded `EncryptedPostgresSecretStore` selected for V0;
- `agent.pw` selected for a spike before custom store;
- `agent.pw` demoted because too niche;
- `InfisicalSecretStore` preferred;
- Composio optional;
- Composio-first hosted V0 selected.

A future implementer could reasonably choose the wrong backend because multiple sections use current-tense decision language.

Required fix: rewrite `plan.md` as the canonical current plan and move history to linked research docs.

### 2. The document is too large for an implementation handoff — blocker

`plan.md` is ~1.4k lines and mixes:

- implementation plan;
- research log;
- review amendments;
- vendor comparison;
- low-level interface sketches;
- historical spikes.

This is hostile to execution. The plan should be a short source of truth; evidence belongs in separate files.

Required fix: keep `plan.md` concise and reference research files.

### 3. V0 execution boundary is unclear after Composio decision — blocker

The canonical V0 bridge tools still read as MCP-native, but hosted V0 is now Composio-first. The plan must say exactly how:

```txt
mcp_tools_search / describe / readonly_call
```

map to Composio toolkits/actions/sessions, and what Constellation still owns.

Required fix: define normalized tool catalog over Composio native refs.

### 4. Credential-provider language is inconsistent — high

The plan uses `McpCredentialProvider`, `McpOAuthStore`, `SecretStore`, and `ConnectorCredentialProvider` without saying which is canonical for hosted V0.

Required fix: make `ConnectorCredentialProvider` + `ConnectorToolProvider` canonical for hosted V0; keep `SecretStore` for BYO LLM/private/fallback.

### 5. Security gates need to be tied to the Composio-first path — high

The plan has strong SecretStore security gates, but Composio-first introduces different gates:

- DPA/subprocessor acceptance;
- Composio incident risk acceptance;
- no raw token exposure from Composio sessions/tools;
- read-only enforcement around Composio actions;
- audit metadata sufficiency.

Required fix: make Composio production gates explicit and first-class.

## Required repair

Rewrite `plan.md` into a canonical plan with:

1. current decision;
2. non-goals/history links;
3. architecture;
4. canonical V0 tools;
5. Composio adapter mapping;
6. normalized catalog/search/describe/call/materialization;
7. security/governance gates;
8. fallback/private SecretStore path;
9. implementation acceptance criteria.
