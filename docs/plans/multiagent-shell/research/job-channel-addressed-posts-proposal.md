---
title: Job channel = the Thread, with addressed posts — proposal
status: PROPOSAL (research, not dispatchable). Tier 1 needs no §7 promotion gate but is still downstream of P1 (engine on Level D), P1-A3 (attention ledger delta) and P3 (audit-grade seatId) — it folds into the post-shape-spike engine plan, not before. Tier 2 is a candidate input to the post-P1 relay-vs-blackboard ruling and needs its own promotion gate (RECONCILIATION §7).
review: fresh-eyes 2026-08-29 folded (10 findings); cross-model pass pending
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

```ts
interface PostAddressingV0 {
  to?: SeatRef                // exactly one Seat; absent = the job (Edge 6.4: no multi-mention, no @everyone)
  importance?: 'ambient' | 'normal' | 'interrupt'
  ackRequired?: boolean       // host emits an ack marker when the addressee's next turn settles
  intent?: { kind: 'edit-intent'; paths: string[] }   // plain advisory system marker; no TTL, no conflict index
}
```

(Rejected from the analysed model after review: `cc`, multi-seat `to`, `inReplyTo`, TTL'd reservations — see the rule-11 rows.)

Semantics:
- **Addressing changes neither visibility nor context scoping.** Every post stays in the one Thread transcript the human reads (render boundary), and every Seat's prompt context is built exactly as today's relay builds it (prompt boundary, deep-dive Edge 7) — `to:` never subtracts a post from anyone's context. `to:` says *who is expected to act*, and the §9b chips render it ("→ Researcher"). Any `to:`-based prompt filtering is Tier 2, by definition.
- **Selection is the orchestrator's, unchanged.** An addressed post is a routing hint to the orchestrator's next-turn selection (the deep-dive's description-matching routing with explicit @-override). A **human** `to:` prefers the addressee; an **agent** `to:` is advisory and the orchestrator may override it — otherwise agent A would be invoking agent B with the orchestrator as a transport hop (§7). No hop counter is bypassed; per-chain caps stay host-enforced.
- **`ackRequired` produces a host-emitted system marker** (`acked-by: <seat>`) when the addressee's next turn settles — not a costed extra turn. "Unacked after N turns → Attention item" is **a P1-A3 delta, not free**: it needs an additive attention `kind`, a nullable run FK (no parked turn), and a Seat-owned actor; A3's record today is the C5 pause record keyed by `(runRequestKey, toolCallId)`. Filed as an A3 follow-up, not assumed.
- **Human posts carry `importance`.** `interrupt` = "pause current work, do this, resume" (agent-mail's overseer preamble, made a marker instead of prose); `ambient` = context, no turn expected.
- **`edit-intent` is a plain advisory marker** ("Coder intends to edit src/x.ts"), with no TTL and no conflict index in Tier 1 — a live lease index would be mutable cross-seat coordination state, which is not what "system marker" means under posts-only. Enforcement, if ever needed, is an Environment-admission concern (D28).
- **Signed Thread export** (Ed25519 + redaction presets) is filed under Delivery/evidence ideas, unrelated to addressing.

Where it lands: the post schema and the §9b chip renderer, i.e. the post-shape-spike engine plan and the thread-view slice (L4). Storage-neutral: works over projection or first-class stream. **Not dispatchable until that engine plan exists** — this proposal is its input.

## Tier 2 — subscriber inboxes (gated; input to relay-vs-blackboard)

What agent-mail actually is: per-recipient durable inboxes over a shared store, agents polling. In our nouns: a **per-Thread subscriber projection** — each Seat reads a filtered view of the Thread (`to: me` ∪ broadcast ∪ replies to me) instead of the whole transcript, and may post without the orchestrator selecting it. That is the blackboard candidate with a filter, and it is what §7 says needs a promotion gate: it creates a shared-runtime room and an A2A path.

If the post-P1 ruling picks blackboard, Tier 2 adds to Tier 1: (a) per-Seat read cursors on the Thread stream (Level D makes this cheap), (b) a wake-up rule (subscriber turns are still admitted and capped by the host — never polling), (c) contact policy = Seat authority, not a spam filter. If the ruling keeps relay, Tier 1 alone delivers the visible 1:1/1:n and Tier 2 is dropped.

## What we do NOT take from agent-mail

Random-name identities (Seats are ours; role names stay), name+token attribution (P3 `seatId`), polling + paid companion wake-up, git-hook lock enforcement, separate per-agent inbox UI (the Grok Bot fragmented-threads failure), any code (license rider).

## Proof (when an engine plan adopts Tier 1)

- A fixture Thread with three Seats: a human `to: Researcher` post makes the orchestrator select Researcher next; **every Seat's prompt context is identical to the unaddressed case** (Edge 7 assertion — addressing scopes nothing); the human transcript shows the chip; the host emits one `acked-by: Researcher` marker when that turn settles; an `interrupt` human post preempts the orchestrator's queued turn once; an agent-authored `to:` that the orchestrator overrides produces no error and no hidden delivery.
- Negative: no post reaches a Seat without a relay hop (assert hop ledger); no context crosses except settled posts (Edge 7 test); **a single-seat Thread with no addressing fields renders byte-for-byte as today** (§10a, deep-dive falsification #1).

## Open questions (who answers)

- (owner, post-P1 gate) relay vs blackboard — decides Tier 2's fate.
- (engine plan) whether `to:` on a *human* post forces the addressee's turn or only prefers it; agent-authored `to:` is already ruled advisory above.
- (P1-A3) the additive attention kind for unacked posts — sized inside A3's follow-ups, not here.
- (P3) chip rendering of `to:` requires audit-grade seat identity — sequencing only.
- (owner, legal) the analysed project's license rider: its "use" definition arguably reaches analysis and field-level derivation, not only code lift — see the study. Treat "ideas-only" as an owner call, not a settled exemption.
