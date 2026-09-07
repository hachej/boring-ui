# 5. Agents and multi-agent

## An agent is a package

An agent definition is content: instructions, skills, knowledge, model
policy, declared capabilities and evaluation references, addressed by a
content digest. It ships as a plugin-shaped package (`package.json`
declaring the agent, `instructions.md`, skills, a `knowledge/` folder bound
read-only with its provenance folded into the digest). A release pins the
exact agent digests it ships. Discovery and installation of agent packages
go through the host's asset manager; installing without a redeploy is the
queued next slice of that lane and the follow-up to the product path.

## Seats grant participation, not identity

A workspace constrains what an agent may do there; it never changes what the
agent is. Signup creates a default agent Seat; a creator or vertical intent
adds the specialist Seat beside it, additively and idempotently. Enrollment
(Seat), job participation (Thread), installation and effective release are
four distinct questions, and one relation must not silently answer all four.

## Application fleets

A host application defines a deployment-static fleet: stable agent type ids,
declarative authored sources, trusted bindings, validated at boot. Installed
products are a separate, host-brokered tier that resolves immutable releases
per installation without touching the fleet.

## Two classes of agent

**Domain agents** use semantic resources, Views, artifacts and governed
operations. They cannot own domain truth, widen grants, choose a new metric
definition, or turn a draft into an accepted record.

**Builder agents** are a distinct agent type with their own tool catalog.
Inside a candidate they may read and change renderer code, CSS, domain
operations and tests. They never touch the active release, protected checks
or authority controls, and they never activate. The restriction is an
authority boundary enforced by the host, not the absence of a tool. Their
request arrives as a typed brief with provenance and confirmation, not an
untyped string.

## Teams

A job's transcript is multi-author: one composer, several named agents
visibly authoring, with join, handoff and leave markers; the orchestrator
holds its own Seat. Attribution is audit-grade from day one through the seat
id carried in the host's session catalog; display-only participant chips are
not a shipping position. Delegation is a host-mediated call with a task,
resources and a budget; there is no agent-to-agent loopback and no shared
runtime room.

## Improvement

Reusable improvements promote only on evidence, user → workspace → vertical
→ platform. Recursive improvement is challenger-based, dry-run and
independently benchmarked; there is no live self-rewriting. A software
candidate can exist without an optimization objective: a user may keep a
change because they prefer it, while a claimed quality improvement needs
evidence.

## Crosswalk

| Section | Ruling | Built? |
|---|---|---|
| Agent package, digest, knowledge | #1107 / #1202 lane; V2-PORT-HANDBOOK Agent | built (boot-time install); bead `nc-a` for the tutor |
| Seats grant participation; additive specialist Seat | VISION invariant 5; DECISIONS D32; seats plan | built (`workspace_agent_seats`) |
| Deployment-static fleet; products as separate tier | DECISIONS D28; D33 addendum | fleet built; product tier: beads `nc-1/2` |
| Domain vs builder class | RECONCILIATION §13(e); VISION invariant 4 narrowing | bead `nc-6`; boundary via `nc-x` |
| Multi-author transcript; orchestrator Seat; seat attribution | §9b; §8(c)(2); [seat-audit-attribution] | fixture only; beads `.14.1/.14.2` |
| Delegation; no loopback | V2 spec L3; §7, §9 | MCP delegate exists; kernel noun absent |
| Promotion on evidence; no live self-rewriting | VISION invariants 10, 11; 2026-08-27 amendment | — |
