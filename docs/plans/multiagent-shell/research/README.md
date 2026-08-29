# Research — index

**Precedence inside this folder:** empirical spike reports beat analyses that
predate them; a dated banner at the top of a file beats the body beneath it
(the body is kept as historical record, not current guidance); this index
names every supersession so nobody has to diff two files to find it.

| File | What it is | Status |
|---|---|---|
| [`pi-core-adoption-spike-report.md`](pi-core-adoption-spike-report.md) | Empirical spike against the real installed `pi 0.84.3` npm package (`AgentHarness` operational surface vs storage layer). Wins over all earlier pi analysis where they conflict. | **CURRENT EVIDENCE** (2026-08-27) |
| [`thread-storage-competitor-study.md`](thread-storage-competitor-study.md) | Seven-system comparative study of thread/conversation storage models (P2 Part A). Feeds the P2 spike; does not itself choose a Boring storage model. | **CURRENT EVIDENCE** |
| [`pi-v2-alignment.md`](pi-v2-alignment.md) | Pi v2 (`AgentHarness`) adopt/track/rewrite analysis. The **post-spike verdict banner at the top is current** (do not wire pi 0.84.3 under D29; the former wait-for-pi on the event store was removed 2026-08-27 — RECONCILIATION §9c — P1-B builds the Boring backend, and this doc's criteria are the future replacement bar). The body below the banner is the **pre-spike historical record**, superseded by `pi-core-adoption-spike-report.md` wherever the two conflict. | **CURRENT DECISION RECORD** (banner) / pre-spike body superseded |
| [`agentlane-vs-automation.md`](agentlane-vs-automation.md) | Owner-forwarded external analysis: where Pi AgentLane, the automation plugin, and Boring Work/Thread/Seat semantics each belong. Its 10-item lane gate **supersedes the 5-item lane list inside `pi-v2-alignment.md`**; establishes the hybrid topology and the automation-dependency ruling. | **CURRENT GATE MATERIAL** |
| [`pi-v2-removal-map.md`](pi-v2-removal-map.md) | Deletion audit: what Boring UI stops owning if pi v2 lands. Carries its own reconciliation banner correcting four of the original map's claims (D29 gateway survives, session data stays host-owned, etc.). | **REFERENCE** (corrected by its own banner) |
| [`full-vision-review-2026-08-27.md`](full-vision-review-2026-08-27.md) | External full-vision review of PR #1409 (owner-supplied, against head `12da2af`). Its §7 amendments have been folded into the planning text; this file is the disposition record of what was folded and why. | **DISPOSITION RECORD** (folded) |
| [`transparent-multiagent-chat-deepdive.md`](transparent-multiagent-chat-deepdive.md) | Prior-art stress-test of "a Job Thread looks like a chat" against nine shipped multi-agent/chat systems. Recommendations, not decisions (ruling sheet at its §6). | **HISTORICAL RESEARCH** |
| [`console-ux-spike.html`](console-ux-spike.html) / [`console-ux-spike.png`](console-ux-spike.png) | Console UX spike mockup, rescued from session scratch. Design input, not a ratified artifact. | **HISTORICAL RESEARCH** |

Not sure which file answers a live question? Check the chapter that cites it
first ([`premises.md`](../premises.md) §P2 for storage, the engine gate
material for pi/automation) — this index is for orientation, not for
re-deriving rulings that already live in the pack.
