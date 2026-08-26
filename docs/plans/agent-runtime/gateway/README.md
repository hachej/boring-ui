# Gateway

This area covers the `AgentGateway`: the single interface every consumer
(workspace, core, CLI, playground, delegation) talks to when it wants to
start or resume an agent session — seven session methods plus `close()`,
produced by exactly one construction function (`createAgentHost()`) so no
consumer can wire an agent any other way. "Frozen contract" means the
interface is versioned and stable, not that the code is dead. Durability
"Levels" in these docs are the conformance scale: Level B ≈ bounded replay +
snapshot rehydrate (what shipped), Level D ≈ fully durable streams a client
can always resume (now a committed precondition for the multi-agent engine).

## Files

- `plan.md` — the #909 `AgentGateway` v0 spine plan.
- `AH0-ASSEMBLY-AUDIT.md` — the pre-implementation assembly/consumer audit.
- `ORCHESTRATOR-PROMPT.md` — the (retired) execution orchestrator prompt used
  to run the #909 bead graph.

## Status — historical; the package contract governs

**Everything in this folder is a historical planning record.** The v0 gateway
SHIPPED in v0.1.91 and is Decision 29 in `docs/DECISIONS.md` (accepted
2026-08-08); D29 now also carries a **Level-D addendum (2026-08-26)**: durable
streams land and go default-on before the multi-agent engine. The binding
contract is **`packages/agent/docs/AGENT_GATEWAY_V0.md`**, colocated with its
types — `plan.md`'s own header says its §6 drifted and defers to it. The
frontmatter's `ready-for-human` is stale: the plan executed and closed.

Historical caveats when reading `plan.md`:

- Its "owner-ratified pushed-host-first" topology (§ around lines 63–97) is
  **owner input, not a ratified ruling** — the ratified architecture defines
  the untrusted tier differently (iframe UI, sandbox-proxy tools, explicit
  promotion; `ARCHITECTURE-PLAN.md`), and D29 only *reserves* future
  remote/third-party tiers.
- Some member names it "ratifies" shipped differently (e.g. `registerRoutes`
  → `registerDirectRoutes`; see `packages/agent/src/server/agent-host/types.ts`).
  The package contract, not §2 of the plan, names the real surface.
