# North-star ruling ledger — multi-seat Threads (absorbed from issue #1399)

Issue [#1399](https://github.com/hachej/boring-ui/issues/1399) ("North star:
multi-seat Threads — 1 Thread = 1 job") was the owner's ruling ledger for the
multi-agent direction, 2026-08-24 → 2026-08-26. It is now **closed**: the
direction was ratified (PR #1401 merged; §8 amendment rides PR #1409) and the
debate moved into this pack. This file absorbs the ledger verbatim so the
pack's many "#1399, owner ruling" citations resolve to a repo-local record.

Each entry keeps its original wording. A **Status** line marks what later
rulings kept, sharpened, or superseded — read the status before quoting an
entry as current.

---

## Opening framing (owner, 2026-08-24)

Threads (=Sessions) should be able to combine into "channels": conversations
where several agents participate. Gated by the D28 forbid-list (no A2A
loopback) and rule 11 (shared-room runtime needs an explicit ruling). Two
candidate models were posed: **A — channel-as-bus** (private per-agent
Sessions + a router projecting posts) and **B — channel-as-shared-Thread**
(one Thread record, Runs from different Seats). Suggested sequence: v0 =
model A; ratify model-B-compatible data shapes now; decide true shared
Threads from v0 evidence. Not to be conflated with #1127 external messaging
"channels".

**Status: resolved.** The A/B question was settled 2026-08-24 (below): model A
mechanics under the hood, presented as one collapsed timeline. The word
"channel" did not survive — see the naming entry.

## 2026-08-24 — 1 channel = 1 job (owner sharpening)

The channel is the unit of WORK, not the unit of agent — the user talks to
the job; staffing (which agents, how many sessions, handoffs) is collapsed
behind one merged transcript. Agent sessions demote to implementation detail:
per-agent private work logs behind the channel, drill-down only (provenance /
audit), like CI logs behind a PR check. Under the hood model A (per-agent
sessions + router), presented as one collapsed timeline (projection).
Convergence noted: 1 channel = 1 job = 1 **Objective** — the objectives
plugin (PR #1382) is the job's state; the channel is its conversation;
staffed Seats are its team.

**Status: core ruling, ratified** via PR #1401 as "1 Thread = 1 job". One
part later relaxed: the Objective link is **optional, one-way** (engine gate
Q5, ruled 2026-08-26) — not the mandatory triple stated here.

## 2026-08-24 — ratified-plan reconciliation and the naming ruling

Verdict: partially covered; the concept must be renamed. Load-bearing frozen
nouns: **Thread** (=Session, "owns one record and many Runs", VISION R-c),
**Seat** ("grants participation, not identity"), **Run := RequestKey**.
Genuine product-layer delta: Thread as the human-facing collapse point over
multiple Seats' Runs; the "one Thread per job" cardinality; and NAMING —
"channel" is ratified transport/ingress vocabulary, so this concept is
**multi-seat Thread / Job Thread**, never "channel". Proposed amendment
sentence: *"A Thread may span multiple Seats, projected as one timeline; one
Thread per job."*

**Status: ratified verbatim** — that sentence merged as PR #1401
(2026-08-26), recorded in `RECONCILIATION.md` §7. The "owns one record"
storage *shape* was later suspended pending the thread-storage spike (§8;
the ontology stands).

## 2026-08-25 — how Buzz solves the relay (architecture note)

Buzz has no relay and no A2A — coordination dissolves into a shared durable
log (Nostr events) + independent per-agent subscribers filtering @-mentions.
Nobody calls anybody; turn policy is emergent from addressing. Cost: no
central home for loop caps or spend. Mapping to our stack: a THIRD option —
"thread-as-durable-event-stream (D29 Level D) + per-seat automation triggers
as subscribers", host-mediated, caps still host-enforced. Sequencing: v0
central relay (safe, owns caps/budget/receipts) → v1 blackboard once Level D
lands. Reframes engine Q7: Level D is the substrate of the Buzz-shaped end
state, not just replay hygiene.

**Status: standing research.** The relay-vs-blackboard choice is deferred to
post-[durable-streams] (re-sequencing ruling 2026-08-26); this analysis does
not need redoing.

## 2026-08-25 — durable streams committed (owner direction)

Durable streams will be adopted for our agents soon. Engine Q7 reads
accordingly: Level D conformance is a committed companion track, not an open
deferral. Bead filed for the D29 re-evaluation execution.

**Status: sharpened further 2026-08-26** — the premises re-cut makes
[durable-streams] (bead `wt-391-forward-9p50`) a *precondition*: the engine
does not ship on Level B at all. D29 addendum rides PR #1409.

## 2026-08-25 — Grok Bot deep-dive (three-way comparison)

Grok Bot: description-matching handoffs, context crossing implicitly via a
shared per-account VM (xAI's own docs disclaim it as not a security
boundary), no documented loop control, no canonical job thread, actions
attributed to the user. Verdict: validates our posts-only boundary (Q4) as
safety not style; validates central hop/budget caps; validates 1-Thread-1-job
legibility; validates attribution honesty. Steal for v1: description-matching
routing paired with explicit @-override.

**Status: standing research**, cited by the engine chapter's boundary
sections.

## 2026-08-25 — seats share the workspace and sandbox (owner ruling)

Seats on a job SHARE one canonical workspace filesystem (D28 invariant — no
copy/sync) and the physical sandbox backend where the provider supports
reuse, with DISTINCT per-seat authority (tools, grants, model capability;
credentials never cross seats). Posts-only governs prompt-crossing; the
workspace governs artifact-sharing. The xn9 F7 two-agent governance proof is
the standing security proof obligation for this ruling.

**Status: ratified** — carried into §8's two-boundaries text.

## 2026-08-25 — "Channels as the product abstraction" (owner synthesis)

Channels are the surface; 1 channel = 1 fleet staffed from the workspace;
each channel has its canvas (chat + scoped, persisted workspace artifacts
beside it); an Artifacts explore mode swaps chat for self-directed browsing;
job flow inside a channel = orchestrator → workers → QA/reviewer. Owner
leaning "Channel" as the product noun, which would require amending the
transport-vocabulary reservation.

**Status: content kept, noun superseded.** Every structural idea here
survived into the shell plan (thread canvas, Library/explore, the job flow).
The naming lean did **not** survive: the product noun stays **Thread**;
"channel" remains reserved for transport/ingress (2026-08-24 reconciliation,
upheld through ratification).

## 2026-08-26 — product shell IA (owner rulings)

Left-nav top level: **Inbox** (single triage surface, amber count badge) ·
**Work** (collapsible: Threads + Automations) · **Agents** (roster → agent
page) · **Library** (the view library — files + saved views + agent outputs;
replaces the too-broad "Artifacts") · **Search** (palette). Plugin icon rail
= tools, opening as columns; nav = domains. Chat opens as a contextual column
beside any view, never a page switch. Workspace browser = one component,
four mounts. Companies/Funds-style entities are saved collection views in
the Library.

**Status: ratified as the five-domain set (§8a)**, with one later layout
refinement: **Search renders at the top of the nav** (owner canvas iteration,
carried by the spike ratified at `08cc60523`). The four mounts are enumerated
in the pack as: thread canvas · inbox evidence viewer · full-tree popover ·
standalone Library.

## 2026-08-26 — archived work Threads (owner addition)

Work carries an "Archived · N" drill-in (muted, below Automations; mirrored
in the collapsed flyout). Data-model note: the projection record needs a
lifecycle field (active | archived / archivedAt) — fold at engine S1 or as
plan errata at the gate. Archive ≠ delete: history, attribution and refs
retained; archived threads leave the default Work list and stay searchable.

**Status: ratified** ("Threads archive, they don't die"); the lifecycle
field is a named engine S1 obligation.

## 2026-08-26 — closure

"Ratified and absorbed: the 1 Thread = 1 job direction was ratified by merged
PR #1401 (multi-seat Threads amendment), and the Job-Thread v0 engine chapter
+ shell integration live in the multi-agent plan PR #1409. Direction debate
is closed; implementation tracks under that plan."

**Status: this file is that absorption.**
