# A1-agent-authoring — Handoff checklist

## Prerequisites

- [ ] P6-D schema/digest/registry merged for BBA1-001.
- [ ] P6-R normal host resolver merged for BBA1-002.

## Beads

- [ ] BBA1-001 — directory compiler and deterministic digest.
- [ ] BBA1-002 — validate and local-dev commands.
- [ ] BBA1-003 — only when the shipped D1 path consumes duplicated M1 behavior
      configuration, migrate it to the canonical compiled bundle; optional
      M1's mere existence does not create the gate.

## Review gates

- [ ] `AgentDefinition` contains behavior/requirements only.
- [ ] Structured parsing and canonical digesting are deterministic.
- [ ] Discovery is import-free and path-contained.
- [ ] The compiled bundle contains every referenced immutable asset and
      materializes without access to the authoring checkout.
- [ ] Local dev uses the normal host resolver and `createAgent()` core.
- [ ] Local dev creates/selects an explicit workspace and approved runtime;
      bwrap is preferred when available and direct execution requires explicit
      trusted-local policy.
- [ ] No platform-source edit is required for the example agent.

## Exit proof

- [ ] `agent validate` reports id/version/digest.
- [ ] `agent dev` completes one scripted local turn.
- [ ] The local proof records workspace and runtime identity and demonstrates
      there is no silent no-runtime fallback.
- [ ] Local dev uses an explicit host-owned versioned dev deployment and reports
      definition/deployment/resolved digests.
- [ ] Behavior change creates a new digest.
- [ ] If the shipped D1 path consumes duplicated M1 behavior configuration,
      BBA1-003 is complete before P8; otherwise record non-consumption and do
      not gate on optional M1's existence.
