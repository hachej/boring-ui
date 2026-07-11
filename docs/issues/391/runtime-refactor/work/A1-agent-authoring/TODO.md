# TODO-A1 — Minimal agent-directory authoring

This file coordinates three independent PR assignments. Dispatch one bead at a
time.

> **Dispatch correction (2026-07-11).** BBA1-001 landed via #624. BBA1-002 is
> not a D1 prerequisite and is not dispatchable from P6-R alone. Wait for D1-R0
> to specify and a D1 bead to implement the canonical redacted composition-
> identity producer, then recut BBA1-002 against that exact current-main host
> seam. P6-R remains a pure binding function.

## BBA1-001 — Directory compiler and deterministic digest — M

**Input:** P6-D `AgentDefinition` schema and digest rules.

**Implement:**

- Parse `agents/<name>/agent.json` with a structured JSON parser.
- Resolve canonical `instructionsRef: "instructions.md"` inside the agent directory;
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

**Input:** merged BBA1-001 and P6-R, plus the D1-R0-specified canonical
composition-identity producer implemented on current main.

**Implement:**

- `boring-ui agent validate <dir>` prints definition id/version/digest and
  redacted requirement diagnostics.
- `boring-ui agent dev <dir>` asks the existing CLI/workspace host to create or
  select the authorized local workspace/runtime, create its local-only
  deployment, select it as that workspace's `default`, and obtain the canonical
  redacted composition identity. It then calls P6-R and runs one local agent;
  it does not invent a second composer or digest algorithm.
- The CLI supplies an explicit local-only versioned `AgentDeployment` from host
  dev defaults (never from `agent.json`) with v1 `agentId: 'default'`, computes its deployment and resolved
  digests, and prints definition, deployment, composition, and resolved
  identities. D1 supplies its own production deployment for the same bundle.
- The dev command creates or selects an explicit local workspace and resolves
  an approved runtime through the normal workspace host. Prefer bwrap when it
  is available. Direct host execution requires explicit trusted-local policy;
  missing or unauthorized workspace/runtime selection fails with a stable
  diagnostic. There is no no-runtime fallback.

**Acceptance:** one scripted workspace-backed turn succeeds from an example
directory with zero platform-source edits; output names the workspace and
runtime identities; the reported composition digest equals the host producer's
value; attempting a non-default v1 route fails with the stable
unsupported-route code rather than silently selecting another agent.

## BBA1-003 — R0 config migration when D1 consumes duplicate M1 behavior — S/M, conditional v1 gate

**Input:** BBA1-002. Required before P8 only when the shipped D1 path actually
consumes duplicated M1 behavior configuration. Optional M1's mere existence
does not create the gate.

**Implement:**

- Resolve M1 behavior from the compiled bundle.
- Remove `ManagedAgentVerticalConfig`, or retain only a deployment-only adapter
  that contains no behavior duplicated from `AgentDefinition` and names a
  deletion owner.
- Preserve the stock MCP client result/artifact contract.

**Acceptance:** when D1 consumes duplicated M1 behavior configuration, its
shipped path consumes the same definition digest printed by `agent validate`
and no behavior field has two sources of truth. When D1 does not consume that
configuration, record that fact and omit the gate regardless of whether
optional M1 exists.

## Do not add

- TypeScript module discovery or executable config.
- File-convention slots beyond `agent.json` and `instructions.md`.
- Tenant, pricing, hostname, exposure, image-build, marketplace, or UI authoring.
- A new registry, plugin loader, or deployment engine.
