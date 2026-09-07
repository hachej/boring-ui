---
title: Transparent multi-agent chat — stress-testing "a Job Thread looks like a chat"
subject: owner principle, 2026-08-25 — "a single-seat thread is indistinguishable from today's chat"
context: docs/plans/job-thread-v0-plan.md §2–§4 (relay / posts-only / projection), issue #1399
status: research + synthesis memo. Recommendations, not decisions. Ruling sheet at §6.
---

# Transparent multi-agent chat

**Principle under test** (owner, 2026-08-25; plan §4 *Continuity principle*): *multi-agent should feel transparent — a Job Thread looks like a current chat, just with several agents inside; a single-seat thread is indistinguishable from today's chat.*

**Verdict: the principle survives all seven edges, and the prior art is unusually kind to it.** Nine shipped systems were examined. Every one either (a) makes the human name the responder — Teams hard-gates on @mention, Discord made ambient message reading a review-gated privilege, Telegram and WhatsApp gate at the privacy layer, Character.ai and Poe make you tap or type the name — or (b) lets agents self-select and documents the cost: Grok Bot's own docs warn *"too many parallel handoffs can create duplicate work and noisy updates,"* and its loudest complaint is un-decomposable spend.

**Nobody has shipped autonomous multi-agent floor management.** Our relay is a third answer: the human addresses the *job*, and the floor is passed by a **typed tool under central caps**. So we never face prior art's unsolved question — *"which of N should answer this?"* — for any hop but the first. Microsoft states flatly that in Teams an *"agent loop conversation is not possible"*; that is precisely the capability the plan builds, bounded.

Three findings bite:

1. **Posts-only is a *prompt* boundary, not a *render* boundary** (Edge 7). It stops seat A's tool spew entering seat B's context window and says nothing about the human's screen. Worse, the naive fix — render posts only — *breaks* continuity, because today's chat renders tool cards and reasoning inline.
2. **Per-seat cost is the loudest complaint in the closest analogue and we cannot ship it.** `MeteringRunScope` has no job dimension (plan §3, already conceded).
3. **The industry's richest progress UX is unavailable exactly where multiple agents coexist.** Teams streaming is *"supported only in one-on-one chats,"* with *"only one concurrent streaming response per chat."* We are about to build what Microsoft declined to.

One sobering fact: **OpenAI ran the best-resourced version of "an assistant that decides when to chime in" for eight months and retired it 2026-07-09**, no adoption data published. Multi-responder chat is not a proven pattern — which makes the principle's conservatism (*look exactly like a chat; add nothing you don't have to*) the right posture.

---

## 1. Prior art at a glance

| System | Who replies | In-flight indicator | Identity | Overlap | Loudest complaint |
| --- | --- | --- | --- | --- | --- |
| **ChatGPT group chats** (Nov 2025 – **retired 2026-07-09**) | 1 bot, N humans; model *"decides when to respond and when to stay quiet based on context"*; `@ChatGPT` always summons; opt-in **Mention-Only** mode | Typing indicator; >1 responder never a problem | Human profiles + participant sidebar | Undocumented. Adding a person **forks the thread into a copy** | "Long-winded and annoying"; retired to "simplify the experience" |
| **Grok Bot** (xAI, ~Aug 2026) | 2–6 bots; *"write normally to let the participating Bots decide who should respond"*; routing key is each bot's *description*, written *"like a job description"*; ladder `@bot` → `@bot @bot` → `@everyone` (**sparingly**) | **No documented source** | name + **title** + description + avatar; role-shaped names ("Talent Scout") | Truly parallel, async wake; user message *"takes priority over background work"*. Documented failure: duplicate work + noisy updates; **mitigation is social only** | **Un-decomposable cost** — *"you cannot decompose it"*; 20-run history cap; no per-action audit |
| **Microsoft Teams agents** | **Hard-gated**: agents *"only receive messages when they're directly @mentioned"* — including replies to their own message. RSC firehose exists; **MS's own sample re-implements the gate**, reasoning *"users are more likely to engage with the agent if it responds only when it's addressed"* | **Streaming 1:1-only**; *"only one concurrent streaming response per chat"*; progress bar for informative updates; 1 req/s; Stop button default-on | App name + icon; **"AI generated"** label — *cannot be customised*, renders **only on the final message** | No arbitration — addressing, not negotiation. **Agents cannot talk to each other**; cannot @ two agents in one message. **Only platform with an all-agents-per-thread budget — 2× the single-agent budget regardless of agent count** | *"A reply helpful to one individual may interrupt five others"*; Channel Agents **auto-provisioned by default**; "agent sprawl" is now a named security-catalog entry |
| **Slack apps / AI agents** | No enforcement — **scope asymmetry**: `app_mentions.read` gives *"only the messages pertinent to your app"*; the firehose needs broad admin-reviewable scopes. **Slack's 2026 answer to N agents is a router** — Slackbot as *"the universal router"* | Best in class: `assistant.threads.setStatus` renders **`"<App Name> <status>"`**; `chat.startStream` with **task-update / plan-update** chunks, `task_display_mode: timeline\|plan` | Per-app bot user; per-message `username`/`icon` overrides. Tenets: *"users should never have to question whether they are interacting with a human"*; **"lead with function, not personality"** | 1 msg/sec/channel. Containment prescribed, not arbitrated: reply **in thread**, *"five issue updates should be one message, not five"*, emoji ack, ephemeral for sensitive output | *"Three weeks later, half the team had muted it"* — *"nobody wanted that—they wanted answers, not essays"* |
| **Discord bots** | **`MESSAGE_CONTENT` is a privileged, review-gated intent** (2022-09-01); without it a bot sees only DMs, its own messages, and **messages @mentioning it**. Slash commands need zero message access | 3-second ack or the token dies; `deferReply()` → *"<app> is thinking…"*. **No streaming primitive**; typing route discouraged | `APP` tag + verified check; webhooks take per-call `username`/`avatar_url`; embeds for sub-branding | **No official arbitration.** Best documented design (4 bots, one prefix): first-responder-wins **rejected — jitter fires several at once** → fixed hierarchy + 1s timeout + invisible in-band signalling. **Infinite reply loops** on shared prefixes. 50 req/s is **per token** — N bots = N×50 | Published admin advice is a dedicated **`#bot-spam` channel** |
| **Character.ai** (10 chars + 10 humans) | **User taps an avatar to pick the next speaker.** No self-selection | No documented source | Avatars as a *selection control* | Structurally cannot talk over | **Inertia, not cacophony**: "bots need a push"; dominance workaround is pinning *"Only speak when tagged"* |
| **SillyTavern** (best-documented policy anywhere) | Four strategies: **Manual / Natural Order** (name-mention + per-char *Talkativeness* + random) **/ List Order / Pooled Order**; plus Mute and **Force Talk** (bypass for one turn) | — | — | Self-responses **off by default** | Merged-persona identity bleed |
| **Poe · Meta AI (WhatsApp) · Telegram** | Explicit `@` only; Meta AI *"can only read and reply to questions that mention @Meta AI"*; Telegram **Privacy Mode on by default** | — | — | Harnesses add `requireMention` *"to keep routing deterministic"* | — |
| **Buzz** (Block, Jul 2026, OSS) | No documented floor control; triggers `message_posted`/reaction/schedule/webhook. **At most one prompt in flight per channel** | — | **Every human and agent has its own keypair** — attribution is first-class | Per-channel queue | No central home for caps or spend (#1399) |

**From the literature.** *CommunityBots* (CSCW 2023, [10.1145/3579469](https://doi.org/10.1145/3579469)) measured interruption rate **0.0167 vs 0.0335** single-agent — halved — attributing comprehension of bot switches to *visual cues integrated into the interface*: **invisible handoff is the defect, not multiplicity**. Chaves & Gerosa (CHI 2018, [10.1145/3173574.3173765](https://dl.acm.org/doi/10.1145/3173574.3173765)) found *no significant difference* in interactional coherence between one agent and several personas — cite it to resist "merge everything into one voice". SIGDIAL 2026 ([2026.sigdial-1.47](https://aclanthology.org/2026.sigdial-1.47/)) argues addressivity is **continuous, not one-of-N** — a router picking exactly one seat feels broken when a message is 0.7-addressed to A. [arXiv:2606.13544](https://arxiv.org/abs/2606.13544): role-conditioned turn-taking gave **+40% precision, +70% recall** and far fewer false-positive interruptions — our `role: "worker" | "reviewer"` is already that lever. NN/g requires *persistent* AI indicators but **has nothing on multi-agent attribution**.

---

## 2. Our starting position (verified in code)

Continuity is cheap for us because **the chat surface has no author affordance at all today** — nothing to un-build.

- `BoringChatMessage` (`packages/agent/src/shared/chat/boringChatMessage.ts:32-42`): `id, role, status, parts, createdAt, clientNonce, clientSeq, piEntryId, turnId`; role is `'user'|'assistant'|'system'` (`:3`). **No `agentTypeId`, no author, no model, no cost.**
- Assistant messages render **full-width bare text — no bubble, no header, no avatar** (`packages/agent/src/front/primitives/message.tsx:55-71`); only user messages get a bubble. Grep `Avatar` in `packages/agent/src/front` → zero non-test hits.
- The in-flight indicator is **one panel-level pill** reading `Working…` (`chat/components/PiChatComposerSurface.tsx:240-263`), above the composer, attached to no message.
- `PiChatPanelProps.agentTypeId` is a **single string** (`PiChatPanel.tsx:136`) — one panel, one agent.
- `@` autocomplete exists but is **files-only**: `detectMention` regex `/(^|[\s\n])@(\S*)$/` (`primitives/mention-picker.tsx:113-115`). Slash commands anchor at `^` (`useComposerPickers.ts:57`). **No reply-to affordance anywhere.**
- **No per-`agentTypeId` icon or colour registry exists**; the catalog carries `label` + `description` only (`useAddressedAgentSelection.ts:5`), and the one transform is `shortAgentLabel()` (`AppLeftPaneAgentCards.tsx:13-15`).

**Two precedents do most of the design work.** (1) `chatPaneAgentLabels(agents)` **returns `null` below 2 agents** (`workspace/src/front/layout/chatPaneAgentLabels.ts:11-16`) — the codebase already encodes *don't disambiguate what isn't ambiguous*. (2) `ChatMessageContributionBoundary` (`chat/messageContributions.tsx:10-15`) replaces the render of any matching message — the seam for chips and system lines with no fork of `PiTimelineMessage`.

**Colour is already spoken for:** accent-pulse and amber mean *working* and *needs attention* (`AppLeftPaneAgentCards.tsx:131-151`).

---

## 3. The seven edges

### Edge 1 — WHO ANSWERS an unaddressed message

**Prior art is near-unanimous, and the reason matters.** Teams hard-gates, then — given a firehose escape hatch — **re-implements the gate in its own sample**, justified by engagement: *"users are more likely to engage with the agent if it responds only when it's addressed."* Discord made ambient reading privileged in 2022. Slack made mention-only cheap and the firehose expensive. Telegram ships Privacy Mode on. **All four closed the road where N agents each judge "was that for me?"** Where self-selection did ship, it comes with a retirement notice (ChatGPT) or a cost complaint (Grok Bot). The one serious attempt at leaderless arbitration — four Discord bots on one prefix — found **first-responder-wins fails because jitter fires several at once**, and settled for a fixed hierarchy plus a 1s timeout, paying a latency tax on every command.

**Our situation is structurally different, and this is the key move:** the unaddressed-message problem exists only for **hop 1 of a chain**. Every later hop is addressed by a typed `handoff({to, message})` (plan §2), not inferred. We need a *default address*, not a router.

**Recommendation — default-seat by role, with one exception.**

- Unaddressed human message → **the `role: "worker"` participant**, as plan §5 step 2 already says. Least surprising because the address is a stable property of the staffing, visible in the chips, identical Monday and Friday.
- **The exception the plan does not state: an open `ask_user` gate owns the address.** On a `suspended` chain the human's next message answers *the seat that asked* — not stickiness but a gate with an `answerToken` already keyed to a session (`askUserRuntime.ts:160-177`), resolved via §4's participant triple. Any other rule answers the wrong seat.
- **Reject last-speaker-sticky.** It makes the address invisible *and* mutable: the same typed message means different things depending on history the composer doesn't show. No shipped product uses it.
- **Reject a router in v0 — while naming the strongest counter-evidence in this memo.** Slack's 2026 bet *is* a router (Slackbot as *"the universal router"*), the only first-party N-agent answer shipped. Still defer: a misroute is **invisible** (a confident answer from the wrong seat), and SIGDIAL 2026 says one-of-N is the wrong frame. The owner already recorded the v1 path on #1399 — *"description-matching routing paired with explicit @-override."* Nothing here blocks it; a router later replaces one function, and `@` (Edge 6) is the same pressure valve either way.

**Least-surprising test:** with one seat, "default seat" degenerates to "the assistant" — byte-for-byte today.

### Edge 2 — CONCURRENT RESPONDERS

**The industry ran this experiment and retreated.** Teams — the most mature progress UX anywhere — restricts streaming to 1:1 and permits *"only one concurrent streaming response per chat."* Buzz holds **one prompt in flight per channel**. SillyTavern disables self-responses by default. Character.ai is serial by construction. Grok Bot alone allows true parallelism and alone documents the consequence, mitigated only socially. **No product documents a multi-responder typing indicator** — nobody lets two agents stream into one room, so the question has never been answered.

**Recommendation — serialize, and promote it from scope cut to design position.**

- v0 is already serial: `relayChain` advances only on **settled** turns, `turnOrdinal` is a single store-owned monotonic integer under one CAS lock, caps are per-chain. Plan §6 non-goal 4 should be restated as intent: **we are ahead of Buzz and Grok Bot precisely because there is a serializer.**
- **Interleaving ≠ concurrency.** Two chains can be live if the human posts mid-flight (new `chainId`, fresh counters, §3) — real interleaving of *human* turns, ordered by `turnOrdinal`. Within a chain, one floor-holder.
- **The typing indicator gains an attribution and nothing else.** Change the pill (`PiChatComposerSurface.tsx:240-263`) from `Working…` to **`<Seat> is working…`**, sourced from the edge whose latest transition is `accepted`. This is exactly Slack's shipped shape (`setStatus` renders `"<App Name> <status>"`). Serial ⇒ at most one ⇒ **no per-seat indicator array**; the component survives unchanged. One seat ⇒ `Working…` as today.
- **Steal Slack's advancing-status discipline** — status should progress and stay *"glanceable, not paragraphs."* Our handoff markers give the free version: the pill's name changes when the floor moves.
- **`suspended` ≠ working.** An `ask_user` gate must flip the pill off, or the user sees "working" while nothing runs.
- **If parallelism ever lands, steal Teams' sublinear budget** — its all-agents-per-thread cap is **2× the single-agent budget regardless of agent count**. Our per-chain hop/invocation caps are the same instinct.

### Edge 3 — IDENTITY LEGIBILITY at chat density

**"Mine + assistant" stops being enough the moment the floor changes hands. Not before.**

Prior art converges on **per-sender identity, never per-message ornament**. Slack: app name + avatar, the tenet that *"users should never have to question whether they are interacting with a human,"* and the naming rule **"lead with function, not personality"** (*"Recruit Assistant", "Deal Desk"*). Grok Bot demands role-shaped names because the name **is** the routing key. Teams' "AI generated" label **cannot be customised and appears only on the final message** — per-message badging is reserved for the payload, not the chatter.

**Recommendation — label the cluster head, not every message.**

1. **Name line on the first message of each seat's turn-block**, suppressed when the job has one active participant — a direct generalisation of `chatPaneAgentLabels` returning `null` below two agents.
2. **Never collapse a cluster across a handoff.** The one place the standard clustering convention must be overridden: two consecutive assistant messages from *different* seats are two clusters however close in time. Turn boundary beats vertical density.
3. **The quiet inline handoff line does the heavy lifting**, not the chip — plan §4's `joined`/handoff/`left` lines are the *"visual cues integrated with the interface"* CommunityBots measured as halving interruption. Reuse `noticeSurfaceClass(level,'text-xs')` (`noticeStyles.ts:5-27`) at info level; no bespoke component.
4. **No per-agent colour palette in v0.** Accent and amber already mean working/attention; colour identity collides with live state, and colour-alone identity is an accessibility failure regardless. Label + role suffix suffices at 2–3 seats, which is all §6 non-goal 4 permits.
5. **Adopt the role-shaped naming discipline** shared by Slack and xAI: K7's fleet agents should read "Growth Writer" / "Growth Reviewer", not "Boring Creator Growth Worker".

**Cost.** `BoringChatMessage` has no field for this (`:32-42`). Prefer a projection-side view model in the S4 adapter over widening the canonical message type — S4 is already scoped as a message-source adapter, and the blast radius is smaller.

### Edge 4 — WHERE TRANSPARENCY MUST BREAK

**Governing rule:** *a break may add **one line or one hover action**, never a second surface. If it needs a panel, it belongs behind drill-down.* That is the containment ladder every platform converged on (ephemeral → reaction → thread → batched → public), compressed to one chat panel.

- **(a) Drill-down to a seat's session.** Extend `MessageActionsBar` — today only Copy (`PiTimelineMessage.tsx:394-460`) — with `Open <Seat>'s session` on the cluster head, on hover, at Copy's weight. Keep the plan's framing in the copy: *per-agent sessions are CI logs behind a PR check.*
- **(b) Failure states.** Every abnormal end already yields a terminal transition (§2 table) and a derived marker. Render through the **existing** surface: inline `NoticeBubble` (`PiTimelineMessage.tsx:336-348`) for turn-scoped, `RuntimeNoticeMessages` (`ChatNotices.tsx:37-70`) for job-scoped. `capped` / `outcome-unknown` / `participant-unavailable` read as one plain sentence naming seat and cause — *"Stopped: hop limit (3) reached after Growth Reviewer."* Never a stack trace, never silent.
- **(c) Approval gates** — already a chat idiom. `AskUserQuestion` renders inline today and §4 keeps it unchanged, joined on the full `(workspaceScopeId, agentTypeId, sessionId)` triple; the only addition is naming the asking seat. Prior art converges from the other side: Teams pairs targeted messages with **Approve / Reject / Share** before anything is reposted publicly. **But carry this warning:** Teams' targeted messages *"expire 24 hours after being sent… Teams deletes them from all clients."* Our gates hold an `answerToken` and a suspended chain — they must be **durable, never ephemeral**.
- **(d) Per-seat cost — the honest gap.** Grok Bot's dominant complaint is not that spend is high but that **it cannot be decomposed**. We cannot fix it in v0: `MeteringRunScope` (`pi-chat/metering.ts:45-53`) has no job/thread/participant field and reservations key on `runId = pi-run:${sessionId}:prompt:${clientNonce}` (`:197-202`). **Recommendation:** ship without per-seat cost, but **not without the hop counter visible** — a one-line footer on a settled chain, *"3 turns · 2 handoffs · cap 3"*, derivable from `JobChainStateV0` at zero new plumbing. Grok Bot's users learned about unbounded chains from their bill; ours should learn from the timeline.

### Edge 5 — CONTINUITY / MIGRATION

**Is every existing chat retroactively a Job Thread?** *Conceptually yes, mechanically no, and one contract blocks the retrofit.* Conceptually the principle demands it — if a one-seat thread is indistinguishable from today's chat, today's chat *is* a one-seat thread and the distinction is unobservable. Mechanically it is false today:

1. **No existing session carries a `jobId`.** `JobProjectionV0` lives in a separate plugin store; nothing back-references it. Retrofitting every session means a projection record per session — the "no new machinery" cost #1401 avoids.
2. **`turnOrdinal` does not exist for pre-job history.** Merge order is `(turnOrdinal, seq, markerOrdinal)` and `turnOrdinal` is minted by `openEdge()`. **This is the concrete blocker and it needs a rule:** pre-upgrade history anchors at **`turnOrdinal = 0`** as one block, ordered internally by `seq` (or array position under §3's snapshot-degraded rule), with the first relay-minted edge at 1. Cheap — but a contract addition, not a derivation.
3. **`ConsoleThreadRefV1`'s unique key is single-seat by construction** — §7 already flags it must be repaired before #1355 implements.

**Recommendation — lazy upgrade, never retroactive migration.**

- A chat becomes a Job Thread **the moment a second participant is added**. One CAS write mints `JobProjectionV0` with `participants[0]` = the existing session (`worker`, `active`), history at ordinal 0, **a fresh `chainId` — caps must never be back-computed from prior turns** — and a `joined` marker. The rest exists already: S6's `+` picker and the inline add-confirm on an unstaffed `@mention` *are* the upgrade gesture, and §3's *"onboarding context is bounded by construction"* (`deliveredThroughOrdinal = 0`, oldest-first truncation) handles catch-up.
- **In place, never forking.** ChatGPT group chats **copied the conversation into a new thread** on invite and drew sidebar-clutter complaints. Ours: same thread, same row, same URL — a `joined` line appears, the composer gains a chip. That is the whole visible change.
- **Staffing stays human-initiated.** Teams auto-provisions a Channel Agent *"for any new channel that an eligible user creates"* (off by default only for EDU), and "agent sprawl" is now a named Microsoft security-catalog entry. Plan §3's *"staffing is an explicit human act in v0"* is the right side of that line and should be defended as a position, not an omission.
- **Downgrade is `bindingState: "removed"`, never deletion** — already in the plan, already history-preserving.

### Edge 6 — COMPOSER GRAMMAR

**`@` is the universal override**, and Teams has already designed the picker for us: typing `/` lists commands from **all agents in the conversation**, each *"with its description and its agent's name and icon, making them discoverable and distinguishing between commands with the same name"* — and invoking one **switches the compose box to targeted-message mode** for that agent alone. A shipped, two-level, identity-annotated picker plus a one-shot address.

1. **One `@` picker, two sections — Agents above Files.** The real collision: `detectMention` (`mention-picker.tsx:113-115`) resolves `@` to file paths only. **Do not mint a second sigil** — every prior-art system uses `@` for people-shaped things; a `#agent` convention would be ours alone. Rank agents first on an empty query, files first once the token looks path-shaped. Annotate each agent row with its role.
2. **`@seat` is a one-shot address, never sticky** — overrides the default seat for that message only. Grok's ladder, SillyTavern's Force Talk, Teams' targeted mode. Preserves Edge 1's predictability.
3. **`@` stays optional** (plan §4 already commits). Our biggest deliberate divergence from Teams/Telegram/WhatsApp gating — right for us because the human addresses a *job*, and the floor is passed by tool, not inference.
4. **No `@everyone` in v0.** Grok discourages it; **Teams forbids mentioning two agents in one message outright**; CSCW 2022 ([10.1145/3555112](https://dl.acm.org/doi/10.1145/3555112)) found individually-specified addressing most effective *and* most preferred. It also has no meaning against a serial relay — it would either fan out (violating Edge 2) or silently pick one.
5. **`@unstaffed-agent` → inline add-confirm** (plan §3), which is also Edge 5's discoverable upgrade gesture. Never resolve to nothing.
6. **Defer reply-to-a-message.** It doesn't exist today (no `replyTo` in `packages/agent/src/front/chat`); ChatGPT shipped it; but it is a second addressing channel layered on the first, and SIGDIAL 2026 says two channels compound ambiguity. **Teams solved the underlying problem — orphaned replies in a busy thread — without a reply channel**, via *Prompt Preview*: a compact preview of the original request above the agent's response. That is the cheaper fix for us too, and it composes with Edge 3's cluster-head name line. If reply-to ever lands, the only defensible semantic is narrow: **it addresses that post's seat** — sugar for `@seat`, not new context scoping.

### Edge 7 — NOISE COLLAPSE

**The sharpest finding: posts-only is a prompt boundary, not a render boundary.** Plan §2 is explicit and correct — *"posts-only governs one thing only: what enters a participant's prompt."* That protects seat B's context window. **It says nothing about the human's screen.** Render each seat's full event stream and two seats produce two full streams of tool cards and reasoning; the principle fails on density alone. **But the naive fix breaks continuity** — "render posts only" strips tool cards and reasoning from a *single-seat* thread, which renders them inline today (`ToolCallGroup`, `TimelineReasoningPart`). That is the principle inverted.

**Recommendation — collapse on settle, not by seat.**

> A turn renders in full while it holds the floor. When it settles and the floor moves, its intermediate chrome collapses to the final post plus one summary pill.

- **Single-seat: the floor never moves, so nothing ever collapses** — byte-for-byte today's chat. The rule is chosen *because* it satisfies the continuity test, not bolted on after.
- **Multi-seat: at most one turn is ever expanded** (the live one) ⇒ chrome is **O(1) in seats, not O(N)**. Two seats over ten hops = ten final posts, nine handoff lines, one live turn.
- Mechanics already default right: `ToolCallGroup` is `useState(false)` — *"always start collapsed — the header is the live status"* (`tool-call-group.tsx:107-109`), ≈40px+12px collapsed; reasoning is `defaultOpen={false}` under panel-level `showThoughts` (`PiTimelineMessage.tsx:218-253`), ≈16–20px. The new part is *dropping the group entirely* into one pill (`4 tool calls · 2 files read`) once a turn is settled and superseded, full detail one click away (Edge 4a).
- **`showThoughts` stays panel-level.** A per-seat reasoning toggle is a dashboard control in disguise; the setting already persists (`PiChatPanel.tsx:371-390`).
- **Batch relay markers the way Slack batches updates** — *"five issue updates should be one message, not five."* Consecutive `joined` markers from one staffing action are one line.
- **Never put status in reactions or any easily-missed channel.** Microsoft is candid: *"reactions can go unnoticed… it's easy to miss when used for live status updates."* Status belongs in the pill and the handoff line.

**Remaining chrome per floor change:** one handoff line (~20px `text-xs`) plus one cluster-head name line — roughly **40px per handoff**, the legibility price CommunityBots measured as worth paying.

**Write the asymmetry down:** the human sees more than any agent — every seat's final posts, *plus* the live turn's tool calls, *plus* system markers, while seat B's prompt sees only final posts and markers. Correct and deliberate (the human is the approver), but "posts-only" is otherwise easily misread as a claim about the UI.

**The complaint that should scare us is verbosity, not density.** The one hard user datum in the whole set: an agent deployed to a Slack workspace, and *"three weeks later, half the team had muted it"* — accurate, well-explained, but *"nobody wanted that—they wanted answers, not essays."* ChatGPT drew the same charge. Microsoft's conclusion is the line for the wall: ***"the best collaborative agents will not be the ones that respond the most, but the ones that know when and how to answer."*** No collapse rule saves a job thread whose seats write four paragraphs a hop — that is a fleet-prompt problem, and it belongs in K7's acceptance criteria.

---

## 4. What would falsify the principle

1. **A single-seat Job Thread renders differently from today's chat in any pixel.** Plan S4's negative proof already asserts it — keep it as the gate.
2. **A user cannot answer "who did this, and why is it here?"** from the timeline alone. That is CommunityBots' comprehension failure; the cue is name-line + handoff line.
3. **Chrome grows with seat count.** If a third seat visibly lengthens the transcript per unit of work, Edge 7's rule is not holding.

## 5. Source honesty

- **Thin exactly where we most need it.** *No system documents a multi-responder typing/streaming indicator* — not ChatGPT, Grok Bot, Character.ai, Buzz, Slack, Discord, or Teams (which is explicit that streaming is 1:1-only). **Edge 2 is derived from our own serial architecture, not from prior art.**
- **Reddit was unreachable** in both research passes (400/403); every user complaint cited is secondary-source. The failure modes one would *expect* — "the wrong bot answered", "bots talked over each other" — have **no documented source**. Character.ai's documented failure is the opposite: inertia.
- **OpenAI's blog and help centre are Cloudflare-403** to automated fetch; group-chat quotes are relayed via The Register, TechCrunch, Tom's Guide, TechRadar, all quoting OpenAI directly. **No adoption data was ever published**, and "simplifying the experience" is PR-shaped — do not over-read the retirement as proof the pattern failed on the merits.
- **Character.ai's primary FAQ returned 403.** Tap-to-select is corroborated by three independent 2026 guides, not first-party. The desktop "Rooms" beta was retired 2024-09-24 with no published explanation.
- **Grok Bot's docs have no group-chat troubleshooting section at all.** Cost complaints are well-sourced; routing complaints don't exist yet — the product is weeks old.
- **The "half the team muted it" quote** comes from a case-study blog that 403'd the fetcher; the quote is from the search index, body unread. Best user datum in the set *and* least verifiable — weight accordingly.
- **No official arbitration guidance exists on any platform.** Discord's best documented design is one developer's blog post about four of his own bots; Slack and Teams simply never address two agents answering the same message.
- **NN/g has nothing on multi-agent attribution.** The strongest evidence here is academic, not commercial — CommunityBots (CSCW 2023) and Chaves & Gerosa (CHI 2018) are both small-N lab studies, not production telemetry.

---

## 6. Ruling sheet

| # | Edge | Recommended default (one sentence) | Status |
| --- | --- | --- | --- |
| 1 | **Who answers** | An unaddressed message goes to the `worker` participant — a stable, chip-visible default seat — **except** when a chain is suspended on an `ask_user`, where the asking seat owns the address; no router and no last-speaker stickiness in v0. | **Derivable** — plan §5 already states worker-default; the ask-user exception is new but forced by `answerToken` semantics. *Note the counter-evidence: Slack's 2026 first-party answer is a router.* |
| 2 | **Concurrent responders** | Serialize — one floor-holder per chain, no interleaved bubbles — and the existing single `Working…` pill simply gains the seat's name, exactly as Slack's `setStatus` renders `"<App Name> <status>"`. | **Derivable** — the relay is serial by construction, and Teams ships the same constraint (*"one concurrent streaming response per chat"*). **Owner ruling deferred to v1**: whether parallel fan-out interleaves or renders behind a barrier (recommend barrier). |
| 3 | **Identity legibility** | Name-line on the **first message of each seat's turn-block**, never on every message, suppressed entirely at one active participant; clusters never merge across a handoff; **no per-agent colour in v0**. | **Derivable** — generalises `chatPaneAgentLabels`' existing null-below-2 rule; colour is already semantic (working/attention). **Owner taste**: whether chips carry a monogram or avatar at all. |
| 4 | **Where transparency breaks** | A break may add **one line or one hover action** and never a second surface: drill-down joins `MessageActionsBar` beside Copy, failures reuse the notice surface, approvals stay the existing inline `AskUserQuestion` block (durable, never expiring), and a settled chain shows a one-line `3 turns · 2 handoffs · cap 3` footer. | **OWNER RULING** on **per-seat cost**: unbuildable in v0 (`MeteringRunScope` has no job dimension) yet it is the loudest complaint in the closest shipped analogue. Confirm shipping without it, with the hop-counter footer as the interim runaway signal. |
| 5 | **Continuity / migration** | Every chat is *conceptually* a one-seat Job Thread but nothing is migrated: a thread upgrades **lazily and in place** when a second participant is added — same thread, same row, same URL, never a fork — with pre-upgrade history anchored at `turnOrdinal = 0` and a fresh `chainId`. | **OWNER RULING** — the `turnOrdinal = 0` anchoring rule and in-place upgradeability are additions to the plan, not readings of it; plan §6 is silent. Also ratifies rejecting ChatGPT's fork-on-invite and Teams' auto-provisioned agents. |
| 6 | **Composer grammar** | One `@` picker with two sections (Agents ranked above Files, annotated with role, reusing `detectMention`), `@seat` as a **one-shot** address that never sticks, `@` always optional, **no `@everyone`**, an unstaffed `@agent` opening the inline add-confirm, and reply-to deferred in favour of a Teams-style prompt preview. | **Derivable** on grammar — Teams ships the two-level identity-annotated picker plus one-shot targeting. **OWNER RULING** on scope: extending the files-only `@` picker to agents is real S4 work while the staffing UI (S6) is deferred — confirm `@seat` ships in v0 or waits for S6. |
| 7 | **Noise collapse** | **Collapse on settle, not by seat**: a turn renders in full while it holds the floor and collapses to its final post plus one summary pill when the floor moves — so a single-seat thread never collapses anything and chrome stays O(1) in seat count. | **Derivable** — it is the only rule that satisfies the continuity test. **Worth an explicit owner note**: posts-only is a *prompt* boundary, this is the separate *render* boundary, the human deliberately sees more than any agent, and **verbosity — not density — is the failure mode users actually punish**, which makes seat-prompt brevity a K7 acceptance criterion. |

**Three sentences if nothing else is read:** the principle holds, and the prior art says our relay already solves the problem every shipped competitor punted on — nobody has autonomous floor management, and the two systems that tried self-selection are one retirement notice and one cost complaint. Two things need your call: **per-seat cost** (unbuildable in v0, loudest complaint in the field) and **whether an existing chat upgrades in place** (needs a `turnOrdinal = 0` rule the plan does not have). Everything else derives from one test — *with one seat, does it look exactly like today?*
