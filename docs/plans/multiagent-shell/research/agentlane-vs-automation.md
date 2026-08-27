# AgentLane vs the automation plugin — where each belongs

Provenance: owner-forwarded external analysis, 2026-08-27 (post-spike).
Absorbed with the standard guard: its shapes (`TeamBinding`,
`RuntimeLaneBinding`, the `AutomationTarget` union) are **candidate designs
for the post-premise engine gate**, not adopted nouns — and its `Work`
references ride the same amendment gate as storage candidate (iii).

## The ruling it crystallizes

> **Pi may eventually replace runtime coordination *mechanics*. It never
> replaces product coordination *semantics*.**

```
Automation              = when and why Work starts (one trigger type of many)
Boring Work/Thread/Seat = what the job is, who participates, authority,
                          audit, cost, lifecycle
Pi AgentLane            = one possible runtime mechanism for concurrent
                          agent contexts
```

## Automation-dependency ruling (recorded)

The multi-agent model must NOT live inside `boring-automation`. Multi-agent
jobs start from chat, UI actions, API/MCP, other agents, webhooks, *and*
schedules — if team orchestration lived in the automation plugin, every
other entry path would have to impersonate an automation. Correct direction:
**the automation plugin is one admission client that *invokes* multi-agent
Work; multi-agent Work never depends on automation.** What the plugin
already does well stays exactly what it is: durable invocation idempotency,
dispatch claims, heartbeats, stale-run reconciliation, gateway dispatch —
a background *Work-admission and scheduling* mechanism.

Evolution path for the plugin (gate material, not scheduled): the single
optional `agentTypeId` becomes a target union — `agent | team | operation` —
where a team is a Boring-owned definition (seats with `seatId`, agent
revision, role, authority ceiling, budget; routing policy; presentation
policy `single-voice | explicit-specialists`), staffed **from the
deployment-static application fleet** (D28 — no workspace-curated roster).

## The topology options for the engine gate

- **Option A — one Session, many lanes.** Simplest runtime, one durable
  sequence, natural merged timeline. Blocked today: the spike proved lane
  scoping is a **view-time filter, not a store boundary** — fails
  posts-only as shipped.
- **Option B — separate private Session per Seat.** Strongest isolation,
  clearest credential/model boundaries; keeps the custom
  relay/projection/reconciliation.
- **Hybrid (likely intermediate):** separate private Session per Seat **+
  AgentLanes *inside* a Seat** for that agent's own branches/subtasks **+
  the Boring Job Thread** for settled cross-agent posts. Gains pi's
  branch/concurrency machinery without touching the posts-only boundary.
  This joins the engine gate's candidate set alongside relay / D22 native
  binding / blackboard / full pi-v4 lanes.

## The seat↔lane mapping (candidate shape)

Only `seatId`, `agentRevisionId`, `workId`/job id, and `runId` belong in
durable product evidence. `runtimeSessionId` and `laneName` are
**adapter-private placement details** inside the `AgentHarnessBackend` —
a lane name may implement a Seat's runtime location; it is never the Seat
identity or the security boundary.

## What lane adoption could delete vs never touches

Could delete: one-session-per-participant topology, cross-session event
merging, per-session cursors, some relay transport/hydration code.
Never touches: job identity and the Thread projection, agent identity and
immutable revision, Seat/Actor/Party attribution, authority and credential
resolution, per-seat budgets, handoff intent + transition receipts,
hop/invocation caps, the orchestrator's real Seat, Attention and
`input-required`, effect authorization/reconciliation, usage/payer,
delivery/outcome, automation claims/heartbeats, posts-only policy.

## The 10-item lane-adoption gate (supersedes the earlier 5-item lane list)

One-Session-many-lanes may replace the separate-session topology only when
a **published** pi release passes ALL of:

1. `prompt`/`resume`/`watch`/`abort`/lane-create/restart operational in the
   published package;
2. a lane can be given only its own context view;
3. an agent on one lane cannot retrieve another lane's private entries;
4. a lane binds host-side to an immutable `seatId` + agent revision;
5. lane deletion/recreation cannot rewrite historical attribution;
6. per-lane model/tool/source/credential policy is Boring-issued;
7. a suspended human question survives restart and resumes the exact
   Boring run once;
8. the request/effect ledger reconciles with pi session state across every
   crash boundary;
9. the orchestrator is a real Seat — not the automation, the relay, or an
   unnamed `main` lane;
10. adoption deletes a meaningful quantity of relay/session-sync code
    rather than adding a parallel layer.

**Failure of the privacy tests (2–3) automatically selects separate
Sessions** — no owner meeting needed for that branch.
