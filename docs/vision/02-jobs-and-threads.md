# 2. Jobs and Threads

## The unit of work is a job, not a chat

A **Thread** is one durable job: a resumable unit of work with a title,
participants, a working set of resources, and a status. It is the root that
results, decisions, artifacts, evidence and cost attach to. A Thread is not
a process, a transcript, a tab or a Pi session.

A **Session** is one runtime conversation. A Thread binds zero or more
Sessions: a headless job has none; a long job may have several. A Session
binds to at most one Thread. Product records, keys and operations bind to
workspace, installation and Thread — never to a Session id. That rule exists
because a session-keyed domain model needs a migration later, as one
consumer already learned.

Only the Thread's **identity** is settled. Whether its timeline is a
first-class stream or a projection over Session records is an open spike
and is not decided by anything that ships the identity record.

## Runs and request keys

A **Run** is one admitted agent execution inside a Thread. Its identity is
its request key: admission, acceptance, effect begin and completion are
recorded against it, retries return the settled outcome, and an effect whose
result is unknown stays unknown rather than being replayed. Ordinary
deterministic queries, manual edits and calculations do not create Runs,
Threads or optimization objectives merely to fit the architecture.

## Durability is a premise, not a feature

The engine does not ship on best-effort streams. Conformance Level D — a
durable event stream with paused-turn resume across process restart — lands
and goes default-on before the multi-agent engine, and the journey's
"job continuity" stage is exactly that capability: close the chat, lose the
browser, restart the host; status, results and pending decisions survive and
reappear outside chat.

## Staffing a job

Two first-class modes. **Grow as needed** is the default: a Thread starts
with one bounded agent and specialists join only on measured evidence.
**Predefined fleet**: an agent or vertical package declares a team shape that
staffs the Thread from the start. The single-agent path is optimized first
and never taxed with team overhead.

## Decisions, approvals, presence

Pending decisions are Inbox items with durable identity; an agent cannot
mint an approval. A required decision must be reachable outside chat and
must not be lost or silently accepted by closing a drawer, switching layout
or losing the browser. How present an agent is in a job is a closed
vocabulary declared by the Experience: `hidden · ambient · drawer · page ·
roster`; `ambient` is the default for vertical products, `roster` is the
Meridian flagship.

## Boundaries that stand

No agent-to-agent loopback and no shared-runtime room: agents post into the
job and are woken by the host; posts may carry an addressee and an
acknowledgement flag, but delivery is host-mediated. Session transcripts are
host user data stored on the host's durable volume, not in a sandbox.

## Crosswalk

| Section | Ruling | Built? |
|---|---|---|
| Thread = job root, 0..n Sessions; identity vs shape | RECONCILIATION §9a; DIRECTION 2026-09-07 "premises pulled forward" | identity record: bead `nc-t`; shape: spike `.13.2` |
| Session-id prohibition on product records | DIRECTION 2026-09-07 binding rule; §11(f) Clinic lesson | rule on beads `nc-1/2/3/d` |
| Run / request key / outcome-unknown | §11(c); ARCHITECTURE-PLAN D-c; DECISIONS D31 addendum | request ledger built; C6 protocol partial |
| Level D before the engine | RECONCILIATION §8(c); DIRECTION [durable-streams] | P1-A partly landed, flag off |
| Staffing modes; presence vocabulary | RECONCILIATION §10(a), §10(b) | naming only |
| Approvals not mintable; decisions outside chat | V2-PORT-HANDBOOK Approval; §11(f) | ask_user inbox built; restart-safe pause open (#1348) |
| No A2A loopback / shared room; addressed posts | §7, §9, agent-mail study | — |
| Session history on host volume | AGENTS.md rule 9 | built |
