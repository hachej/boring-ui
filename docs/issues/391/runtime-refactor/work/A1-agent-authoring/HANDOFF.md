# A1-agent-authoring — Handoff checklist

## Prerequisites

- [ ] P6-D schema/digest/registry merged for BBA1-001.
- [ ] P6-R normal host resolver merged for BBA1-002.

## Beads

- [ ] BBA1-001 — directory compiler and deterministic digest.
- [ ] BBA1-002 — validate and local-dev commands.
- [ ] BBA1-003 — when M1 exists, migrate it to the canonical compiled bundle;
      otherwise record that M1 is absent.

## Review gates

- [ ] `AgentDefinition` contains behavior/requirements only.
- [ ] Structured parsing and canonical digesting are deterministic.
- [ ] Discovery is import-free and path-contained.
- [ ] The compiled bundle contains every referenced immutable asset and
      materializes without access to the authoring checkout.
- [ ] Local dev uses the normal host resolver and `createAgent()` core.
- [ ] No platform-source edit is required for the example agent.

## Exit proof

- [ ] `agent validate` reports id/version/digest.
- [ ] `agent dev` completes one scripted local turn.
- [ ] Local dev uses an explicit host-owned versioned dev deployment and reports
      definition/deployment/resolved digests.
- [ ] Behavior change creates a new digest.
- [ ] If M1/R0 exists, BBA1-003 is complete before P8; only proven absence
      removes that gate.
