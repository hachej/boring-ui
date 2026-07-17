> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

# A1-agent-authoring — Handoff checklist

## Prerequisites

- [ ] P6-D schema/digest/registry merged for BBA1-001.
- [ ] P6-R merged for BBA1-002, and D1-R0's canonical redacted composition-
      identity producer is implemented on current main.

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
- [ ] Local dev obtains its authorized workspace/default binding and canonical
      composition identity from the existing host seam, then calls P6-R and
      `createAgent()` core. It owns no second composer or digest algorithm.
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
      definition/deployment/composition/resolved digests.
- [ ] Behavior change creates a new digest.
- [ ] If the shipped D1 path consumes duplicated M1 behavior configuration,
      BBA1-003 is complete before P8; otherwise record non-consumption and do
      not gate on optional M1's existence.
