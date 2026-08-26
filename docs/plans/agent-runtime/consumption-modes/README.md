# Consumption modes

This area defines the ways an agent can be used ("consumed") from a Workspace
— the platform's durable governed world holding seats, threads, files and
grants. The consumers are independent surfaces: the core web app, the CLI,
the playground, and anything else that starts or resumes agent sessions.

The contract names **four concrete modes**, each with its own authorization
model — the workspace's own default agent, workspace-local collaboration
between agents, external agent ingress, and contracted agents — and binds all
of them to **17 shared invariants** (one gateway, one canonical filesystem,
authority that only narrows, and so on). "Shared contract" means exactly
that: every mode must satisfy the same invariant list; no mode gets a private
relaxation. A delivery roadmap ties the modes to feature phases.

## Files

- `AGENT-CONSUMPTION-MODES.md` — the consumption-modes contract: the four
  modes, the 17 invariants, and the roadmap.

## Status

Shared architecture contract under Decision 28 (`docs/DECISIONS.md`). Still
governing — the multi-agent pack's multi-seat Threads are an instance of the
workspace-local collaboration mode, bounded by the same invariants.
