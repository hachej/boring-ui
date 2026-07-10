# TODO-A1 — Minimal agent-directory authoring

This file coordinates three independent PR assignments. Dispatch one bead at a
time.

## BBA1-001 — Directory compiler and deterministic digest — M

**Input:** P6-D `AgentDefinition` schema and digest rules.

**Implement:**

- Parse `agents/<name>/agent.json` with a structured JSON parser.
- Resolve `instructionsRef: "./instructions.md"` inside the agent directory;
  reject traversal, symlinks outside the directory, missing files, unknown
  fields, and malformed ids with stable codes.
- Produce one `CompiledAgentBundle { definition, definitionDigest, assets }`.
  Assets contain normalized relative path, SHA-256 digest, and UTF-8 content;
  ordering is deterministic. `instructionsRef` points to a bundle asset.
- Compute `definitionDigest` over canonical definition data plus the sorted
  asset path/digest/content tuples. It must not depend on the checkout path.
- Keep discovery import-free; executable tools/plugins remain host-resolved ids.
- Reject `pluginRefs` (and any `plugins` alias) in schema v1 with
  `AGENT_DEFINITION_UNSUPPORTED_FIELD`; the field is not reserved as a no-op.
- Reject generic prompt-fragment reference fields in schema v1. Agent-authored
  system instructions come only from `instructionsRef`; capability/plugin
  fragments are resolved with their owning contribution by the host.

**Acceptance:** the same directory produces byte-equivalent bundles and the
same digest across two runs and checkout roots; changing instructions changes
it; every reference resolves inside the bundle; deployment/pricing/exposure
fields and `pluginRefs` reject.

## BBA1-002 — Validate and local-dev commands — M

**Input:** merged BBA1-001 and P6-R.

**Implement:**

- `boring-ui agent validate <dir>` prints definition id/version/digest and
  redacted requirement diagnostics.
- `boring-ui agent dev <dir>` resolves the compiled bundle through the normal host
  seam and runs one local agent; it does not invent a second composer.
- The CLI supplies an explicit local-only versioned `AgentDeployment` from host
  dev defaults (never from `agent.json`) with v1 `agentId: 'default'`, computes its deployment and resolved
  snapshot digests, and prints all three identities. D1 supplies its own
  dedicated deployment for the same bundle.
- The dev command chooses no runtime by default. Direct host execution requires
  explicit trusted-local policy.

**Acceptance:** one scripted turn succeeds from an example directory with zero
platform-source edits; attempting a non-default v1 route fails with the stable
unsupported-route code rather than silently selecting another agent.

## BBA1-003 — R0 config migration when M1 exists — S/M, conditional v1 gate

**Input:** BBA1-002. Required before P8 when M1/R0 exists on main; skip only
when repository inspection proves M1 is absent.

**Implement:**

- Resolve M1 behavior from the compiled bundle.
- Remove `ManagedAgentVerticalConfig`, or retain only a deployment-only adapter
  that contains no behavior duplicated from `AgentDefinition` and names a
  deletion owner.
- Preserve the stock MCP client result/artifact contract.

**Acceptance:** when M1 exists, its smoke consumes the same definition digest
printed by `agent validate` and no behavior field has two sources of truth.
When M1 is absent, record that fact and omit the gate.

## Do not add

- TypeScript module discovery or executable config.
- File-convention slots beyond `agent.json` and `instructions.md`.
- Tenant, pricing, hostname, exposure, image-build, marketplace, or UI authoring.
- A new registry, plugin loader, or deployment engine.
