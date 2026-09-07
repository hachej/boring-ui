# 2. Jobs and Threads

## The unit of work is a job, not a chat

A **Thread** is one durable job: a resumable unit of work with a title,
participants, a working set of resources, and a status. It is the root that
results, decisions, artifacts, evidence and cost attach to. A Thread is not
a process, a transcript, a tab or a Pi session.

A **Session** is one runtime conversation. A Thread binds zero or more
Sessions: a headless job has none; a long job may have several. A Session
binds to at most one Thread. Product records, keys and operations bind to
workspace and installation, and to the Thread when they are produced inside a
job — never to a Session id. Thread-free deterministic operations and domain
records remain valid; a Thread is not a replacement name for every record.
The session rule exists because a session-keyed domain model needs a
migration later, as one consumer already learned.

Only the Thread's **identity** is settled. Whether its timeline is a
first-class stream or a projection over Session records is an open spike
and is not decided by anything that ships the identity record.

## Runs and request keys

A **Run** is one admitted agent execution; when it is part of a durable job
it binds to that Thread, otherwise it stands alone. Its identity is
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
job and are woken by the host, and delivery is host-mediated. Addressed posts
with acknowledgement metadata are a research proposal, not a ruling. Session
transcripts are host user data stored on the host's durable volume, not in a
sandbox.

## Crosswalk

Implementation status lives only in [`CROSSWALK.md`](CROSSWALK.md).

| Section | Ruling |
|---|---|
| Thread = job root, 0..n Sessions; identity vs shape | RECONCILIATION §9a; DIRECTION 2026-09-07 "premises pulled forward" |
| Session-id prohibition on product records | DIRECTION 2026-09-07 binding rule; §11(f) Clinic lesson |
| Run / request key / outcome-unknown | §11(c); ARCHITECTURE-PLAN D-c; DECISIONS D31 addendum |
| Level D before the engine | RECONCILIATION §8(c); DIRECTION [durable-streams] |
| Staffing modes; presence vocabulary | RECONCILIATION §10(a), §10(b) |
| Approvals not mintable; decisions outside chat | V2-PORT-HANDBOOK Approval; §11(f) |
| No A2A loopback / shared room; addressed posts | §7, §9, agent-mail study |
| Session history on host volume | AGENTS.md rule 9 |
