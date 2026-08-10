---
github: https://github.com/hachej/boring-ui/issues/1127
issue: 1127
state: needs-owner-approval
updated: 2026-08-10
supersedes: docs/issues/1127/plan.md (r2.1) — for the WhatsApp lane only
flag: BORING_AGENT_CHANNELS (from r2.1; adapter host is dead code when off)
---

# gh-1127 — WhatsApp channel execution plan (r3)

Revives the epic under the owner rulings of **2026-08-10**, which reverse the
2026-08-08 deprioritization recorded in `docs/direction/STATE.md:33`
("Plan ratified (#1140); zero implementation; **deprioritized**").

**This plan is the CHANNEL MECHANISM only.** A parallel Opus lane is planning
the CH-trades PRODUCT side (quotes, verticals, the actual agent behaviour).
Where this document says "the agent replies", that lane owns what it replies.
Do not duplicate; reference.

## Owner rulings folded in (2026-08-10)

| Ruling | Effect on r2.1 |
| --- | --- |
| **Meta Cloud API DIRECT** | Confirms r2.1 decision 3 verbatim. Kills the Twilio fallback of open question 4 — App Review turnaround is now ~24h, so the fallback has no reason to exist. |
| **ONE Seneca number, multi-tenant** | Compatible with r2.1 §4 ("one endpoint serves many tenants since routing is `(channel, externalId) → binding`"). Adds a hard identity constraint — see §7 risks. |
| **v1 = inbound text → agent session** | r2.1 slices 1a + 1b, unchanged. |
| **v1 = outbound drafts with OWNER APPROVAL IN WHATSAPP before send** | **Reverses r2.1's demotion of `ask_user` to slice 3.** The ask-user machinery becomes v1-critical. New slice 3. |
| **v1 = artifact drop into chat (expiring links + PDF)** | **New scope.** r2.1 had nothing here. New slice 4. |
| **v1 = inbound media (photos, voice notes → transcribed)** | **Reverses r2.1's "Out of Scope: inbound media→agent attachments".** New slice 5. |

Everything in r2.1 §1–§4 that these rulings do not touch is **revived verbatim**
and is not restated here. Read `plan.md` first; this document is the delta plus
the four new lanes.

---

## Step 0 — Meta App Review submission (FIRST ACTION OF THE LANE)

This is step 0 because Slice 6 (the provider edge) cannot be demoed without it
and the owner cites ~24h turnaround. It is owner-side, not engineering-side, and
it runs in parallel with slices 1–5.

### 0.1 Prerequisites to have in hand before opening the form

- **Meta Business Account**, with Business Verification started (legal entity
  name, registered address, and a verifiable phone/website that match public
  records). This is the long pole if it has not been done — App Review is ~24h,
  *business verification is not*.
- **Meta App** of type "Business", with the **WhatsApp** product added.
- **A phone number** for the Seneca number that is not already registered to a
  WhatsApp or WhatsApp Business consumer account. If it is, deregister first —
  this is the single most common multi-day blocker.
- **Display name** for the WhatsApp Business Profile that complies with Meta's
  display-name policy (must relate to the business; no generic words).
- **Privacy policy URL** — publicly reachable, describing message-content
  handling, retention, and the transcription sub-processor (§6.3). Meta rejects
  placeholder/404 privacy URLs.
- **Verified webhook endpoint**: public HTTPS with a valid certificate,
  answering the `hub.challenge` handshake. Meta validates this during setup, so
  slice 6's webhook must be reachable (a stub that only answers the handshake is
  sufficient at this stage and can ship before the rest).

### 0.2 Permissions to request

| Permission | Why | Notes |
| --- | --- | --- |
| `whatsapp_business_messaging` | send + receive messages | the core grant |
| `whatsapp_business_management` | manage phone numbers, message templates | needed for the 24h-window template (§7.1) |

Do **not** request `business_management` unless a reviewer asks — extra
permissions lengthen review.

### 0.3 What to submit for each permission

Meta reviews a **screencast plus a written use-case**. Submit:

1. **Written use case** (per permission), stating plainly: a Seneca-operated
   business number; end users initiate contact; the agent answers questions and
   returns quotes; no marketing, no bulk/unsolicited messaging, no list-buying.
2. **Screencast** showing the end-to-end flow from a real device: user sends a
   message → agent replies → user receives an artifact link. Record it against
   the test number in Development mode (available before approval).
3. **Test credentials / instructions** so a reviewer can reproduce: the test
   number, a sample opening message, and expected reply.
4. **Opt-in evidence**: describe how users consent to be messaged. Since v1 is
   strictly user-initiated within the 24h window, state that explicitly — it is
   the easiest review posture to defend.

### 0.4 Message template to submit at the same time

Submit the single 24h-window fallback template from r2.1 §3 for approval in the
same pass (template approval is separate from App Review and also ~24h):

- Category: **UTILITY** (not MARKETING — marketing templates draw scrutiny and
  cost more).
- Body: a re-engagement notice with no promotional content, e.g. "Your Seneca
  assistant has an update on your request. Reply to continue."

### 0.5 Step 0 exit criteria

- App Review approved for both permissions.
- Business verification cleared.
- One phone number registered, display name approved.
- One UTILITY template approved.
- Webhook handshake verified by Meta against our public endpoint.

**Gate:** slices 1–5 do not block on this. Only slice 6's live demo does.

---

## 1. Prior art and what we revive

### 1.1 `docs/issues/1127/plan.md` (r2.1) — the ratified shape, revived

Merged to main in `68e4a6cba` (PR #1140), adversarially reviewed twice. It is
correct and this plan does not re-litigate it. Revived verbatim:

- **§1 pipeline**: webhook → signature verify → parse → **durable enqueue keyed
  by `(channel, providerMessageId)` in one sqlite transaction** → immediate 200
  ack → per-binding serialized drain worker → `prompt`/`followUp`.
- **§1 outbound**: per-binding worker tails `eventStore.readEvents(streamPath,
  { offset: binding.cursor })`, assembles turns against the terminal-event
  contract, renders, sends, then advances the cursor by compare-and-set.
- **The honesty about semantics**: outbound is **at-least-once**. "send precedes
  the CAS… CAS prevents cursor divergence, **not** duplicate sends (WhatsApp
  offers no send idempotency key)."
- **§2 binding store schema and gone-session policy**, including "the cursor
  resets whenever **any** sessionKey component changes".
- **§2 trust model**: the adapter is a host-side trusted caller minting
  `AuthorizedAgentScope` from a binding row, with the stated guardrails. Still
  the one genuinely new seam.
- **§3 shaping**: WhatsApp dialect (`*bold*`, `_italic_`), 4096-char chunking on
  paragraph boundaries, fence close/reopen on hard splits, completed turns only.
- **§4 auth**: `X-Hub-Signature-256` HMAC + handshake before any parsing;
  credentials via `server/credentials/`; `channelId` opaque in core contracts.
- **Decisions 1, 2, 4, 5** (durable store not the HTTP route; fake-channel
  conformance harness; durable inbound dedupe; same process as
  `HarnessPiChatService`).

### 1.2 The #391 lineage — three things r2.1 missed

`docs/issues/391/runtime-refactor/` contains an older, in places **more
rigorous** channel design. Three findings must be folded in:

**(a) `Agent.followUp` may strand — r2.1 assumes it works.**
r2.1 §1 says "if the session is busy it uses `followUp`". CHAN-A
(`.../work/S1-slack-channel/CHAN-A-chat-sdk-transport.md`, v6 FINAL) analysed
this path and found it broken: "a turn drains queued follow-ups only at pi's
per-run final poll or an idle `continue()` … → poll-then-clear stranding". Its
BCH-001 adds `Agent.followUp(input)` plus a service-level **`DrainCoordinator`**
in `HarnessPiChatService` with `phase ∈ {idle, running, draining, interrupting}`
under a per-session mutex. **A channel is exactly the workload that hits this**
(a user sends three WhatsApp messages in a row mid-turn). Folded into slice 1a
as a hard prerequisite, with a failing test first.

**(b) The create-race is under-specified in r2.1.**
r2.1 says sessions are "created lazily on first inbound". CHAN-A's BCH-003
specifies an **owner-token CAS state machine** — `creating → admitting → ready`,
`casState(key, expectedOwner, next, ttlMs)` as `UPDATE … WHERE key=? AND
owner=?` (rowcount===1), `RESERVATION_TTL=30_000ms`, loser backoff 50→500ms,
`MAX_RESERVATION_CYCLES=2` then a stable `SESSION_CREATE_TIMEOUT`. Its recovery
cases are the ones that matter: an **expired `admitting`** record means the
winner crashed *after* allocating, so the session exists and must **not** be
re-allocated or re-admitted. Lifted verbatim into `ChannelBindingStore`.

**(c) The two-handles rule.**
`.../architecture/08-pluggable-agent-surfaces.md`: "`sessionId` — runtime-owned
… Continuation/addressing — surface-owned … Public agent APIs never accept
platform addressing" and "A surface must never synthesize a fake `workspaceId`."
Our binding table *is* the surface-owned addressing map. Enforced by a guard
test (no phone number reaches an agent API).

### 1.3 What is NOT prior art

- **No code was ever written.** `git log --all --diff-filter=A --name-only --
  "packages/channels/*"` is empty. Branches `bclaw/boring-channels` and
  `bclaw/slack-flue-channels` are stale pointers with empty diffs against main.
  The only artifact that ever existed is a gitignored `.d.ts` prototype.
- **CHAN-A and CH1 are non-dispatchable** — they carry "historical snapshot;
  non-dispatchable" banners. We mine them for design, not for sequencing.
- **CH1 ordered Telegram first, WhatsApp second, gated on a cost spike.**
  Superseded by the owner ruling.

---

## 2. Flue — what we take and what we do not

**Flue is `github.com/withastro/flue`** (Apache-2.0), an agent runtime by the
Astro team built on `pi-agent-core` — the same pi lineage as our
`pi-coding-agent`. It is a competitor to our *composition layer*
(`agent-host/`), not to our harness.

### 2.1 What we DO NOT take: the runtime. Ratified, unchanged.

`.../architecture/08-pluggable-agent-surfaces.md:296`, verified against source,
not merely judged:

> "Not adopted — now verified, not just judged: mounting boring-agent *inside*
> Flue's runtime. Flue's LLM loop is a hardwired `new Agent(...)` from
> `pi-agent-core` inside its 125 KB `session.ts` — rich seams *around* the loop
> (tools, `SessionEnv`, model providers, execution interceptors) but **no seam
> at the loop**; hosting our pi-coding-agent harness means forking their core.
> Additionally: single flat `SessionEnv` per harness … and session persistence
> is an event-sourced SQL record log … incompatible with pi-coding-agent JSONL
> sessions. **Strategy: cherry-pick, don't adopt**."

The memory eval reaches the same verdict independently: *"copy the Durable
Object pattern, defer celld, do not integrate Flue"* — because Flue "has no
tenancy/authorization story; adopting it = the 'second behavior composer' that
D25/D26/D28/D29 rejected four times."

**Restated for this lane: we do not host our agent inside Flue, we do not adopt
`@flue/runtime`, and we do not adopt Flue's session persistence.**

### 2.2 What we ALREADY took: the durable event store

Our `SqliteEventStreamStore` **is a port of Flue's code**.
`.../work/T1-durable-events/TODO.md:10`: "Reference impl to adapt (Apache-2.0
…): Flue `packages/runtime/src/runtime/event-stream-store.ts` (388 LOC) +
`handle-stream-routes.ts` (594 LOC)." We renamed `flue_*` → `boring_event_*`
and fixed a real bug in the original: "Flue's `appendEvent` runs two
non-transactional statements… Wrap both in one transaction. Delete Flue's 'safe
for single-process' comment."

That store is the substrate this whole lane stands on, and §5 proves it works.

### 2.3 What we MAY take: `@flue/whatsapp` ingress — and the gap r2.1 left

`08-pluggable-agent-surfaces.md:294`, verified at Flue `ffbe359`:

> "the 13 per-channel ingress packages (`@flue/slack`, `teams`, `discord`,
> `telegram`, `github`, `linear`, `intercom`, **`whatsapp`**, `messenger`,
> `twilio`, `google-chat`, `zendesk`, `notion`) import **nothing from
> `@flue/runtime`** — dependencies are `hono` + provider type packages only.
> Apache-2.0. Each package provides: signature verification, provider-native
> payload parsing, Hono route handlers, and a self-contained
> `conversationKey`/`parseConversationKey` codec."

This is **ratified as `docs/DECISIONS.md:302` decision 6**: "Use pinned
`@flue/*` ingress packages with thin adapters; vendoring is only the fallback
and hosting inside Flue's runtime is not adopted."

**The gap:** r2.1 chose Vercel's `@chat-adapter/whatsapp` for the provider edge
(via `cloudflare-channels-assessment.md`) and **never evaluated `@flue/whatsapp`
at all** — despite `@flue/*` being the *ratified* choice and `@flue/whatsapp`
being in the verified list. Slice 6 therefore opens with a **bounded one-day
bake-off** between the two, not a foregone conclusion (§6.6).

The r2.1 caveat applies to both candidates and is the acceptance bar for either:

> "we want the adapter package standalone behind our contract, **not** their
> Redis-state bot framework (their state/dedupe model would duplicate and fight
> our binding store and cursor semantics)."

### 2.4 Cloudflare — assessed and rejected, unchanged

`cloudflare-channels-assessment.md` stands: Cloudflare's own channel catalog has
**no WhatsApp and no SMS**; "on Cloudflare you would build the Meta Cloud API
webhook/send path yourself, exactly as on any VPS"; and "Cloudflare Inc is US
(CLOUD Act exposure regardless of data location) … Incompatible with Seneca's
'no US data path' positioning for message content."

---

## 3. Placement decision

### 3.1 The contradiction that must be resolved

Two ratified-ish positions conflict, and neither cites the other:

- **`docs/DECISIONS.md:302` decision 3** (ratified): "Channel/surface packages
  follow the **Flue-style package model** rather than `boring-agent` subpaths"
  — i.e. `packages/channels/<name>`.
- **`plan.md` r2.1 open question 1** (review-endorsed, owner-ungated):
  "`packages/agent/src/server/channels/`".

### 3.2 Recommendation: split by trust boundary, honouring both

**Channel CORE → `packages/agent/src/server/channels/` (r2.1 position).**
**Provider EDGE → `packages/channels/whatsapp` (decision 3 position).**

The split is not a compromise; it follows from evidence:

*Why the core must be inside `packages/agent`, in-process:*
1. It calls `HarnessPiChatService` directly and uses the event store's
   `subscribe` seam, which is an **in-process listener** (r2.1 decision 5:
   "A separate adapter process is not 'add workers later': it is a redesign").
2. It mints `AuthorizedAgentScope` — a **branded type** whose only legitimate
   minting authority is the host (`agent-host/types.ts:307`). A separate package
   minting scopes would either export the brand (unacceptable) or go through
   HTTP with its own tokens (the redesign above).
3. It needs `sessionKey(ctx, id)` to compute the stream path. That method is
   **private** today (`harnessPiChatService.ts:944`), and r2.1 already requires
   "a **new exported resolver on the pi-chat service**". Exporting a resolver to
   an in-package consumer is a small seam; exporting it cross-package widens the
   public API surface for one caller.

*Why the provider edge must be its own package:*
1. Decision 3 is ratified and the reasoning holds — provider SDKs, Hono route
   shims, and Meta-specific fixtures do not belong in the agent's dependency
   graph.
2. `cloudflare-channels-assessment.md` §4 already draws exactly this line:
   "slices 1a and 1b are invariant. **Only Slice 2's provider-transport edge is
   substitutable.**" Substitutable things go behind a package boundary.
3. The `@flue/whatsapp` vs `@chat-adapter/whatsapp` bake-off (§2.3) is only
   cheap if the loser can be swapped without touching the core.

*Dependency rule* (from `08:312`): the provider-edge package depends on
`@hachej/boring-agent`'s **channel contract types only** — never on
`agent-host` internals, never on `HarnessPiChatService`. The core never imports
the provider package; the deployed host wires them together.

**This reconciliation is an owner gate.** It is the only structural decision in
this plan that overrides an existing ratified decision, and it does so by
narrowing it (decision 3 continues to govern channel *packages*; it never
contemplated a channel *core* that mints scopes).

### 3.3 No `packages/channels/shared` in this lane

`08:299`: extract a shared package "**only when a second `@flue/*` channel
actually lands** (that second channel is the state trigger)". WhatsApp is the
first. The Hono→Fastify shim lives inside `packages/channels/whatsapp`.

---

## 4. Session routing: which host?

### 4.1 Recommendation: the standalone single-agent host

`createStandaloneAgentHostApp` (`packages/agent/src/server/createStandaloneAgentHostApp.ts`)
is the ingress target for the WhatsApp deployment. Reasons, all evidenced in §5:

1. **It is the natural runtime for a headless bot.** No workspace UI, no
   browser, no `x-boring-workspace-id` header, no cookie auth. It hardcodes
   `workspaceId: 'default'` and mints its own scope via
   `createStandaloneScopeAuthority` — which is *precisely* the trusted-caller
   shape r2.1 §2 says the channel needs, already existing rather than invented.
2. **The whole loop is proven working today** (§5): session create → prompt →
   ordered event stream → `agent-end status: ok`, with durable persistence and
   restart survival.
3. **Its prompt route already has the dedupe primitive.** `requestId` is
   *required* and returns `duplicate: true` on replay (§5.4) — a second,
   independent line of defence behind the channel's own durable dedupe.
4. It is a single process, satisfying r2.1 decision 5 for free.

### 4.2 Not the workspace hub, for v1

The workspace hub adds multi-workspace routing, browser auth, plugin gateways
and the `x-boring-workspace-id` header — none of which a webhook has or wants.
It is also where the known **connection-starvation** problem lives (Chrome's
6-connections-per-origin limit vs held ndjson streams). A channel holding N
per-binding tails would make that worse.

**Consequence for tenancy:** one standalone host = one workspace scope. With ONE
Seneca number serving multiple tenants, tenant separation in v1 is **per-session
within one workspace scope**, not per-workspace. This is a real limitation, it
is what the owner's "one number, multi-tenant, for the pilot" ruling buys, and
it is stated as a risk in §7.3 rather than hidden.

### 4.3 Flag interaction — unspecified in r2.1, specified here

`BORING_CHAT_DURABLE_STREAM` is **off by default**
(`buildAgentComposition.ts`), and the entire outbound path depends on it.
`BORING_AGENT_CHANNELS=1` with the durable stream off is a silently broken
deployment. **Boot-time assertion:** if channels are enabled and the durable
store is unavailable, fail boot loudly with a stable code, matching the
precedent already set by `f1e245be1` ("fail loudly when durable-stream flag is
on but store unavailable").

---

## 5. Substrate verification — the standalone host works

Run on this VM, 2026-08-10, against **gemini-2.5-flash** through the repo's
existing custom-provider seam. Not a mock: real HTTP, real model, real sqlite.

**Boot.** `createStandaloneAgentHostApp` requires a host-injected runtime
adapter (invariant 5 — workspace+sandbox swap as one pair); wired as
`dev.ts`/`bin/boring-agent.ts` do, with `createAgentSandboxRuntimeModeAdapter('direct')`
and `agentSandboxRuntimeHostOperations`.

Model wiring used the **existing** `BORING_AGENT_CUSTOM_MODEL_*` provider seam
against Gemini's OpenAI-compatible endpoint — no code change:

```
GET /api/v1/agents/default/models
{"models":[{"provider":"gemini","id":"gemini-2.5-flash","label":"gemini-2.5-flash",
 "available":true}],"defaultModel":{"provider":"gemini","id":"gemini-2.5-flash"}}
```

**5.1 One real turn, end to end.**

```
POST /api/v1/agents/default/sessions        → 201 {"sessionId":"672ebadd-…"}
POST /api/v1/agents/default/sessions/:id/prompt
     {"requestId":"req-turn-1","clientNonce":"nonce-1","content":"Reply with exactly…"}
                                            → 202 {"accepted":true,"cursor":1}
```

The ndjson event stream produced exactly the terminal-event contract r2.1's turn
assembler is specified against:

```
seq 1  agent-start    turnId turn:672ebadd-…:1
seq 2  message-start  role user
seq 3  message-end
seq 4  message-start  role assistant
seq 5  message-delta
seq 6  message-delta
seq 7  message-part-end
seq 8  message-end
seq 9  agent-end      status: ok
```

with the model's literal output `WHATSAPP_LANE_OK` in the deltas. **`agent-end`
with an explicit `status` exists and is the assembler's trigger.**

**5.2 Cursor replay.** A fresh connection at `cursor=0` replayed all 9 frames;
`cursor=6` returned 3. Monotonic `seq`, resumable mid-stream.

**5.3 Durable persistence.** With `BORING_CHAT_DURABLE_STREAM=1`, the store
opened at `<workspaceRoot>/.agent-event-stream.sqlite` and after one turn held:

```
boring_event_streams          1
boring_event_stream_entries   9    ← matches the 9 stream frames exactly
boring_event_stream_keys      9    ← one idempotency key per event
```

**5.4 Prompt idempotency.** Replaying the same `requestId` returned
`{"accepted":true,"cursor":1,"disposition":"prompt","duplicate":true}` — no
second turn. Note `requestId` is **required** by `PromptBodySchema` (a request
without it is a 400 `AGENT_COMMAND_INVALID_STATE`).

**5.5 Restart survival — the decisive test.** Killed the process, restarted it
against the same store:

- replay from `cursor=0` returned **all 9 frames**, including `DURABLE_OK`;
- a new prompt on the same session was accepted at **`cursor: 10`** — the stream
  continued rather than restarting;
- and the model answered the follow-up "what token did you just say?" with
  `DURABLE_OK`, proving **conversational memory survived the restart**, not just
  the event log.

### 5.6 Verdict

**The standalone single-agent host is healthy and is the right substrate.** The
disconnected-and-asynchronous property that motivates this entire epic — a
consumer absent across a process restart resuming from a cursor with history
intact — is demonstrably already true.

Three honest caveats, each a plan input rather than a blocker:

1. **`BORING_CHAT_DURABLE_STREAM` is off by default.** Channels are the first
   component to require it in production → §4.3's boot assertion.
2. **The HTTP `/events` route does not expose the durable store.** Its `cursor`
   is a numeric index into the in-memory `PiChatReplayBuffer`, and cold open
   only rehydrates the last ~1000 events; beyond that a consumer gets
   `PI_CHAT_REPLAY_GAP`. This is exactly why r2.1 decision 1 has the adapter
   read `eventStore.readEvents` directly. **Confirmed correct — do not build the
   channel on the HTTP route.**
3. **`sessionKey` is private**, so nothing outside the service can compute a
   stream path. r2.1 already scoped the exported resolver; it is real work, not
   a formality.

Repro recipe is in §9.

---

## 6. Architecture of the new v1 lanes

### 6.1 Approval-in-WhatsApp (the ask-user machinery over WA)

**What exists.** `plugins/ask-user/` is complete and rich:
`createAskUserTool` (`name: "ask_user"`), a typed question model
(`AskUserQuestion` with `questionId`, `sessionId`, `ownerPrincipalId`, `status`,
`schema`, `artifacts`, and a constant-time-compared **`answerToken`**), a form
schema of up to 8 fields (`text|textarea|select|multiselect|checkbox|radio|number`,
≤50 options, default 10-min / max 30-min timeout), and bridge ops
`ask-user.v1.{request,answer,cancel,pending,transcript}`.

**What blocks us — precisely.** The bridge ops are caller-class gated:
`answer`/`cancel`/`pending` accept **`browser`** and **`server`** only. Over
HTTP (`POST /api/v1/workspace-bridge/call`) only two classes are reachable:
`runtime` (bearer token) and `browser` (hardcoded for cookie auth). So:

> a runtime-token client can `request` but **cannot** `answer`; a browser client
> can `answer` but is scoped by `assertBrowserSessionScope` + `assertQuestionOwner`.

**There is no headless HTTP path that enumerates and answers pending questions.**
`ask-user.v1.pending` returns *one* question, not a list, and the UI-state slot
`questions.pending` deliberately **omits `answerToken`**.

**Design.** The channel is an **in-process `"server"`-class caller** holding the
same `AskUserStore`/`AskUserRuntime` instance. This is why §3.2 puts the core
inside `packages/agent` and §4.1 picks the single-process standalone host — the
approval lane is the requirement that makes both non-negotiable. No new public
HTTP surface, no `answerToken` on the wire, no second approval channel
(`08:284`: "Existing permission prompts and the ask-user plugin migrate onto
this path; no second approval channel").

**Mapping to WhatsApp interactive messages.**

| ask-user | WhatsApp | Constraint |
| --- | --- | --- |
| single `radio`/`select`, ≤3 options | interactive **reply buttons** | Meta caps at 3 buttons, 20 chars each |
| single `select`, 4–10 options | interactive **list** | Meta caps at 10 rows |
| `checkbox` (approve/reject) | 2 reply buttons | the owner-approval case |
| `text`/`textarea` | free-text reply | next inbound message is the answer |
| **multi-field forms (2–8 fields)** | **not expressible** | → deferral message: answer in the workspace |

**Correlation is the hard part.** WhatsApp has no ephemeral messages and no
Slack-style `onAction` event — an interactive reply arrives as a *normal inbound
message* carrying the button's `id`. So:

- the outbound interactive message encodes `{questionId, fieldId, optionIndex}`
  into the button `id` (opaque, ≤256 chars, **no `answerToken`** — the token
  stays server-side and is looked up from the binding's `askUserPending`);
- the drain worker checks `askUserPending` **before** treating an inbound as a
  prompt. An inbound that resolves a pending question is routed to
  `ask-user.v1.answer`, **not** to `prompt`;
- `askUserPending` is **consumed by exactly one inbound** (CAS), so a
  double-tapped button answers once — the r2.1 sketch, now load-bearing;
- a stale button (question already answered, cancelled, or timed out) gets a
  short "that request has expired" notice, never silence;
- an ask-user **timeout** (≤30 min) while the user is away is a normal cancel →
  failure notice out-channel.

**Ordering hazard.** The turn assembler suppresses tool-call events (r2.1 §3),
yet ask-user detection lives in exactly those events. This was r2.1's stated
reason for demotion and it is real: the assembler must special-case ask-user
*without* leaking general tool chatter to the channel. This is the risk centre
of slice 3 and gets its own review budget.

**Dependency:** this lane targets whatever seam `fix/786` lands
(`fix/786-human-intention-artifacts` is in flight and touches this machinery).
Slice 3 is sequenced after it merges; if it slips, slice 3 slips, and slices
1/2/4/5 are unaffected.

### 6.2 Artifact drop (expiring links + PDF)

**What exists — less than the name suggests.** `packages/agent/src/shared/share-entry.ts`:

```ts
interface ShareEntryV1 { schemaVersion: 1; id: string; workspaceId: string;
  path: string /* SERVER-INTERNAL */; provenance: {...} }
interface ShareEntryStore { create; get; delete; list }
class InMemoryShareEntryStore implements ShareEntryStore
```

plus `resolveShareEntry` (→ `ok | not_found | tombstoned`) and MCP exposure via
`shareResourceUri(id)` / `registerShareEntryResources`.

**What is missing — be blunt about it.** The route `GET /a/:id`
(`server/http/routes/deepLink.ts`) is **workspace-membership-scoped**, and its
200 body is `{status:"ok", workspaceId, id}` — **it does not serve bytes at
all.** There is **zero** `publicUrl` / `signedUrl` / expiry machinery anywhere in
the repo. The only byte-serving routes are authenticated. And the AR1 lane
explicitly rules the other way: "The returned human link contains neither a
capability secret nor a workspace path; the authenticated member lands on the
destination-local copy" — i.e. AR1 links **require an authenticated session at
the destination**. A WhatsApp recipient has no account. AR1 is not our answer.

**So this lane builds a genuinely new surface.** Design constraints, taken from
the ratified artifact security posture in `08`:

- tokens address **`artifactId + version + capability`, never workspace paths**
  (the PR #424 learning); `ShareEntryV1.path` is server-internal and must never
  appear in a URL;
- **snapshot-on-publish beats live-file access** — the PDF is frozen at send
  time, so a later workspace edit cannot retroactively change what a client was
  quoted. This is a correctness requirement for quotes, not just security;
- read-only, single-purpose, **expiring** (default 7 days, configurable),
  **revocable**, actor-attributed;
- served from a separate viewer origin with `CSP default-src 'none'`, no host
  cookies or storage, EU/CH blob storage.

**Durability gap:** `ShareEntryStore` ships only as `InMemoryShareEntryStore`.
Links that die on restart are unacceptable for a quote sent to a client. A
sqlite-backed store is in scope for this slice.

**PDF.** No PDF generation exists in the repo. Options, all EU/CH-safe because
they are local: headless-Chromium HTML→PDF (heavy dep, best fidelity, and the
design system already renders to HTML), or a typesetting path. Recommendation:
**HTML→PDF via headless Chromium**, reusing the product lane's quote template.
The CH-trades lane owns the template's content and layout; this lane owns only
"turn the rendered artifact into bytes behind an expiring link". Deliver the
link *and* the PDF as a WhatsApp **document** message, since Meta renders
document attachments inline and clients trust them more than a bare link.

### 6.3 Inbound media

**Photos — a short path exists.** `ChatAttachmentPayloadSchema`
(`shared/chat/piChatSchemas.ts`) is `{filename?, mediaType?, url, path?}`, max
20 per prompt, and `promptImagesFromAttachments` in `harnessPiChatService.ts`
accepts `data:image/*;base64,…` directly (magic-byte sniffed to
png/jpeg/gif/webp, capped by `MAX_PROMPT_IMAGE_BYTES`). So a downloaded photo
can reach the model **with no core change**.

Three real constraints:
1. **Non-image attachments are silently dropped** from model input — they
   survive only as metadata. PDFs a client sends will *not* be read by the model
   in v1. Say so in the reply rather than pretending.
2. **`FollowUpPayload` has no `attachments`** — only the first prompt of a turn
   can carry media. A photo arriving mid-turn must open a new turn or be
   deferred; the drain worker must handle this explicitly.
3. Media must be fetched from Meta's Graph API by media-ID (short-lived,
   authenticated URLs), then stored **CH/EU-side** before use.

**Voice notes — honest about transcription.** WhatsApp voice notes are OGG/Opus.
The repo has **no** file-transcription function. `plugins/live-transcription/`
exists but is *live dictation*: `whisperLiveKit.ts` / `kyutai.ts` take a browser
PCM stream over a WebSocket, gated to loopback/local authority. It is not a
"give me an audio blob, get text" API.

Provider options, with jurisdiction stated plainly:

| Option | Jurisdiction | Assessment |
| --- | --- | --- |
| **Self-hosted Whisper on our own VPS** (reuse `live-transcription`'s WhisperLiveKit compute) | **Ours — CH/EU, no third party** | **Recommended.** Message content never leaves our infrastructure, which is the same posture that made us reject Cloudflare. Cost is GPU/CPU time. Needs a new batch-file entry point beside the streaming one. |
| **Infomaniak** (CH) | **Swiss** | Already a first-class configured provider in `models/modelConfig.ts` (`readInfomaniakProvider`). Strong sovereignty fit **if** they expose a speech-to-text endpoint — verify before relying on it; today we use them only for chat completions. |
| OpenAI Whisper API | **US** | Rejected for message content. Same CLOUD Act reasoning that rejected Cloudflare. |
| Google / Gemini audio | **US** | Rejected for message content, for the same reason. |

**Ruling for this plan: self-hosted Whisper, with Infomaniak as the fallback if
a Swiss managed endpoint is preferred operationally.** No US processor touches
WhatsApp message content. The privacy policy submitted in step 0.1 must name
whichever is chosen.

Transcription is **attached as text**, with the original audio retained as a
stored artifact so a human can re-listen when the transcript is wrong.

---

## 7. Risks

### 7.1 The 24-hour customer service window — MUST be in the plan

Meta permits free-form business replies **only within 24 hours of the customer's
last message**. Outside it, free-form sends are rejected and only **approved
template messages** may be sent.

This is not an edge case for an agent channel — it is the normal case. A long
research turn, a queued approval the owner answers the next morning, or a
retry-after-park all land outside the window.

Concretely:
- the binding tracks `lastInboundAt`; the outbound worker checks the window
  **before** every send;
- inside the window: free-form;
- outside: send the single approved UTILITY template (step 0.4) — "your agent
  has an update, reply to continue" — which reopens the window when the user
  replies, then deliver the held content;
- **the pending content must not be discarded** while waiting; it stays at the
  cursor and is delivered after the window reopens;
- proactive/agent-initiated outreach beyond that one template stays **out of
  scope** (r2.1, unchanged) — it is the fastest way to get a number banned.

Cost note: template messages are billed per conversation; free-form replies
inside a service window are not. A chatty agent that habitually falls outside
the window is an expense, not just a UX problem.

### 7.2 Meta policy compliance for business-initiated messages

- v1 is **strictly user-initiated**. No lists, no imports, no broadcast.
- Quality rating is per-number and degrades on user blocks/reports; a low rating
  throttles then bans the number. **With ONE number for all tenants, one
  tenant's users can degrade delivery for every tenant.**
- Mitigations: the fail-closed unknown-sender policy (r2.1 §2,
  rate-limited to once per sender — an unrate-limited auto-reply is itself a
  ban risk), an explicit opt-out keyword (STOP) honoured before any agent
  invocation, and monitoring of the quality rating as an operational alert.

### 7.3 One-number multi-tenant identity limits

The owner's pilot ruling has consequences worth stating rather than discovering:

1. **A phone number is the only identity we get.** No email, no verified name.
   The binding table is the entire trust decision, and it is explicitly
   provisioned (r2.1: "Bindings provisioned explicitly (CLI/admin op in v1)").
   Someone who knows the number and is not provisioned gets the polite rejection.
2. **One person = one binding = one session.** A user who works with two tenants
   from one phone cannot be disambiguated. v1 accepts this; the binding is
   `(channel, externalId, agentTypeId)` and the pilot must not assign one human
   to two tenants.
3. **Number loss / SIM reuse.** A recycled number silently inherits a binding.
   Bindings need an expiry/re-confirmation policy; v1 mitigates with revocable
   status and the age alert from r2.1 open question 5.
4. **Tenant separation is per-session inside one workspace scope** (§4.2), not
   per-workspace. Acceptable for a pilot; it is the item to revisit before any
   non-pilot customer.
5. **The owner-approval flow assumes we know who the owner is.** With one
   number, the approver is identified by *their own* binding, not by the
   number — so approval routing needs an explicit `approverExternalId` on the
   tenant config rather than being inferred.

### 7.4 Engineering risks

| Risk | Mitigation |
| --- | --- |
| `followUp` stranding (§1.2a) | `DrainCoordinator` in slice 1a, failing test first |
| Duplicate outbound sends | Accepted and documented: at-least-once; no send idempotency key exists at Meta |
| Turn assembler leaking tool chatter while detecting ask-user | Isolated in slice 3 with its own review budget |
| Durable-stream flag off in prod | Boot assertion (§4.3) |
| `@flue/whatsapp` and `@chat-adapter/whatsapp` both drag in a bot framework | Hand-rolled Meta client is the named fallback; contract unchanged either way |

---

## 8. Slices

Each is one PR. `1a → 1b → {3, 4, 5} → 6`; slices 3/4/5 are parallel after 1b.

### Slice 1a — channel core: contract, bindings, inbound path
**Delivers:** `ChannelAdapter` contract; `ChannelBindingStore` (bindings +
durable dedupe + inbound queue, **dedupe-row and queue insert in one sqlite
transaction**, with CHAN-A's owner-token CAS create-race machine); the
`DrainCoordinator` + `followUp` fix (§1.2a); inbound park policy; async-ack
webhook core; trusted-caller seam with guardrails; provisioning CLI op; flag
plumbing + the durable-stream boot assertion (§4.3); fake-channel inbound tests.
**Blocked by:** none — substrate proven in §5.
**Proof:** replayed `providerMessageId` (including across a restart) produces
exactly one turn; a crash between dedupe insert and queue insert loses nothing
(crash-tested); unknown sender fail-closed with a stable code and no session;
three rapid inbounds mid-turn all reach the agent in order (the `followUp`
regression test, red before the fix); flag off → byte-identical host.

### Slice 1b — durable tail, turn assembly, outbound
**Delivers:** the exported stream-path resolver on the pi-chat service; the
per-binding tail worker (subscribe-then-read-until-`upToDate`, cursor CAS);
terminal-event turn assembler (`agent-end` → render; error/aborted → failure
notice; stall timeout → notice + park); markdown→dialect shaping with 4096
chunking and fence reopen; send-failure/park policy; gone-session recovery;
**the 24h-window check and template fallback (§7.1)**; full fake-channel
conformance suite.
**Blocked by:** 1a. **Risk centre — own review budget** (turn assembly).
**Proof:** conformance loop green in CI surviving graceful restart mid-conversation
with cursor resume and zero duplicate sends; on hard crash between send and CAS,
a duplicate is possible and asserted **not to be loss**; error/aborted/stalled
turns always produce a notice, never silence; a permanently unsendable message
parks without wedging the binding; a reply attempted outside a simulated 24h
window sends the template and delivers the held content after the window
reopens.

### Slice 2 — deployment shape
**Delivers:** the standalone-host deployment for the channel (§4): host wiring,
`BORING_AGENT_SESSION_ROOT` on the durable volume, `BORING_CHAT_DURABLE_STREAM=1`,
credentials via `server/credentials/`, public HTTPS webhook endpoint answering
the `hub.challenge` handshake (unblocks step 0.1's endpoint verification).
**Blocked by:** 1a. **Proof:** the §5 loop reproduced against the deployed host;
Meta's webhook verification succeeds against the public URL.

### Slice 3 — approval in WhatsApp (ask-user over WA)
**Delivers:** in-process `"server"`-class ask-user caller; ask-user detection in
the turn assembler without leaking tool chatter; schema→interactive mapping
(buttons ≤3, list ≤10, free-text, multi-field→deferral); button-id correlation
codec; `askUserPending` CAS consumed-by-exactly-one-inbound; stale/expired/timeout
notices.
**Blocked by:** 1b **and** `fix/786` landing. **Own review budget.**
**Proof:** an agent turn calling `ask_user` with a 2-option approval renders two
WhatsApp buttons; tapping one resolves the question exactly once and the turn
continues; double-tap answers once; a stale button gets an expiry notice; an
8-field form renders the deferral message; `answerToken` never appears in any
outbound payload (guard test); no phone number reaches an agent API (two-handles
guard).

### Slice 4 — artifact drop: expiring links + PDF
**Delivers:** sqlite-backed `ShareEntryStore`; a **new public, unauthenticated,
expiring, revocable** share route on a separate viewer origin, addressing
`artifactId + version + capability` and never a workspace path;
snapshot-on-publish; HTML→PDF rendering; WhatsApp document-message send.
**Blocked by:** 1b. Coordinates with the CH-trades lane for the quote template.
**Proof:** a quote artifact produces a link that opens with no account; the link
404s after expiry and after revocation; the served PDF is the snapshot, unchanged
by a later workspace edit; no workspace path or capability secret appears in the
URL; store survives restart.

### Slice 5 — inbound media
**Delivers:** Meta media-ID download; CH/EU-side storage; photos → prompt
attachments via the existing image path; **batch-file transcription entry point
beside `live-transcription`'s streaming one** (self-hosted Whisper); transcript
attached as text with original audio retained; explicit honest reply for
unsupported types (PDFs etc., per §6.3 constraint 1); mid-turn media policy
(`FollowUpPayload` has no attachments).
**Blocked by:** 1b. **Proof:** a photo sent on WhatsApp reaches the model and is
described back; a voice note is transcribed and answered; a sent PDF gets the
honest "I can't read documents yet" reply rather than silence; no media bytes
transit a US processor (documented data path).

### Slice 6 — WhatsApp provider edge (Meta Cloud API)
**Delivers:** `packages/channels/whatsapp` behind the contract — signature
verify + handshake, payload parse (text/media/interactive), chunked send,
template send, retry; recorded-fixture unit tests; host wiring.
**Opens with a bounded one-day bake-off (§2.3):** `@flue/whatsapp` (Apache-2.0,
the *ratified* ingress choice, never evaluated by r2.1) vs
`@chat-adapter/whatsapp` (MIT, r2.1's pick). **Acceptance for either: it must
stand alone behind our contract without dragging in its bot framework's
state/dedupe model.** Hand-rolled Meta client is the named fallback. Either
outcome leaves the conformance suite and acceptance unchanged.
**Blocked by:** 1b for the contract; **step 0** for the live demo only.
**Proof:** fixture tests for verify/parse/chunk/template; live demo against the
Seneca number — a multi-message conversation spanning a server restart, with one
approval answered in WhatsApp and one quote PDF delivered.

---

## 9. Repro recipe for §5

```bash
cd /home/ubuntu/projects/boring-ui-v2/.worktrees/playground-main
export BORING_CHAT_DURABLE_STREAM=1
export BORING_AGENT_SESSION_ROOT=/tmp/wa-ws/sessions
export BORING_AGENT_CUSTOM_MODEL_PROVIDER=gemini
export BORING_AGENT_CUSTOM_MODEL_ID=gemini-2.5-flash
export BORING_AGENT_CUSTOM_MODEL_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
export BORING_AGENT_CUSTOM_MODEL_API_KEY=<vault: secret/agent/gemini field api_key>
export BORING_AGENT_DEFAULT_MODEL=gemini:gemini-2.5-flash
```

Boot script (needs the host-injected runtime adapter — see §5):

```ts
const R = '<repo>/packages/agent/src'
const { createStandaloneAgentHostApp } = await import(`${R}/server/createStandaloneAgentHostApp`)
const { agentSandboxRuntimeHostOperations, createAgentSandboxRuntimeModeAdapter }
  = await import(`${R}/../host/sandbox.ts`)
const app = await createStandaloneAgentHostApp({
  mode: 'direct',
  runtimeModeAdapter: createAgentSandboxRuntimeModeAdapter('direct'),
  runtimeHost: agentSandboxRuntimeHostOperations,
  workspaceRoot: process.env.WA_WS, sessionId: 'default', logger: false,
})
console.log(await app.listen({ port: 5458, host: '127.0.0.1' }))
```

Drive it (`requestId` and `clientNonce` are required):

```bash
B=http://127.0.0.1:5458
SID=$(curl -s -X POST $B/api/v1/agents/default/sessions \
  -H 'content-type: application/json' -d '{"requestId":"c1"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["sessionId"])')
curl -sN "$B/api/v1/agents/default/sessions/$SID/events?cursor=0" &
curl -s -X POST "$B/api/v1/agents/default/sessions/$SID/prompt" \
  -H 'content-type: application/json' \
  -d '{"requestId":"t1","clientNonce":"n1","content":"Reply with exactly: DURABLE_OK"}'
```

Kill the process, rerun the boot script, and replay `?cursor=0` — all frames
return and the next prompt continues the stream.

---

## 10. Open questions — owner decisions required

1. **Placement split (§3.2)**: core in `packages/agent/src/server/channels/`,
   provider edge in `packages/channels/whatsapp`. This narrows ratified
   DECISIONS.md decision 3 and needs an explicit owner ratification.
2. **Transcription provider (§6.3)**: self-hosted Whisper (recommended) vs
   Infomaniak, pending confirmation that Infomaniak offers speech-to-text. Names
   a sub-processor in the step-0 privacy policy, so it must be decided before
   step 0 is submitted.
3. **Share-link expiry default (§6.2)**: proposed 7 days. Quotes may warrant
   longer; longer means a bearer link lives longer.
4. **Approver identity (§7.3 item 5)**: confirm `approverExternalId` per tenant
   is the right v1 model for "owner approves in WhatsApp".
5. **Slice 3 sequencing**: confirm slice 3 waits for `fix/786`, and that slices
   1/2/4/5 shipping without in-channel approval (deferral message meanwhile) is
   an acceptable intermediate state.
6. **Governance**: this plan reverses the 2026-08-08 deprioritization in
   `docs/direction/STATE.md`. That file needs updating on approval.

## 11. Out of scope

Email/SMS channels; group chats; per-agent grant policy (#1087); proactive
outreach beyond the single fallback template; multi-agent routing per sender;
horizontal adapter scale-out; billing/metering of channel traffic; per-workspace
tenant isolation (§4.2); model-readable inbound PDFs (§6.3); the CH-trades
product surface (separate lane).
