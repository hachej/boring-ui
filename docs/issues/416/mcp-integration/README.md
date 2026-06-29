# Issue #416 — MCP / Connector Integration Pack

This folder tracks the generic MCP/connector onboarding work for issue #416.

## Canonical plan

- [`plan.md`](./plan.md) — current source of truth.

Current decision: hosted Constellation V0 is **Composio-first** for managed connector auth/tool execution, with Constellation-owned interfaces preserving future self-custody/private backends.

## Research and evidence

- [`credential-vault-research.md`](./credential-vault-research.md) — credential-vault options, Composio/Nango/Infisical/agent-vault research, final backend notes.
- [`better-auth-mcp-research.md`](./better-auth-mcp-research.md) — Better Auth MCP/OAuth findings and inbound-vs-outbound distinction.
- [`nango-selfhost-poc.md`](./nango-selfhost-poc.md) — self-hosted Nango smoke.
- [`nango-real-spike.md`](./nango-real-spike.md) — real Nango credential/proxy spike.
- [`nango-provider-support.md`](./nango-provider-support.md) — provider registry support for Notion/Airtable/Microsoft.
- [`nango-notion-mcp-spike.md`](./nango-notion-mcp-spike.md) — Nango Notion MCP auth finding.
- [`pi-mcp-adapter-notion-auth-spike.md`](./pi-mcp-adapter-notion-auth-spike.md) — pi-mcp-adapter Notion MCP auth spike.
- [`reviews/`](./reviews/) — thermo/Claude/Gemini/local review outputs.

## Key principles

- Constellation owns governance: source ownership, policy, read-only defaults, audit, redaction, filesystem boundaries, and model/token budget policy.
- Composio can own hosted V0 connector auth/tool execution where security/procurement gates pass.
- Raw provider tokens must never reach Pi, browser responses, prompts, logs, workspace files, or audit payloads.
- Do not hard-code Composio into boring-mcp business logic; hide it behind connector interfaces.
- Preserve a future self-custody path for BYO LLM keys, MCP-native gaps, private deployments, and customers rejecting third-party token custody.
