---
title: Thread storage — competitor study (P2 Part A)
subject: docs/plans/multiagent-shell/premises.md §P2 — the six canonical facts, widened to a seventh comparable and a customer-value question
status: research. No storage model is chosen here; the spike (P2 Part B) and the owner gate (P6) decide.
bead: wt-391-forward-shell-ngfs.13.1
---

# Thread storage — competitor study

**Scope.** Seven systems, the same six facts each, plus a widened question about
how each system relates its durable customer-value unit to its conversations.
This report does not choose a Boring storage model — see premises.md §P2
Part B (spike) and §P6 (gate) for that decision.

**The six facts.**
1. Durable unit — conversation, message, or participant session?
2. Participation — property of the record, or a separate join?
3. Per-message authorship — audit-grade or display-grade?
4. Participant removal — rewrite, tombstone, or retain?
5. Cross-surface addressing — deep link, API, search?
6. Archive semantics — flag, move, or different store?

---

## 1. Comparison table

| # | Fact | Slack | Discord | Linear | Intercom | Notion | Buzz | pi v2 (AgentHarness) |
|---|---|---|---|---|---|---|---|---|
| 1 | Durable unit | Channel is the record; message keyed by `ts`, meaningful only inside the channel | Both channel/thread **and** message are independently-IDed Snowflake records — flatter model than Slack | Issue (`id` + human `identifier`); Comment is a child row (`issueId` FK) | Conversation (`conversation_parts` are children); Ticket is a separately-typed sibling object | Page/Block (pages are blocks) is the record; comment `discussion_id` groups child comment rows | A signed Nostr event in one append-only log; Channel is an addressing/organizing layer on top | Session (entry tree + values/lists + usage ledger); Branch/AgentLane is a named path inside it |
| 2 | Participation | Separate join (`conversations.members`, mutated via join/invite/kick) | Hybrid — guild membership inherited + permission overwrites; **Threads** keep an explicit thread-member join, `THREAD_MEMBERS_UPDATE` | Mixed — `assigneeId` is a scalar field on Issue; subscription is a separate relation (undocumented exact shape) | Property on the record — `contacts[]`, `teammates[]`, `assignee` are embedded fields/arrays on the Conversation payload itself, not a separate join table | Separate join — `discussion_id` groups comment rows; no first-class discussion/member object | Membership-based: "agents are members, not people" — added to a channel like a person; no separate ACL/capability list documented | No participation concept exists at all — only named Branches/AgentLanes (agent-side); no human/user membership modeled |
| 3 | Authorship | Audit-grade — `user` is a stable ID; edits tracked via separate `edited:{user,ts}` | Audit-grade — `author` is a full user object keyed by permanent Snowflake; **exception:** webhook messages carry the webhook's own id/name, not a real member identity | Audit-grade — Comment webhook `userId` is a stable ref; only the author can edit their own comment, edit flag preserves original author | Audit-grade at reference level — `conversation_part.author` stores `{type, id}`, not a free-text name | Display-grade — `created_by` is a **Partial User object** (id pointer only), no permissions/audit trail attached | Cryptographic/audit-grade by construction — every human and agent has its own Nostr Schnorr keypair; every action is a signed event; authorization is explicitly separated from authorship | Display-grade at best — no durable seat/author id on the entry; Branch/lane name is a config key, not an audited identity |
| 4 | Removal | Retain — `channel_left`/`member_left_channel` fire; message history untouched | Retain, with a quirk — losing parent-channel access does **not** auto-remove someone from a thread; explicit `THREAD_MEMBERS_UPDATE` needed; author ids on old messages stay valid | Retain — un-assign changes `assigneeId`; unsubscribe removes membership; comment/issue history preserved with original author id | Retain, overwrite-in-place — participation fields (assignee/contacts/teammates) are embedded and get overwritten going forward; historical `conversation_parts.author` unaffected | Retain — `in_trash` is a flag flip, same record, fully restorable; no statement found on a commenter losing workspace access | Key-based revocation, forward-looking — "remove the owner and the agent cannot reconnect"; active sessions can be killed; history is not shown to be rewritten (consistent with append-only log) | No participant to remove; only sanctioned rewrite is the admin-only "precise rewrite" (full store copy+swap for compliance erasure) — not a runtime removal primitive |
| 5 | Addressing | `channel_id` + `ts`(+`thread_ts`); `chat.getPermalink` builds the same coordinates the API/search use | `guild_id`/`channel_id`/`message_id` Snowflake triple; canonical deep link and REST endpoint use the identical triple | UUID `id` (API/GraphQL) + workspace-unique `identifier` (e.g. `ENG-123`) for deep links/search — both resolve to the same record | Conversation `id` is the API/webhook key; Ticket gets its **own** `id`/`ticket_id` namespace, linked via `linked_objects` — two separate id spaces, not one | Unified block-ID space — deep-link fragment, `block_id`/`page_id` in the API, and `discussion_id` for comment threads all share the UUID space | Partially documented — one keypair signs across surfaces (message, approval, commit, merge); no explicit per-event/channel ID-scheme doc found | `sessionId` (UUIDv7) + entry id; search indexes `(sessionId, entryId)`; nothing above the harness layer — left to the host app |
| 6 | Archive | Flag — `conversations.archive` sets `is_archived`; history retained/searchable in place | Flag on the thread object (`thread_metadata.archived`, `auto_archive_duration`); reversible, a new message auto-unarchives unless locked | Flag — `archivedAt` timestamp, same store; separate `trash: true` gives a 30-day-retention bin before permanent deletion; manual per-issue archiving was removed in favor of automatic stale-issue archiving | Flag/state — `open`/`closed`/`snoozed` + `snoozed_until` on the same Conversation record; no move to a separate store | Flag — `in_trash` boolean (formerly `archived`); same page ID; API exposes no permanent delete | Undocumented — no primary-source statement found; plausibly a relay-level tombstone given append-only design, but that is inference | Undocumented — no archive concept anywhere in the spec; only the precise-rewrite exists, and that is erasure/rewrite, not archive |

Where a cell is marked "undocumented," see the per-system notes for what could and could not be verified, and why.

---

## 2. Per-system notes

### Slack

1. **Durable unit — the channel.** The conversation (channel/DM/group) is the durable record with a stable ID (e.g. `C012AB3CD`); messages are keyed by `ts`, unique only *within* a channel, so the channel is the primary namespace. [conversations.info](https://docs.slack.dev/reference/methods/conversations.info/), [conversations.history](https://docs.slack.dev/reference/methods/conversations.history/)
2. **Participation — separate join.** `conversations.info` returns channel metadata only; membership is a dedicated, paginated `conversations.members` call, mutated via `conversations.join`/`invite`/`kick`. [conversations.members](https://api.slack.com/methods/conversations.members), [Conversations API overview](https://api.slack.com/apis/conversations-api)
3. **Authorship — audit-grade.** The message `user` field is a stable user ID surviving username/display-name changes; edits are tracked via a separate `edited: {user, ts}` sub-object. Whether Slack retains pre-edit text internally is undocumented publicly. [message event reference](https://docs.slack.dev/reference/events/message)
4. **Removal — retain.** Leaving/removal fires `channel_left`/`member_left_channel`; message history is not rewritten. Archived-channel docs describe full retention and searchability, implying membership changes don't touch content. [channel_left event](https://api.slack.com/events/channel_left), [member_left_channel event](https://api.slack.com/events/member_left_channel)
5. **Addressing — channel ID + `ts`.** `chat.getPermalink` converts channel ID + `message_ts` into a stable URL, with `thread_ts` for threaded replies; the same coordinate system underlies `conversations.history` and search. [chat.getPermalink](https://docs.slack.dev/reference/methods/chat.getPermalink/), [Deep linking into Slack](https://docs.slack.dev/interactivity/deep-linking/)
6. **Archive — a flag.** `conversations.archive`/`unarchive` set `is_archived` in place; content stays retained and searchable, read-only to new activity. [conversations.archive](https://docs.slack.dev/reference/methods/conversations.archive/)

**Widened question.** Slack has no native case/deal record. The closest analogue is **Canvas** — a durable document object (`conversations.canvases.create`) attached to one channel/message, a distinct persisted resource from the message stream, but documented as one-canvas-per-channel, not a cross-channel work-unit; it carries no delivery/economics state of its own. **Conclusion: no value-unit independent of a conversation ships natively; third-party apps bolt one on keyed by `channel_id`+`thread_ts`.** [conversations.canvases.create](https://docs.slack.dev/reference/methods/conversations.canvases.create/)

### Discord

1. **Durable unit — both channel/thread and message, independently.** Messages carry their own globally-unique Snowflake `id` plus a `channel_id` FK — flatter than Slack's ts-inside-channel model. [Message resource](https://docs.discord.com/developers/resources/message)
2. **Participation — hybrid.** Guild-channel membership is inherited from guild membership plus permission overwrites; **Threads** maintain an explicit thread-member relationship, mutated via join/leave and reported through `THREAD_MEMBERS_UPDATE`. [Threads docs](https://docs.discord.com/developers/topics/threads)
3. **Authorship — audit-grade, with one exception.** `message.author` is a full user object keyed by a permanent Snowflake, immutable across nickname changes. Webhook-posted messages are the documented exception: `author` reflects the webhook's own identity, not a real member. [Message resource](https://docs.discord.com/developers/resources/message)
4. **Removal — retain, with a quirk.** Losing parent-channel access does **not** auto-remove someone from a thread they already joined — Discord's own docs flag this; explicit removal requires `THREAD_MEMBERS_UPDATE`. No tombstoning of message history occurs either way. [Threads docs](https://docs.discord.com/developers/topics/threads)
5. **Addressing — Snowflake triple.** `guild_id/channel_id/message_id` forms both the canonical deep link and the REST endpoint (`GET /channels/{channel.id}/messages/{message.id}`) — identical coordinates for link, API, and jump-to-message search.
6. **Archive — a flag on the thread.** `thread_metadata.archived` plus `auto_archive_duration`; reversible in place, and a new message auto-unarchives unless the thread is locked — never a relocation to cold storage. [Threads docs](https://docs.discord.com/developers/topics/threads)

**Widened question.** No built-in case/deal object. **Forum channels** (channel type 15) are the closest analogue — each forum "post" is itself a thread with tags/pin-state, functioning as a discrete work-unit. But the post **is** the thread: it cannot exist without a conversation (its only content is the message stream), and one work-unit cannot span multiple channels/threads. **Conclusion: the closest thing collapses back into the conversation object itself** — no independent value-unit exists.

### Linear

1. **Durable unit — the Issue.** Stable `id` (UUID) plus human-readable `identifier` (e.g. `ENG-123`); Comment is a child record (`issueId` FK), not the durable unit. [Getting started — GraphQL](https://linear.app/developers/graphql)
2. **Participation — mixed.** `assigneeId` is a direct scalar field on Issue; subscription (who's notified) is described only through UI affordances (`Shift S` to subscribe) — undocumented as an explicit public join-table name, but behaves like a separate relation. [Assign and delegate issues](https://linear.app/docs/assigning-issues)
3. **Authorship — audit-grade.** Comment webhook payloads carry `userId`, a stable reference, not a display name; only the author can edit their own comment, and an `edited` flag preserves the original author. [Webhooks](https://linear.app/developers/webhooks)
4. **Removal — retain with reassignment.** Un-assigning changes `assigneeId`; unsubscribing removes membership from the notification list; Issue/Comment history and original author ids are preserved either way (undocumented in explicit terms, inferred from absence of any documented deletion side-effect).
5. **Addressing — dual id, one record.** UUID `id` for GraphQL/API, workspace-unique `identifier` (`ENG-123`) for deep links and search — both resolve to the same record, including via the Archive-by-identifier API surface.
6. **Archive — a flag, same store.** `archivedAt` timestamp on the record; a separate `trash: true` gives a 30-day-retention bin before permanent removal. Manual per-issue archiving was removed in favor of automatic archiving of stale closed issues. [Delete and archive issues](https://linear.app/docs/delete-archive-issues)

**Widened question — the central case for Linear.** The Issue **is** the durable customer-value unit and does **not** require a conversation: it's created via `issueCreate` with title/description alone, and comments are strictly optional children. One Issue **binds multiple** conversation-like structures: its own Comment thread, `IssueRelation` links (blocks/blocked-by/related/duplicate) to other issues, parent/sub-issue hierarchies (`parentId`, where sub-issues can diverge from the parent's own cycle/project once created), and integration deep-links (e.g. GitHub PRs, AI coding tools) — none of which become "the" conversation. **Delivery/economics are owned by the Issue's own fields** — `state`, `cycle`, `project` — unambiguously the record, not any comment thread. [Issue relations](https://linear.app/docs/issue-relations), [Parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)

### Intercom

1. **Durable unit — Conversation, with Ticket as a separately-typed sibling.** The Conversation (`conversation_parts` as children) is the original durable unit for a customer exchange; Intercom's Ticket object has its own `id`/`ticket_id`. [The conversation model](https://developers.intercom.com/docs/references/2.1/rest-api/conversations/conversation-model), [Ticket](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tickets/ticket)
2. **Participation — property on the record, not an exposed join.** The Conversation payload embeds a `contacts[]` array, a `teammates[]` array, and a single `assignee` object directly — not a separate join table exposed via the API.
3. **Authorship — audit-grade at the reference level.** Each `conversation_part.author` stores `{type: user|admin|bot, id}` — a reference, not free text.
4. **Removal — retain, overwrite-in-place.** Because participation is an embedded field/array rather than an append-only join, removing an assignee/participant overwrites that field going forward; historical `conversation_parts.author` ids are unaffected (undocumented explicitly as "tombstone vs overwrite," inferred from the embedded-field shape and absence of a participant-history delete endpoint).
5. **Addressing — two id spaces, linked.** Conversation `id` is the consistent API/webhook key; Ticket gets its **own** `id`/`ticket_id` — explicitly "the ID used in the Intercom Inbox and Messenger" for deep-linking — with `linked_objects` connecting the two namespaces. [Convert a conversation to a ticket](https://developers.intercom.com/docs/references/2.11/rest-api/api.intercom.io/conversations/convertconversationtoticket)
6. **Archive — flag/state, same store.** `open` boolean plus `state` (`open|closed|snoozed`) and `snoozed_until` on the same Conversation record — no move to a separate archive store.

**Widened question — the closest analogue to Boring's problem, verified.** Intercom's own docs state it directly: *"Most of the time teammates live in Conversations... sometimes you need to work on a complex customer query that doesn't require a conversation"* — and for that, Tickets exist, explicitly **not requiring** a live conversation. [Tickets guide](https://developers.intercom.com/docs/guides/tickets) On a given record, "the `ticket` field will be populated with an object if it is a ticket and will be null if it is a conversation," so the two are typed distinctly even if related in storage shape. Conversion is one-directional: converting a conversation to a ticket creates a **new** Ticket record, and the response's `linked_objects` field can hold linked conversations *and* linked tickets — supporting multiple conversations (email + chat + a bot handoff) binding to one Ticket, though exact multiplicity constraints aren't spelled out publicly. **What owns delivery/economics:** the Ticket's own `ticket_type`/`ticket_state` lifecycle, separate from a Conversation's `open`/`closed`/`snoozed` state — Intercom has visibly split "the chat" from "the trackable work item," moving toward Linear's Issue-first shape while keeping the objects distinct and reference-linked rather than merged into one record.

### Notion

1. **Durable unit — the page/block.** Notion's own docs state "pages are technically blocks," so `block_id` retrieves page content too — one addressing space. [Retrieve a block](https://developers.notion.com/reference/retrieve-a-block)
2. **Participation — separate join.** Comments carry a `discussion_id` grouping key; there is no first-class "discussion" object independent of the comment rows themselves — no member list at all. [Comment object reference](https://developers.notion.com/reference/comment-object)
3. **Authorship — display-grade.** `created_by` is a **Partial User object** (`{object: "user", id}`) — an identity pointer for display, with no permissions/audit trail attached at the comment level. [Working with comments](https://developers.notion.com/docs/working-with-comments)
4. **Removal — flag, not addressed for commenters.** Trashing content is `in_trash: true/false` on the same page record, fully restorable, permanent deletion not exposed via API at all. What happens to a commenter's history if they lose workspace access is undocumented. [Archive/Trash a page](https://developers.notion.com/reference/archive-a-page)
5. **Addressing — unified block-ID space.** Deep links embed the block ID as a URL fragment; the API's `block_id`/`page_id` are the same UUID space; `discussion_id` (obtainable from a page's "Copy link to discussion") is the thread-addressing key.
6. **Archive — a flag, same record.** `in_trash` (formerly `archived`) boolean; page ID stable across the flip; no permanent-delete API exists.

**Widened question.** Notion has no native customer-value unit; a discussion is always attached to a block/page — comments require `parent.page_id` or `parent.block_id`, so **discussion cannot exist without a page** (the opposite of Linear). The closest independent work-record is a **database row**: every row is itself a full page with a stable id and structured properties (Status, Assignee, Due Date) that persist independently of any comment thread, with a comment thread optionally hanging off it via the same mechanism as any other block. Structurally similar to Linear's Issue, but weaker — no dedicated workflow state machine, schema-as-you-define-it instead of a first-class typed work object.

### Buzz (Block, open source, ~July 2026)

1. **Durable unit — a signed Nostr event in one append-only log.** Channels are the organizing/addressing layer on top (often short-lived, e.g. one per feature/bug); history survives channel closure for search; the relay persists events in Postgres with full-text search. [Block: Introducing Buzz](https://block.xyz/inside/introducing-buzz-where-humans-and-agents-work-together), [Block Engineering Blog: Buzz!](https://engineering.block.xyz/blog/buzz)
2. **Participation — membership-based.** *"Agents are members, not bots. Add an agent to a channel the same way you add a person."* A member reads/writes; private channels are invisible to non-members. No separate ACL list or capability taxonomy is documented. [engineering.block.xyz/blog/buzz](https://engineering.block.xyz/blog/buzz)
3. **Authorship — genuinely cryptographic, the strongest in this set.** Every human and agent has its own Nostr **Schnorr keypair**; every action is a signed event. The design explicitly separates authorization from authorship: *"authorization does not erase authorship"* — a credential proves who authorized an action, while the agent remains the signer/author of record. This is audit-grade by construction (unforgeable), stronger than the FK-based audit-grade of Slack/Discord/Linear/Intercom. [engineering.block.xyz/blog/buzz](https://engineering.block.xyz/blog/buzz)
4. **Removal — key-based, forward-looking.** *"If an agent key leaks, revoke the agent without replacing the human identity behind it. Remove the owner and the agent cannot reconnect."* Active sessions can be terminated immediately for high-risk cases. No rewriting of message history is described — revocation blocks future events, consistent with an append-only log. [engineering.block.xyz/blog/buzz](https://engineering.block.xyz/blog/buzz)
5. **Addressing — partially documented.** One keypair-identity signs across surfaces — *"the same identity can send a message, authorize an agent, approve a workflow, sign a commit, or merge a change"* — and a single relay/search index covers conversation, patches, CI runs, and workflow approvals. No explicit per-event/channel ID-scheme documentation was found (undocumented in detail — inferred from architecture description). [engineering.block.xyz/blog/buzz](https://engineering.block.xyz/blog/buzz)
6. **Archive — undocumented.** No primary-source statement on archiving/deleting channels or events; plausibly a relay-level tombstone given the append-only design, but that is inference, not a cited fact.

**Widened question.** Buzz layers work-unit-shaped structures on the log — **feature-branch channels** (*"discussion, patches, CI, review, and the signed merge decision share one record"*) and **workflows** (trigger + approval-gate automations) are described as durable, addressable — but both are *composed of* signed events in the same log, not a separate store with its own id space (unlike Notion's database row). The internal prior finding that Buzz has **no central home for caps or spend** (`transparent-multiagent-chat-deepdive.md:84`, #1399) is not directly quotable from a first-party sentence, but is consistent with the primary sources' total silence on any such registry across two engineering posts — treat as corroborated-by-absence, not newly proven. **Conclusion: the log (and durable views composed from it) is the only durable thing — there is nothing for a value-unit to bind to except the log itself,** the "no record at all" end of the spectrum the brief names it for.

### pi v2 (AgentHarness — Session / Branch / AgentLane)

Source: `packages/agent/docs/harness.md` and `packages/agent/docs/values.md`, local read-only clone `~/projects/pi-framework`, dev branch (same commit lineage as `research/pi-v2-alignment.md`, 2026-08-26/27 analysis). Treated here strictly on the same six facts/widened question as the other six systems — see `pi-v2-alignment.md` for the fuller adoption analysis; this section does not repeat it.

1. **Durable unit — the Session.** A Session groups an immutable entry tree (messages, compactions, branch summaries, custom entries), mutable typed values/lists, and an append-only usage ledger; `Branch`/`AgentLane` are named paths inside one Session, not separate durable records (`harness.md:86-100`, §2.3 `harness.md:910-938`). There is no message-level or participant-session-level unit above the entry — the Session is the addressable whole.
2. **Participation — does not exist as a record.** The spec models zero human/user membership: only agent-facing `Branch`/`AgentLane` names (strings, config keys) exist. `pi-v2-alignment.md` confirms directly: *"No seat identity, no participant-removal semantics, single-writer assumed."* Not "separate join" so much as **absent** — this is the one system in the set with no participation model at all.
3. **Authorship — display-grade, not audit-grade.** `MessageEntry.message` carries an `AgentMessage` with a role, but no durable, audit-grade author/seat id is attached to the entry itself; which Branch/lane wrote it is inferable structurally, not asserted as identity (`harness.md:811-857`). `pi-v2-alignment.md`: *"Pi assigns connection peer identity... what is absent is durable, audit-grade seat identity on the record — that stays ours."*
4. **Participant removal — not applicable; only a compliance-grade rewrite exists.** With no participant record, there's nothing to tombstone. The one sanctioned way entries are ever touched at all is the **precise rewrite** (§2.9, `harness.md:1258-1262`): an administrative, harness-external operation that copies the retained set into a fresh store and swaps it — used for compliance erasure, abandoned-branch pruning, or id re-minting — never a runtime "remove this participant" primitive.
5. **Cross-surface addressing — `sessionId` + `entryId`, and nothing above the harness.** Ids are UUIDv7s, self-describing and time-sortable (§1.2, `harness.md:342-354`); search indexes `(sessionId, entryId)` pairs (`harness.md:1155-1161`). There is no deep-link or API-address concept above the harness layer — explicitly left to the host application (consistent with Boring's own rule: session identity stays workspace-scoped, pi ids stay internal, per `pi-v2-alignment.md`).
6. **Archive semantics — undocumented; does not exist in the spec.** No `archive`/`archived` concept appears anywhere in `harness.md` or `values.md`. The only content-affecting administrative operation is the precise rewrite above, which is erasure/rewrite, not archival.

**Widened question.** pi v2 has **no customer-value unit of any kind** — it is purely a conversation/agent-execution durability substrate (Session/entries/values/ledger). `pi-v2-alignment.md` independently confirms this scope boundary: multi-agent orchestration and Work-shaped concepts are explicitly off pi's own roadmap. pi v2 contributes **zero primitive toward Boring's Work/Job side** of candidate (iii) — it is, at most, a storage substrate variant for the *conversation* half of that candidate, as `pi-v2-alignment.md` already concludes: *"a substrate variant of the first-class-record candidate, not a third ontology."*

---

## 3. What our constraints most resemble

Not a decision — the spike (P2 Part B) and the gate (P6) rule on the storage
model. This section only names which shipped shape each of premises.md's
three candidates most resembles, and what evidence supports or complicates
that resemblance.

- **(i) Index-card / projection.** No system studied here ships this as its
  primary *system-of-record* model — every system with a value-unit or a
  conversation record makes that record first-class, not a projection over
  something else. The nearest real precedent is on the *read side only*:
  Notion's search index and pi v2's own branch index/search projection are
  explicitly "zero authority, rebuildable" (`harness.md:1231`) — real
  precedent for a derived *view*, never for a derived durable *record*. Weak
  shipped precedent in this set for the candidate as a system of record.

- **(ii) First-class thread record.** The dominant shipped pattern — Slack
  (channel), Discord (channel + message, independently), Notion
  (page/block), and pi v2 (Session, as substrate) all make the conversation
  itself the durable, addressable unit that owns its own message stream,
  with participation and authorship hanging off it as a property or join.
  pi v2 is a *substrate* match for this shape (per `pi-v2-alignment.md`),
  not a business-logic match: it ships the mechanism (typed durable
  values, an entry tree) with none of the policy — no participation, no
  audit-grade authorship, no archive — a first-class Thread record would
  still need to add on top.

- **(iii) Work + conversation bindings.** The pattern **Linear** already
  ships natively (Issue as root; comments/sub-issues/`IssueRelation` links
  as optional bindings; `state`/`cycle`/`project` own delivery) and the
  pattern **Intercom is visibly migrating toward** — its own docs frame
  Tickets as existing precisely for cases that *don't require* a live
  conversation, with `linked_objects` binding one or more conversations to
  one Ticket, and a separate `ticket_state` lifecycle owning delivery
  independent of any one conversation's `open`/`closed` state. These are
  the two systems whose customer-value unit can exist without a
  conversation and can bind more than one — exactly candidate (iii)'s
  shape. Nothing studied here disproves it; Linear and Intercom are
  existence proofs it ships and scales. What none of the seven systems
  answer for us: none are agentic, multi-seat, or crash-recoverable the way
  P1's Level D requires, so "Work + bindings works for Linear/Intercom" is
  evidence about the *ontology*, not its cost under our durability
  constraints — that cost is exactly what the spike (Part B) has to
  measure, not this report.

---

## 4. Implications for premises.md §P2 Part B's three candidates

- **(i) Index-card / projection.** No comparable durable system-of-record
  precedent exists in this set; expect the spike to be prototyping a
  genuinely unproven storage shape, not a variant of something shipped
  elsewhere. Boring's starting point (per-agent-session substrate) is real
  and different from any of the seven, which cuts both ways — no prior art
  to lean on, but also no prior-art failure mode to inherit.
- **(ii) First-class thread record.** Best-precedented candidate by sheer
  count (Slack, Discord, Notion, pi v2-as-substrate). The gap every one of
  them shares with our unmet needs: none ships audit-grade,
  crash-recoverable, multi-seat authorship *as part of the conversation
  record itself* for our specific case. Slack/Discord/Notion get
  audit-grade authorship cheaply from a conventional per-message user FK,
  but that assumes a single stable identity system the platform owns
  end-to-end — Buzz is the one system whose authorship is *stronger* than
  that (cryptographic, not FK-based), worth a second look if candidate (ii)
  or (iii) needs an authorship mechanism harder to spoof than a database
  foreign key. pi v2 explicitly does not have audit-grade authorship yet —
  §P3's seatId work stays fully ours regardless of which candidate wins.
  The spike's criterion 2 ("audit-grade attribution without a second
  ledger") has no shipped free lunch among Slack/Discord/Notion/pi v2.
- **(iii) Work + conversation bindings.** Linear and Intercom are the two
  system studies most worth re-reading before the spike starts, because
  they are the only two in the set that already answer spike criteria 6–8
  in production: Linear ships headless work (an Issue with zero comments,
  criterion 6), Intercom ships multi-conversation binding to one Ticket via
  `linked_objects` (criterion 7's WhatsApp→web shape, structurally), and
  both keep their work-record's state machine stable independent of what
  happens to any one attached conversation (criterion 8 — Intercom's
  `ticket_state` is explicitly decoupled from any bound conversation's
  `open`/`closed`/`snoozed` state). None of that removes the amendment-gate
  cost premises.md already names for candidate (iii) — Work as a new
  durable kernel root is still an explicit ratified-plan amendment if the
  spike recommends it — but it does mean the spike is not prototyping an
  unproven ontology; it would be prototyping a proven ontology under
  unproven (for us) durability and multi-seat-authorship constraints.
