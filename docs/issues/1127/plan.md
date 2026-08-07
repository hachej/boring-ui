---
github: https://github.com/hachej/boring-ui/issues/1127
issue: 1127
state: needs-owner-approval
updated: 2026-08-07
flag: BORING_AGENT_CHANNELS (new; adapter host is dead code when off)
---

# gh-1127 — external channels: consume agents from WhatsApp and co

Adversarially reviewed 2026-08-07 (3 blockers, 6 majors found and folded in).

## Problem

Agents are only reachable through the workspace UI over a held ndjson stream.
Owner direction: a client's team should talk to a deployed agent from WhatsApp
(email/SMS class later) with zero workspace onboarding. External channels are
disconnected and asynchronous — no socket between messages, replies minutes
later, process restarts in between — so they need durable, unbounded-horizon
session state, not the UI's retention-window replay.

## Today / Delta

**Today (origin/main, post PR #1128 + hydration follow-up):**
- `SqliteEventStreamStore` (`packages/agent/src/server/events/eventStreamStore.ts`):
  durable idempotent append, opaque offsets, `readEvents(path, {offset,
  limit})` → `{events, nextOffset, upToDate}`, in-process `subscribe`.
- Every pi-chat event is durably appended before live fan-out
  (`harnessPiChatService.publishChannelEvents`); a failed append poisons the
  channel — the store is authoritative.
- Cold channel open rehydrates the in-memory `PiChatReplayBuffer` from the
  store (`hydrateDurableReplayBuffer`, harnessPiChatService.ts:996) — but only
  up to the buffer's retention window (~1000 events). UI reconnects survive
  restarts; a consumer absent for longer than the window still gaps.
- Streams are keyed by **composite session key** — `sessionStreamPath(
  sessionKey)` where sessionKey encodes sessionId + workspace/storage scope
  (harnessPiChatService.ts:922) — not by bare sessionId.
- HTTP surface (`agent-host/httpProjection.ts`): create session,
  `POST .../prompt|followup`, `GET .../events` (ndjson, numeric cursor into
  the in-memory buffer). Prompt `requestId` dedupe is gateway/metering-layer
  and in-memory — not durable. Auth = host-injected `authorizeAgentRequest →
  AuthorizedAgentScope`. `trustedPiSessionBinding.ts` validates a requested
  scope against an already-authorized ctx; nothing mints scopes from storage.
- No webhooks (billing aside), no outbound messaging, no external identity
  mapping anywhere.

**Delta:** a channel adapter host that (a) accepts provider webhooks with fast
ack + durable inbound dedupe, (b) maps external identity → scope + session,
(c) drives the agent via a new trusted-caller seam, (d) tails the durable
store with a persisted, leased cursor, assembles completed turns, and delivers
rendered replies out-channel — including when the store's retention window has
long passed.

## Solution

### 1. Channel adapter contract (channel-agnostic core)

New module `packages/agent/src/server/channels/` (placement = open question 1);
host wiring in the deployed app. Pipeline, not two halves:

**Inbound** — webhook handler does signature verification + payload parse
(`ChannelAdapter.parseInbound(request) → InboundChannelMessage { channelId,
externalId, providerMessageId, text, attachments? }`) then **acks 200
immediately** after durably enqueueing the message keyed by
`(channel, providerMessageId)` in the `ChannelBindingStore`. Providers retry
aggressively on slow responses (Meta retries for hours); prompt-path dedupe is
in-memory/metering-dependent, so **inbound dedupe is durable and ours** — a
replayed `providerMessageId` is dropped at the store, never reaching the
agent. A per-binding serialized worker drains the queue in enqueue order
(providers do not guarantee webhook ordering; we impose per-sender ordering).

**Agent invocation** — the drain worker resolves the binding, ensures the
session, and calls `prompt`; if the session is busy it uses `followUp` (never
`requireIdle`-and-drop — a channel message must not be silently discarded).

**Outbound** — a per-binding delivery worker tails
`eventStore.readEvents(streamPath, { offset: binding.cursor })`.
`streamPath` is resolved via a **new exported resolver on the pi-chat service**
(streams are keyed by composite sessionKey — a bare-sessionId tail reads an
empty stream forever). The worker:
- assembles turns at the **chunk level** against an explicit terminal-event
  contract: `agent-end` → render reply; synthetic `error` / aborted turn →
  render a short failure notice (silence is not acceptable on a chat channel);
  stall timeout (no terminal event within N minutes, e.g. poisoned channel) →
  failure notice + park;
- renders via `ChannelAdapter.renderOutbound(turn) → ProviderMessage[]`;
- sends, then advances `binding.cursor` (a store offset) with **compare-and-
  set** — at-least-once outbound, and two accidental workers cannot double-
  send past each other. v1 explicitly assumes a **single co-located adapter
  process** (store `subscribe` is in-process; pattern: subscribe first, then
  `readEvents` loop until `upToDate` to close the wake/read race).
- **Send-failure policy**: bounded retry; permanent failure (expired 24h
  window, unrenderable content) → park that message with a stable code and
  advance — one bad message must not wedge the binding forever.

**Why the durable store, not the ndjson `/events` route:** the numeric cursor
replays from the retention-window-bounded in-memory buffer; a channel silent
for days needs resumption from an arbitrary offset. The store gives exactly
that; the adapter is its first non-UI consumer.

### 2. Identity mapping and session binding

`ChannelBindingStore` (sqlite, same `SqlStorage` seam as the event store):

```
binding: (channel, externalId) → { workspaceScopeId, authSubjectId,
          agentTypeId, sessionId, cursor, status, askUserPending? }
inbound_dedupe: (channel, providerMessageId) → seenAt
```

- One durable session per (channel, externalId, agentTypeId); created lazily
  on first inbound, reused thereafter.
- **Gone-session policy**: if the bound session was deleted/retired, the
  worker auto-creates a fresh session, resets `cursor` to the new stream's
  tail, and notes the reset in the outbound greeting. Long-conversation
  rotation policy = open question 5.
- Fail-closed: unknown sender → polite rejection template, no session, no
  agent invocation, stable error code. Bindings provisioned explicitly
  (CLI/admin op in v1; #1087 per-agent grants is the eventual policy seam).
- **Trust model — named honestly as a new seam**: the adapter is a host-side
  trusted caller that mints `AuthorizedAgentScope` from a binding row. This
  has no precedent (`trustedPiSessionBinding` only *validates* against an
  already-authorized ctx). Guardrails: mint only after verifying the
  workspace scope still resolves and `binding.status === active`; bindings
  are revocable; the seam lives behind the flag and is unreachable when off.

### 3. Message shaping

- Assistant markdown → channel dialect (WhatsApp: `*bold*`, `_italic_`; no
  headings/tables — degrade to plain text), split at provider limits
  (WhatsApp 4096 chars) on paragraph boundaries.
- Channels receive completed turns only — tool calls, thinking, and streaming
  deltas are suppressed by the turn assembler.
- `ask_user` (v1): question rendered as plain text; `askUserPending` is set on
  the binding and **consumed by exactly one next inbound** from that sender
  (routed as the answer), closing the two-messages-race. Rich intentions
  degrade to numbered choices; unrenderable ones defer with an "open the
  workspace" message. Full Inbox interplay is a follow-up epic.
- **24h window**: replies delivered after the customer's window lapses are
  rejected by Meta for free-form sends. In scope: a single pre-approved
  "your agent has an update — reply to continue" template as fallback.
  Proactive agent-initiated outreach stays out of scope.

### 4. Auth / tenancy boundaries

- Webhook endpoint in the deployed host app: per-channel secret + provider
  signature check (WhatsApp Cloud API `X-Hub-Signature-256` HMAC + verify
  handshake) before any parsing.
- Provider credentials via the existing credentials seam
  (`server/credentials/`), never in git.
- Tenancy: the binding carries the workspace scope; one endpoint serves many
  tenants since routing is (channel, externalId) → binding. Genericity: no
  provider names in core contracts — `channelId` is opaque.

## Decisions (proposed, not yet ratified)

1. Adapter consumes the durable store directly with its own persisted cursor —
   not the HTTP events route, not the in-memory buffer.
2. Contract-first with a **fake channel** conformance harness; WhatsApp the
   only concrete channel in this epic. The fake channel makes the loop
   CI-provable without Meta credentials; WhatsApp (not email) because it is
   the owner's named demo and boring-mail already covers the email surface.
3. WhatsApp via **Meta Cloud API direct** (no Twilio) — one fewer vendor,
   native template access for the 24h fallback. Cheap to flip later behind
   the adapter contract.
4. Inbound dedupe + ordering are owned durably by the channel core (not the
   prompt path); webhook ack is asynchronous.
5. v1 runs a single co-located adapter process; horizontal delivery workers
   are a later epic (cursor CAS already keeps correctness if violated).

## Test Seams

- Highest public seam: fake-channel conformance suite — inject inbound
  webhook payload → durable enqueue + ack → real `HarnessPiChatService` with
  sqlite store completes a turn → rendered outbound + cursor CAS persisted →
  restart adapter → next inbound resumes, zero dupes, zero loss.
- Prior art: `eventStreamStore.conformance.test.ts`,
  `harnessPiChatService.eventStore.test.ts`, billing webhook signature tests
  (`packages/core/src/server/credits/`).
- Avoid testing: Meta API behavior (mock at the adapter transport edge), pi
  runtime internals, replay-buffer internals.

## Acceptance

1. Fake-channel loop green in CI, surviving adapter restart mid-conversation
   (cursor resume, zero duplicate sends).
2. Replayed webhook with the same `providerMessageId` — including after a
   process restart — produces exactly one agent turn (durable dedupe).
3. Unknown sender rejected fail-closed with a stable code; no session.
4. Error/aborted/stalled turns produce a failure notice out-channel, never
   silence; a permanently unsendable message parks without wedging the
   binding.
5. `ask_user` round-trips as text; the pending flag is consumed by exactly
   one inbound.
6. Gone-session auto-recreate works; greeting notes the reset.
7. WhatsApp adapter: signature verify, handshake, dialect rendering + 4096
   chunking, template fallback — unit-tested on recorded fixtures; live
   demo against a Meta test number.
8. Flag off → no routes, no workers, byte-identical host.

## Proof

- Exact command: channels suites in `packages/agent`; full
  `pnpm -C packages/agent test` green.
- Manual/demo: WhatsApp test number ↔ deployed factory agent; recording of a
  multi-message conversation spanning a server restart.
- Owner demo: "message the Engagement Analyst on WhatsApp" (GTM framing).

## Slices

### Slice 1a: contract + bindings + inbound path
**Bead:** on approval
**Delivers:** `ChannelAdapter` contract, `ChannelBindingStore` (bindings,
durable dedupe, inbound queue), async-ack webhook core, trusted-caller seam
with guardrails, provisioning op, flag plumbing, fake-channel inbound tests.
**Blocked by:** None (substrate on main).
**Proof:** acceptance 2, 3, 8.
**Review budget:** inside

### Slice 1b: durable tail + turn assembly + outbound
**Bead:** on approval
**Delivers:** stream-path resolver export, tail worker (subscribe+read loop,
cursor CAS), terminal-event turn assembler, shaping core, send-failure/park
policy, gone-session recovery, full conformance suite.
**Blocked by:** 1a.
**Proof:** acceptance 1, 4, 5, 6.
**Review budget:** inside — turn assembly is the risk center, kept alone here

### Slice 2: WhatsApp adapter (Meta Cloud API)
**Bead:** on approval
**Delivers:** signature verify + handshake, payload parse, dialect rendering +
chunking, send with retry, 24h template fallback, host wiring + credentials.
**Blocked by:** 1b; Meta business account + test number (owner-side).
**Proof:** acceptance 7; manual demo recording.
**Review budget:** inside

### Slice 3 (stretch, separate gate): ask_user rich degradation + boring-mail
reuse assessment for the email channel — written up, not built, in this epic.

## Out of Scope

Email/SMS channels (assessment only), group chats, inbound media→agent
attachments (v1: acknowledge + defer), per-agent grant policy (#1087),
workspace Inbox interplay beyond text `ask_user`, proactive agent-initiated
outreach beyond the single reply-fallback template, multi-agent routing per
sender, horizontal adapter scale-out, billing/metering of channel traffic.

## Open Questions — owner decisions required

1. **Placement**: `packages/agent/src/server/channels/` (proposed — it drives
   the service and event store) vs a new `packages/channels`. Cheap to ratify.
2. **boring-mail**: future adapter behind this contract, or sibling product?
   Shapes how opinionated the outbound rendering contract gets in 1a.
3. **Unknown-sender UX**: silent drop vs polite rejection (assumed) vs
   onboarding link.
4. **Meta account**: direct Cloud API needs Meta Business verification
   (days, owner-side). Confirm, or direct to Twilio for demo timeline.
5. **Session rotation**: one session per contact forever grows context and
   cost unboundedly — rotate by age/turn-count, or accept for v1?
