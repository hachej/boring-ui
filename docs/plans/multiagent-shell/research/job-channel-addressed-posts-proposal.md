---
title: Job channel = the Thread, with addressed posts — proposal
status: PROPOSAL (research, not dispatchable). Tier 1 is gate-free and can be folded into the post-shape-spike engine plan; Tier 2 is a candidate input to the post-P1 relay-vs-blackboard ruling and needs its own promotion gate (RECONCILIATION §7).
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
| D25/D28: artifacts shared through the workspace; per-seat authority | File "reservations" are advisory markers only; exclusivity, if ever, lives in Environment admission. |

**Conflicts:** none for Tier 1. Tier 2 would conflict with §7 unless promoted — that is the point of separating the tiers.

## Today / Delta

**Today.** The Thread is a single merged timeline of Sessions' posts (§7 collapse, §9b presentation). A post has an author Seat (P3 will make `seatId` audit-grade) but **no addressee**, no acknowledgement semantics, no importance, and no way for a human to say "this is an interrupt" vs "ambient context". Agents talk to each other only through the orchestrator relaying posts (D22 native binding default). The deep-dive already found that *invisible* handoffs are the defect (CommunityBots), and scoped a one-shot `@seat` address (Edge 6).

**Delta (Tier 1).** Give posts an address and an ack, in the Thread, visible to the human. That is the whole "1:1 and 1:n" ask, without leaving the ratified shape.

## Tier 1 — addressed posts in the Thread (gate-free)

Typed metadata on a post (wire-additive, all optional):

```ts
interface PostAddressingV0 {
  to?: SeatRef[]              // 1:1 = one seat; 1:n = several; absent = the job (everyone)
  cc?: SeatRef[]              // visible-to, not expected-to-act
  importance?: 'ambient' | 'normal' | 'interrupt'
  ackRequired?: boolean       // recipients must post an ack marker
  inReplyTo?: PostRef         // reply edge, for threading within the timeline
  intent?: { kind: 'edit-intent'; paths: string[]; ttlSeconds: number }   // advisory only (system marker)
}
```

Semantics:
- **Addressing does not change visibility.** Every post stays in the one Thread transcript the human reads; `to:` says *who is expected to act*, and the §9b chips render it ("→ Researcher"). This is what makes 1:1 legible instead of hidden.
- **Delivery is the orchestrator's relay, unchanged.** An addressed post is a routing hint to the orchestrator's next-turn selection (the deep-dive's description-matching routing with explicit @-override), not a direct agent→agent send. No hop counter is bypassed; per-chain caps stay host-enforced.
- **`ackRequired` produces a system marker** (`acked-by: <seat>`), not free text; unacked-after-N-turns surfaces as an Attention item to the human — the Attention ledger (P1-A3) already owns "someone must act".
- **Human posts carry `importance`.** `interrupt` = "pause current work, do this, resume" (agent-mail's overseer preamble, made a marker instead of prose); `ambient` = context, no turn expected.
- **`edit-intent` is advisory**, rendered as a marker ("Coder intends to edit src/x.ts for 10 min"); conflicts are shown, never enforced here. Enforcement, if ever needed, is an Environment-admission concern (D28).
- **Signed Thread export** (Ed25519 + redaction presets) is filed under Delivery/evidence ideas, unrelated to addressing.

Where it lands: the post schema and the §9b chip renderer, i.e. the post-shape-spike engine plan and the thread-view slice (L4). Storage-neutral: works over projection or first-class stream. **Not dispatchable until that engine plan exists** — this proposal is its input.

## Tier 2 — subscriber inboxes (gated; input to relay-vs-blackboard)

What agent-mail actually is: per-recipient durable inboxes over a shared store, agents polling. In our nouns: a **per-Thread subscriber projection** — each Seat reads a filtered view of the Thread (`to: me` ∪ broadcast ∪ replies to me) instead of the whole transcript, and may post without the orchestrator selecting it. That is the blackboard candidate with a filter, and it is what §7 says needs a promotion gate: it creates a shared-runtime room and an A2A path.

If the post-P1 ruling picks blackboard, Tier 2 adds to Tier 1: (a) per-Seat read cursors on the Thread stream (Level D makes this cheap), (b) a wake-up rule (subscriber turns are still admitted and capped by the host — never polling), (c) contact policy = Seat authority, not a spam filter. If the ruling keeps relay, Tier 1 alone delivers the visible 1:1/1:n and Tier 2 is dropped.

## What we do NOT take from agent-mail

Random-name identities (Seats are ours; role names stay), name+token attribution (P3 `seatId`), polling + paid companion wake-up, git-hook lock enforcement, separate per-agent inbox UI (the Grok Bot fragmented-threads failure), any code (license rider).

## Proof (when an engine plan adopts Tier 1)

- A fixture Thread with three Seats: a `to:[Researcher]` post is relayed to Researcher's next turn and to no other Seat's context; the human transcript shows the chip; `ackRequired` without ack for 2 turns creates one Attention item; an `interrupt` human post preempts the orchestrator's queued turn once.
- Negative: no post is delivered to a Seat that is not the orchestrator without a relay hop (assert hop ledger); no context crosses except settled posts (deep-dive Edge 7 test).

## Open questions (who answers)

- (owner, post-P1 gate) relay vs blackboard — decides Tier 2's fate.
- (engine plan) whether `to:` on a *human* post forces the addressee's turn or only prefers it.
- (P3) chip rendering of `to:` requires audit-grade seat identity — sequencing only.
