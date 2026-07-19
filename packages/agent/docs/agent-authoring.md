# Authored agent directories (A1 v1)

A1 v1 lets a trusted host turn a small authored directory into one server-only behavior source:

```text
agents/<agent-type-id>/
  agent.json
  instructions.md
```

`instructions.md` is the only authored prompt asset. `toolRefs` are opaque IDs; they are not paths and they never cause the generic compiler/materializer to import `agents/**/tools/*`.

## `agent.json`

Supported schema v1 fields:

```json
{
  "schemaVersion": 1,
  "definitionId": "claims-assistant",
  "version": "1.0.0",
  "label": "Claims assistant",
  "instructionsRef": "instructions.md",
  "toolRefs": ["claims.lookup"]
}
```

Decision 26 rules:

- `definitionId` is the product agent type ID and must match `^[a-z][a-z0-9-]{0,62}$`.
- `version` is author metadata, not a deployment pointer.
- `instructionsRef` is exactly `instructions.md` in v1.
- `AgentDeployment`, `definitionRef`, `deploymentRef`, compiled digests, CAS/publication state, workspace IDs, hostnames, credentials, providers, sandbox settings, release/version bump metadata, and registry fields are not runtime authority and are invalid authored fields.
- `capabilityRequirements`, `skillRefs`, and `mcpServerRefs` may be reported by validation for compatibility, but materialization rejects non-empty values with `AUTHORED_AGENT_REFERENCE_UNSUPPORTED` until real host contribution seams exist.

## Materialization API

Server-only consumers use `@hachej/boring-agent/server`:

```ts
import { materializeAgentDirectory } from "@hachej/boring-agent/server"

const source = await materializeAgentDirectory({
  directory: "agents/claims-assistant",
  expectedAgentTypeId: "claims-assistant",
  toolCatalog: new Map([["claims.lookup", trustedClaimsLookupTool]]),
})
```

The return value is a frozen `MaterializedAgentSourceV1` with instructions, resolved trusted tools, and declared tool refs. It does not expose digests, roots, bundle assets, catalog handles, credentials, sessions, workspaces, or a runtime handle.

`toolCatalog` is a trusted server-owned per-agent allowlist. It is deliberately not the host's whole installed catalog. Every declared `toolRefs[]` entry must resolve exactly once, each trusted tool is strictly validated, and duplicate resolved tool names fail with `AUTHORED_AGENT_TOOL_COLLISION`.

## Example

See [`../examples/trusted-authored-agent`](../examples/trusted-authored-agent). It includes a `tools/not-imported.mjs` sentinel that would throw if imported; A1 conformance proves generic validation/materialization/dev never imports it.

## Export boundary

- Positive: `@hachej/boring-agent/server` exports `materializeAgentDirectory` and `MaterializedAgentSourceV1`.
- Negative: `@hachej/boring-agent`, `/front`, and `/shared` do not export behavior materialization functions, prompt contents, roots, executable catalogs, or tool implementations.
