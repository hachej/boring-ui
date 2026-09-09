# Consumption modes

This area defines the ways an agent can be used ("consumed") from a Workspace
— the platform's durable governed world holding seats, threads, files and
grants. The consumers are independent surfaces: the core web app, the CLI,
the playground, and anything else that starts or resumes agent sessions.

The contract names **four concrete modes**, each with its own authorization
model — the workspace's own default agent, workspace-local collaboration
between agents, external agent ingress, and contracted agents — and binds all
of them to **17 shared invariants** (consumer authorization before every
workspace effect, one canonical filesystem, authority that only narrows, and
so on; the single-gateway rule is Decision 29's, established separately).
"Shared contract" means exactly that: every mode must satisfy the same
invariant list; no mode gets a private relaxation.

## Files

- `AGENT-CONSUMPTION-MODES.md` — the consumption-modes contract: the four
  modes, the 17 invariants, and the roadmap.

## Status — governing contract with named supersessions

Shared architecture contract under Decision 28 (`docs/DECISIONS.md`). The
mode/invariant structure still governs — the multi-agent pack's multi-seat
Threads are an instance of the workspace-local collaboration mode, bounded by
the same invariants. Three caveats from the 2026-08-26 area review:

- **Session ownership predates D29.** Where the contract assigns session
  persistence, routing, queue, and cancellation to the Workspace, shipped
  reality differs: the **Agent owns its session record** inside the D29
  gateway funnel. D29 and `packages/agent/docs/AGENT_GATEWAY_V0.md` govern.
- **The delivery map is historical reference.** Its Mode-1→F7 ordering
  predates the premises program — multi-agent work now waits on
  [durable-streams] and [seat-storage], and `docs/direction/DIRECTION.md`
  alone owns sequencing.
- **Known implementation defect:** invariant 14 requires an unknown persisted
  fleet type to fail execution; current code silently falls back
  (`packages/core/src/server/defaultAgentType.ts`) — the same
  code-vs-Decision-28 gap named in `../fleet-and-environments/README.md`,
  tracked with the #1311 line of work.
