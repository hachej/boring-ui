---
title: Job channel = the Thread, with addressed posts — proposal
status: PROPOSAL (research, not dispatchable). Tier 1 needs no §7 promotion gate but is still downstream of P1 (engine on Level D), P1-A3 (attention ledger delta) and P3 (audit-grade seatId) — it folds into the post-shape-spike engine plan, not before. Tier 2 is a candidate input to the post-P1 relay-vs-blackboard ruling and needs its own promotion gate (RECONCILIATION §7).
review: fresh-eyes 2026-08-29 folded (10 findings); Sol cross-model pass 2026-08-29 folded (6 findings, verdict REVISE → narrowed as recommended)
derived-from: research/agent-mail-mcp-study.md; transparent-multiagent-chat-deepdive.md; Buzz + Grok Bot rows in docs/vision/explorations.md
owner-ask (2026-08-29): "a communication space for agents in one job channel — Slack-like channels — agents communicate 1:1 or 1:n inside the workflow, in parallel with the real work"
---

# Job channel = the Thread, with addressed posts

## Rule-11 alignment, first

| Ratified text | This proposal |
|---|---|
| §9a Thread = durable job root, 0..n Sessions; "channel" = transport only | The "job channel" **is the Thread**. No new noun; the word *channel* is not used for it. |
| §9b multi-author transcript: one composer, explicit specialists, orchestrator holds a Seat | Kept verbatim. Addressing is metadata **on posts in that transcript**, never a second transcript. |
| Posts-only boundary: only settled posts and system markers cross a Seat boundary | Every addressed message is a settled post; edit-intent and interrupt flags are **system markers**. Nothing else crosses. |
| §7: no A2A loopback, no shared-runtime room; any shared-transcript runtime primitive needs its own promotion gate | **Tier 1 activates neither.** Tier 2 (subscriber inboxes, agent→agent send) is explicitly gated and *not* proposed for dispatch. |
| Relay-vs-blackboard decided post-P1 with both live | Tier 2 is filed as evidence for that ruling; it does not pre-empt it. |
| D28 (`DECISIONS.md:463-466`): one canonical workspace, per-seat authority (D25's older shared-runtime wording is superseded — not cited) | File "reservations" are plain advisory markers; exclusivity, if ever, lives in Environment admission. |
| §10(a): the v0 engine optimizes the single-agent path first and must not tax it with team overhead | All fields optional; **negative proof: a single-seat Thread with `to:` absent renders zero addressing chrome, byte-for-byte as today.** |
| §8 precondition 2: audit-grade `seatId`, display-grade handles are not a shipping position | `to:` resolves to a real Seat ref (P3); no display-handle addressing. Sequencing dependency on P3. |
| Deep-dive Edge 2 (serialize; one floor-holder) and Edge 6.4 (no `@everyone`, no multi-agent mention in one message in v0) | **Tier 1 addresses exactly one Seat per post.** 1:n = several single-addressed posts or an unaddressed post to the job. No `cc`. |
| Deep-dive Edge 6.6 (defer reply-to-a-message) | No `inReplyTo` in Tier 1. |
| §7: "agents never invoke agents directly" | Agent-authored `to:` is **advisory**; the orchestrator's selection stays authoritative and may override it. |

**Conflicts:** none for Tier 1 once the rows above hold. Tier 2 would conflict with §7 unless promoted — that is the point of separating the tiers.

## Today / Delta

**Today.** The Thread is a single merged timeline of Sessions' posts (§7 collapse, §9b presentation). A post has an author Seat (P3 will make `seatId` audit-grade) but **no addressee**, no acknowledgement semantics, no importance, and no way for a human to say "this is an interrupt" vs "ambient context". Agents talk to each other only through the orchestrator relaying posts (D22 native binding default). The deep-dive already found that *invisible* handoffs are the defect (CommunityBots), and scoped a one-shot `@seat` address (Edge 6).

**Delta (Tier 1).** Give posts a single addressee and an ack, in the Thread, visible to the human. That is the "1:1" ask; "1:n" is several addressed posts or one unaddressed post — never one post naming several Seats (Edge 6.4). Nothing leaves the ratified shape.

## Tier 1 — addressed posts in the Thread (gate-free)

Typed metadata on a post (wire-additive, all optional):

Three forms are kept strictly apart (Sol finding 4):

| Form | Who writes it | Crosses a Seat boundary because | Examples in Tier 1 |
|---|---|---|---|
| **Settled authored post metadata** | the posting Seat / human, at settlement | it is part of a settled post | `to`, `importance`, `ackRequested`, `editIntent` |
| **Host-derived system marker** | the host, with an explicit issuer and causal event | it is a system marker | `acked-by` (cause: addressee's turn settled), joined/handoff/left |
| **Workspace artifact reference** | anyone, by reference only | artifacts are shared through the workspace (D28) | none new here; raw attachments are rejected |

```ts
/** Settled authored post metadata — display + routing preference only in Tier 1. */
interface PostAddressingV0 {
  to?: SeatRef                // exactly one Seat; absent = the job (Edge 6.4: no multi-mention, no @everyone)
  importance?: 'ambient' | 'normal' | 'interrupt'   // DISPLAY-ONLY in Tier 1: no pause/resume semantics
  ackRequested?: boolean      // read-receipt request; produces a host marker, projects to NOTHING else yet
  editIntent?: { paths: string[] }                  // advisory authored note; no TTL, no index, no enforcement
}
```

(Rejected from the analysed model after review: `cc`, multi-seat `to`, `inReplyTo`, TTL'd reservations, raw attachments — see the rule-11 rows.)

Semantics:
- **Addressing changes neither visibility nor context scoping.** Every post stays in the one Thread transcript the human reads (render boundary), and every Seat's prompt context is built exactly as today's relay builds it (prompt boundary, deep-dive Edge 7) — `to:` never subtracts a post from anyone's context. `to:` says *who is expected to act*, and the §9b chips render it ("→ Researcher"). Any `to:`-based prompt filtering is Tier 2, by definition.
- **Selection is the orchestrator's, unchanged.** An addressed post is a routing hint to the orchestrator's next-turn selection (the deep-dive's description-matching routing with explicit @-override). A **human** `to:` prefers the addressee; an **agent** `to:` is advisory and the orchestrator may override it — otherwise agent A would be invoking agent B with the orchestrator as a transport hop (§7). No hop counter is bypassed; per-chain caps stay host-enforced.
- **`ackRequested` is a read receipt, nothing more, in Tier 1.** The host emits one `acked-by: <seat>` marker (issuer: host; cause: the addressee's next turn settled) — not a costed extra turn, and **no Attention projection**. Escalation ("unacked after N turns") is deferred whole to P1-A3/A4 and the engine plan: it would need an additive attention kind with a nullable run FK and a Seat-owned actor, and a deadline policy — none of which Tier 1 defines. Sol finding 2: a second Attention policy is not introduced here.
- **`importance` is display-only in Tier 1.** `interrupt` renders as a flag the human and the orchestrator can see; it does **not** pause an in-flight model/tool effect, pre-empt a queued turn, or resume anything — effect-safe interruption around non-idempotent effects is P1-A3 (effect classes) + P1-A4 (resume) territory. The agent-mail overseer preamble is recorded as *prior art for a future host semantic*, not adopted.
- **`editIntent` is advisory authored metadata** ("Coder intends to edit src/x.ts") — no TTL, no conflict index, no enforcement in Tier 1. A live lease index would be mutable cross-seat coordination state, which posts-only does not admit; enforcement, if ever needed, is an Environment-admission concern (D28).
- **Signed Thread export** (Ed25519 + redaction presets) is filed under Delivery/evidence ideas, unrelated to addressing.

Where it lands: the post schema and the §9b chip renderer, i.e. the post-shape-spike engine plan and the thread-view slice (L4). Storage-neutral: works over projection or first-class stream. **Not dispatchable until that engine plan exists** — this proposal is its input.

## Tier 2 — the mailbox candidate (gated; a distinct third shape, not "blackboard")

What agent-mail actually is: per-recipient durable inboxes over a shared store, consumed pull-style. In our nouns: a **per-Thread subscriber projection** — each Seat reads a filtered view of the Thread (`to: me` ∪ job-wide ∪ …) instead of the whole transcript, and may post without the orchestrator selecting it. The study classifies this as a **third shape beside relay and blackboard**; the proposal keeps that classification (Sol finding 3) — it is *not* "the blackboard candidate with a filter", and a future blackboard ruling does **not** automatically activate it.

Tier 2 decomposes into four **separately gated dimensions**, each a shared-runtime-room or A2A question under §7: (a) per-Seat read cursors / filtered projection of the Thread stream; (b) posting without orchestrator selection; (c) a wake-up rule (any subscriber turn is still host-admitted and capped — never polling); (d) contact policy as Seat authority rather than spam control. Each needs its own line in the post-P1 topology ruling. If the ruling keeps relay, Tier 1 alone delivers visible single-addressee routing and Tier 2 is dropped.

## What we do NOT take from agent-mail

Random-name identities (Seats are ours; role names stay), name+token attribution (P3 `seatId`), pull-based inbox consumption with an external wake-up (their OSS file signals notify watchers but never admit a turn — ours must be host-admitted), git-hook lock enforcement, separate per-agent inbox UI (the Grok Bot fragmented-threads failure), and any code or further source analysis pending the owner/legal determination on the license rider (study §0).

## Proof (when an engine plan adopts Tier 1)

- A fixture Thread with three Seats: a human `to: Researcher` post makes the orchestrator select Researcher next; **every Seat's prompt context is identical to the unaddressed case** (Edge 7 assertion — addressing scopes nothing); the human transcript shows the chip; the host emits one `acked-by: Researcher` marker, with issuer `host` and cause = that turn's settlement, when it settles; an `interrupt` human post changes rendering only — the orchestrator's queue and any in-flight effect are provably untouched; an agent-authored `to:` that the orchestrator overrides produces no error and no hidden delivery.
- Negative: no post reaches a Seat without a relay hop (assert hop ledger); no context crosses except settled posts (Edge 7 test); a post naming two Seats, a `cc`, a reply edge, or a raw attachment is **rejected at settlement**; a marker without an issuer and causal event is rejected; **a single-seat Thread with no addressing fields renders byte-for-byte as today** (§10a, deep-dive falsification #1).

## Open questions (who answers)

- (owner, post-P1 gate) relay vs blackboard — decides Tier 2's fate.
- (engine plan) whether `to:` on a *human* post forces the addressee's turn or only prefers it; agent-authored `to:` is already ruled advisory above.
- (P1-A3) the additive attention kind for unacked posts — sized inside A3's follow-ups, not here.
- (P3) chip rendering of `to:` requires audit-grade seat identity — sequencing only.
- (owner, legal) the analysed project's license rider: its "use" definition arguably reaches analysis and field-level derivation, not only code lift — see the study. Treat "ideas-only" as an owner call, not a settled exemption.
