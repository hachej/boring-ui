---
title: MCP Agent Mail — a mailbox shape for per-job agent messaging?
subject: owner question 2026-08-29 — can "Gmail for coding agents" model 1:1 / 1:n agent talk inside one job, beside the work
context: RECONCILIATION §7–§10 (multi-seat Thread, multi-author transcript, no A2A loopback); premises.md P1 "Relay-vs-blackboard — post-P1"
status: research memo, ideas only. No code reuse (see license). Verdict row in docs/vision/explorations.md. Proposal derived from it: research/job-channel-addressed-posts-proposal.md
---

# MCP Agent Mail study

**Subject:** `Dicklesworthstone/mcp_agent_mail` — https://github.com/Dicklesworthstone/mcp_agent_mail
(2,114★ / 225 forks / last push 2026-08-26 / created 2025-10-23; "under active development").
Not to be confused with **AgentMail** (agentmail.to, real email inboxes for agents), `agenticmail`, or
`email-agent-mcp` (Gmail/O365 connectors); a `steveyegge/` fork indexed under the same tagline now 404s.
**License:** MIT *with an OpenAI/Anthropic rider* — no rights to those parties or anyone acting "for the
benefit of" them, and "use" includes analyzing/indexing. Treat as **ideas-only** as a working
posture, but note the rider's "use" definition arguably reaches the analysis itself and any
field-level derivation (the proposal's `PostAddressingV0` mirrors `to`/`ack_required`/`importance`
closely) — whether that is acceptable is an **owner legal call**, not a settled exemption.

## 1. What it is

An asynchronous **mailbox server** for coding agents, exposed as FastMCP tools (Streamable HTTP primary,
stdio secondary). Persistence is dual: **SQLite + FTS5** for queries, and a **per-project Git repo of
Markdown** (`messages/YYYY/MM/<id>.md`, `agents/<Name>/inbox|outbox/…`, `file_reservations/<sha1>.json`,
`attachments/<xx>/<sha1>.webp`) for human audit. It never runs agents; agents opt in by calling tools.

**Data model** (`src/mcp_agent_mail/models.py`): `Project` (namespace = repo path) · `Product` (group of
projects) · `Agent` (adjective+noun name unique per project, program, model, task_description,
contact_policy, registration_token) · `Message` (sender, `thread_id` string, parent-reply edge, subject,
body_md, importance, ack_required, topic) · `MessageRecipient` (`to|cc|bcc`, read_ts, ack_ts) ·
`FileReservation` (glob, exclusive, TTL, released_ts) · `AgentLink` (cross-project contact approval).

**Addressing:** 1:1 and 1:n via to/cc/bcc; `broadcast=true` expands to the project roster (present in
`send_message`, yet a validator rejects `@all` with "doesn't support broadcasting" — a source-level
reading, not visible in the README's tool signature; and the now-**closed** issue #149 recorded broadcast
degrading as stale agents piled up). A "thread" is a tag, not a shared object: two agents on one
thread can see different subsets.

**Transport:** ~50 tools (`register_agent, send_message, reply_message, fetch_inbox, fetch_topic,
search_messages, summarize_thread, acknowledge_message, file_reservation_paths, release_file_reservations,
acquire/renew/release_build_slot, request_contact, respond_contact, set_contact_policy, macro_*,
sweep_stale_agents, install_precommit_guard, …`) plus read-only `resource://inbox/{agent}` etc.
Discovery = `list_agents`/`whois`. **No push mechanism is documented** — agents `fetch_inbox`; the only
wake-up story the README offers is the *commercial* Companion app ("Message Stacks" fanning scheduled
prompts into tmux panes). "Polling only" is therefore an inference from the README's silence, not a stated
design claim. Identity = per-agent
`registration_token` or MCP-session binding; server auth = static bearer/JWT, localhost open by default.

**Humans:** a server-rendered web UI (project → per-agent inbox → thread), FTS search, a Gmail-style
signed/encrypted static export, and a **Human Overseer** composer: the human posts *as a synthetic agent*
`HumanOverseer` (program `WebUI`, model `Human`) with a hard-coded "pause → do this → resume" preamble.

**Does not do:** authority (contact policy is spam control, not permission), tenancy beyond
project-path + one server token, budgets/caps/spend, loop control, audit-grade attribution (name string +
token; overseer is a fake agent), execution/steering. **Self-reported limits:** polling token burn,
stale-agent rot (`sweep_stale_agents`, `am doctor`), `CONTACT_REQUIRED` drops the body, absolute
attachment paths = filesystem read primitive, advisory-only reservations (`--no-verify` bypasses).

## 2. Mapping onto the ratified ontology

| Question | Answer |
|---|---|
| Relay / blackboard / other? | **Other: durable mailbox (actor-model store).** No floor-holder, no ordinals, no caps (not a relay); no shared transcript, per-recipient views (not a blackboard). Nearest ledger row is Buzz, but narrower. |
| Posts-only (§9 "only settled posts and system markers cross")? | **Satisfied by convention, not guaranteed.** A message is an authored post; reasoning/tools/keys cross only if pasted. No server notion of "settled turn"; attachments are a leak path. Same human asymmetry as ours (overseer sees all). |
| "1 job = 1 channel, 1:1 + 1:n" in our nouns | **= the §7/§9b multi-author Thread + an addressee field on posts.** No new noun; "channel" stays transport (§7). A *private* per-Thread inbox or direct agent→agent send is **A2A loopback / a shared-runtime room** → own promotion gate (§7, §8, §9, §10 non-change clauses). |
| File reservations vs D28 | **Wrong layer for us.** Their leases exist because agents own separate checkouts; ours share one canonical workspace with per-seat authority (D28, `DECISIONS.md:463-466`; D25's older shared-runtime wording is superseded and not cited). Keep only an advisory "intends to edit X" **system marker**; enforcement, if ever, lives in Environment admission, not git hooks. |

## 3. Steal now vs wait

**Now (inside the Thread, no gate):** `to:`/`ack_required`/`importance` as typed post metadata (feeds §9b
chips and the deep-dive's one-shot `@seat`); human post flag *interrupt vs ambient* rendered as a system
marker with pause/resume semantics; thread key = work id (already §9a); advisory edit-intent marker;
signed/redacted Thread export as an evidence/Delivery idea. Negative lesson kept: they *reject* role-shaped
names to avoid cross-CLI collisions — we keep role-shaped names (deep-dive Edge 3) because Seats are ours.

**Wait for the post-P1 relay-vs-blackboard ruling:** per-recipient inboxes as a runtime primitive,
agent→agent sends, subscriber/wake-up models. Level D makes these decidable; choosing now is the
"engineering pick" §7 forbids.

## 4. Risks if copied literally

Unbounded reply loops (no hop counter — worse than Grok Bot's social mitigation; our per-chain caps are the
fix) · zero spend dimension · name-string attribution vs P3 audit-grade `seatId` · legibility collapses to
N inboxes (the fragmented-threads failure in the Grok Bot row) · polling needs an external scheduler (their
answer is paid) · stale identities break broadcast · license rider.

## 5. Source honesty

Primary: README (`/blob/main/README.md`), `src/mcp_agent_mail/{app,models}.py` at main on 2026-08-29,
GitHub API metadata. Not run locally; tool list is from `@mcp.tool` decorators, not a live `tools/list`.
Companion/iOS claims are the README's own marketing, unverified. No user-complaint corpus was surveyed.
