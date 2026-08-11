---
github: https://github.com/hachej/boring-ui/issues/1127
issue: 1127
state: external-channels reframe (r4.1) — generic channel registry + descriptor mechanism, WhatsApp as v1 consumer; adversarial-review reframe folded in (2026-08-11): PILOT = provisioned bindings / fail-closed, open self-serve WhatsApp signup + phone identity + account merge DEMOTED to Phase 2; better-auth phone-first claims corrected against code; descriptor = rendering-only + adapter-owned opaque conversation key; slice 6 verdict = build thin (seed Flue edge + Hermes reference); ready for owner gate merge
updated: 2026-08-11
supersedes: docs/issues/1127/plan.md (r2.1) — for the channels lane only
flag: BORING_AGENT_CHANNELS (from r2.1; channel registry + adapter host are dead code when off)
---

# gh-1127 — External Channels — execution plan (WhatsApp as v1 consumer) (r4)

The #1127 channels epic, matured from a WhatsApp-specific lane into a **generic
channel registry**. A "channel" is any external surface that drives an agent
session; WhatsApp is the **one fully-built consumer** for v1. Everything that is
actually WhatsApp-specific is labeled as such; everything generic lives in the
registry + descriptor mechanism (§0.5) so the next consumer (Slack, email,
pi-excel) is a descriptor + adapter, not a UI project.

Revives the epic under the owner rulings of **2026-08-10** (which reverse the
2026-08-08 deprioritization recorded in `docs/direction/STATE.md:33`) and the
**generalization ruling of 2026-08-11** (owner-ratified): channels become a
registry of descriptors with two orthogonal capabilities, and WhatsApp is
consumer #1.

**This plan is the CHANNEL MECHANISM only.** A parallel Opus lane is planning
the CH-trades PRODUCT side (quotes, verticals, the actual agent behaviour).
Where this document says "the agent replies", that lane owns what it replies.
Do not duplicate; reference.

## Reading order (r4 structure)

1. **§0.5 — the generic mechanism** (registry + descriptor + the two orthogonal
   capabilities + session-pane rendering). Read this first: it is what the epic
   now is.
2. **WhatsApp as consumer #1** — §0 through §7 are the WhatsApp consumer's
   step-0/slices/risks. Each is tagged **[GENERIC]** (belongs to the mechanism)
   or **[WA-SPECIFIC]** (the WhatsApp consumer's own detail) where it matters.
3. **§0.6 — future consumers** (Slack, email, pi-excel) — noted only, zero v1
   implementation scope; they prove the mechanism is generic.

## Owner rulings folded in (2026-08-10)

| Ruling | Effect on r2.1 |
| --- | --- |
| **Meta Cloud API DIRECT** | Confirms r2.1 decision 3 verbatim. Kills the Twilio fallback of open question 4 — App Review turnaround is now ~24h, so the fallback has no reason to exist. |
| **ONE Seneca number, multi-tenant** | Compatible with r2.1 §4 ("one endpoint serves many tenants since routing is `(channel, externalId) → binding`"). Adds a hard identity constraint — see §7 risks. |
| **v1 = inbound text → agent session** | r2.1 slices 1a + 1b, unchanged. |
| **v1 = outbound drafts with OWNER APPROVAL IN WHATSAPP before send** | **Reverses r2.1's demotion of `ask_user` to slice 3.** The ask-user machinery becomes v1-critical. New slice 3. |
| **v1 = artifact drop into chat (expiring links + PDF)** | **New scope.** r2.1 had nothing here. New slice 4. |
| **v1 = inbound media (photos, voice notes → transcribed)** | **Reverses r2.1's "Out of Scope: inbound media→agent attachments".** New slice 5. |

## Owner rulings folded in (2026-08-11, PR #1211 comments)

| Ruling | Effect on this plan |
| --- | --- |
| **Bindings target WORKSPACE sessions on the app host** (the customer's signup→default-agent workspace), not the standalone host | **Reverses §4.1's standalone-host recommendation.** §4 rewritten. Channel CORE placement in `packages/agent` (§3.2) and the in-process server-class caller requirement (§6.1) stand unchanged. Standalone host stays documented as the future headless tier; its §5 verification covers the shared substrate. Slice 2 retargeted. |
| **Channel = first-class typed session property** (`'whatsapp'` now; `'web'` default; slack/email later reuse the field) | New §6.4. Badge in session list, filterable, drives per-session dialect shaping. Binding schema's session linkage made explicit as this typed property (slice 1a). |
| **Reopen-in-workspace v1 = READ-ONLY** (existing read-only session idiom, channel-badged, full transcript; workspace-side interaction limited to Inbox approvals) | New §6.5. Cuts reopen to near-zero new UI → small slice 7. |
| **Two-way human-takeover = v2** | Named v2 slice 8, carrying the parked design sheet (24h-window behavior — the send API itself is symmetric, same send path; visible labeling; agent yields on takeover, resumes on explicit handback). Not v1 scope. |

**Net slice-scope changes from these rulings:** slice 4 SHRINKS (channel-side
artifact store and public unauthenticated viewer origin dropped — artifact drop
collapses to share-resource links rendered by the product's own viewers, since
the recipient is an authenticated workspace member); slice 2 is retargeted from
standalone-host deployment to app-host wiring; new small slice 7 (read-only
reopen surfacing); new v2 slice 8 (human-takeover). §7.3's
one-workspace-scope tenancy limitation dissolves (separation is now
per-workspace).

Everything in r2.1 §1–§4 that these rulings do not touch is **revived verbatim**
and is not restated here. Read `plan.md` first; this document is the delta plus
the four new lanes.

## Generalization ruling folded in (2026-08-11, owner-ratified)

| Ruling | Effect on this plan |
| --- | --- |
| **Channels are a REGISTRY of typed descriptors**, not WhatsApp-specific code | New §0.5. A channel descriptor `{ id, label, icon, sessionsReadOnlyInWorkspace, dialect/formatting, isIdentityProvider }` drives all per-channel workspace behavior; sessions carry an `originChannel` (this **is** the implementation of the already-planned "channel = typed session property", §6.4). |
| **A channel has TWO ORTHOGONAL capabilities:** (a) interaction surface (chat with the agent — ALL channels); (b) identity provider (sign up / auth — only some) | New §0.5. WhatsApp = both; Slack/email/pi-excel = interaction only. This split is the core design insight — made explicit so identity work (§6.6, slice 1c) is understood as the *identity-provider capability of the WhatsApp consumer*, not a channel-universal requirement. |
| **Session pane renders icon + read-only badge PURELY from the descriptor** | Re-anchors §6.4/§6.5: no per-channel UI code. `sessionsReadOnlyInWorkspace` and `icon` are descriptor fields the pane reads; the read-only reopen (§6.5) is a **generic descriptor property**, not WhatsApp UI. |
| **WhatsApp = the ONE fully-built consumer for v1; Slack/email/pi-excel = future consumers, NOTED ONLY, zero implementation scope** | New §0.6. No work items/slices for future consumers. `demo/pi-excel-coupling` exists as a prior demo branch validating the pattern. |

## Adversarial-review reframe folded in (2026-08-11, r4→r4.1)

The Fable adversarial review FAILED r4 on the identity lane (not on the
pipeline/binding core, which passed). r4.1 applies the reviewer's path-to-PASS.
These are honesty/architecture fixes, not cosmetic.

| Finding | Fix applied |
| --- | --- |
| **R1** — pilot's "unknown sender = signup" (old slice 1c) contradicts 1a's fail-closed | **Pilot = provisioned bindings, fail-closed** (new §0.7). Open signup demoted to Phase 2 (§6.6). |
| **R2/R3** — false "just a magic-link delivery adapter / provider #4 is a config line" claims | Corrected against code (§6.6): better-auth magic-link is **email-keyed**, mounted only with a mail transport, gated on `emailVerificationEnabled`; `accountLinking` and a `phoneNumber` plugin are **NOT installed**. Phone-first identity is **real Phase-2 work**. |
| **R4** — v1 merge flow asserted, not specified | **Demoted to Phase 2**, marked unspecified/hard — no account-merge primitive exists (§6.6). Pilot's single provisioned binding needs no merge. |
| **R5** — open signup is an unpriced abuse surface | Abuse controls moved to a **Phase-2** §7.2 subsection; the pilot's fail-closed posture (§0.7) avoids the surface entirely. |
| **R6** — descriptor doesn't distinguish channels; binding key is WhatsApp-shaped | Descriptor reframed as **rendering-only** contract; delivery/threading/credentials are **adapter-owned**; binding key is an **opaque adapter-owned conversation key** (§0.5.1, §0.5.5). |
| **R7** — `isIdentityProvider` boolean does no work, `web:false` self-contradicts | Renamed `canOriginateIdentity`, given **teeth** (gates whether inbound may reach an identity route), **web=true** (§0.5.1/§0.5.3). |
| C1/C3/C4 (recommended) | read-only = per-deployment policy (§6.5); OTP-window claim flagged `[UNVERIFIED]` (§6.6); slice 1a split registry-first (§8). |

---

## 0.5 The generic mechanism — channel registry + descriptor [GENERIC]

This is what the #1127 epic now is. WhatsApp (§0–§8) is the first consumer of
this mechanism; the mechanism itself is channel-agnostic.

### 0.5.1 A channel is a typed descriptor in a registry

A **channel** is any external surface that drives an agent session (WhatsApp,
Slack, email, a spreadsheet add-in). The registry holds one **descriptor** per
channel:

**The descriptor is the WORKSPACE-RENDERING contract — nothing more.** It carries
only what the workspace UI needs to render a channel-originated session: icon,
read-only badge, dialect/formatting. It deliberately does **not** carry
delivery, threading, credentials, webhook, or media semantics — **those are
adapter-owned** (§3.2, §0.5.5). The descriptor generalizes the *rendering*; the
adapter owns *delivery/threading/credentials*.

```ts
interface ChannelDescriptor {
  id: string                          // 'whatsapp' | 'web' | 'slack' | 'email' | 'excel' | …
  label: string                       // human label for the badge/filter
  icon: string                        // rendered in the session pane; NO per-channel UI code
  sessionsReadOnlyInWorkspace: boolean// true → workspace reopen is read-only (§6.5); per-deployment
                                      //   POLICY default, not channel nature (see §0.5.4, C1)
  dialect: ChannelDialect             // OPEN-ENDED formatting/chunking tag (NOT a frozen enum);
                                      //   §3-shaping; 'web' = passthrough
  // capability FLAG only — documents whether this channel's inbound can create/authenticate
  // an identity. It does NOT drive a generic mechanism; identity wiring is consumer-specific
  // (§0.5.3, §6.6). It gates ONE thing: whether the adapter's inbound path is ALLOWED to reach
  // an identity-minting route at all. web=true (web IS where signup happens), whatsapp=true
  // (phase 2 only), slack/email/excel=false.
  canOriginateIdentity: boolean
}
```

`ChannelDialect` is an **open string tag**, not an enum frozen at
`web|whatsapp` — future descriptors (e.g. `excel/cell`, `slack/mrkdwn`) add tags
without a registry change.

`'web'` is a descriptor too — the default for everything that exists today
(`sessionsReadOnlyInWorkspace: false`, `dialect: passthrough`). Its
`canOriginateIdentity` is **`true`**: web is where every existing signup happens
(email/password, Google, GitHub). Adding a channel is **registering a descriptor
+ building an adapter**, never editing session-pane UI.

### 0.5.2 Sessions carry `originChannel`

Every session carries a typed **`originChannel`** property (the descriptor `id`).
This **is** the implementation of the already-planned "channel = first-class
typed session property" (§6.4): `'whatsapp'` for WhatsApp-originated sessions,
`'web'` for everything existing, future channels reuse the field. The workspace
reads `originChannel`, looks up the descriptor, and renders from it — badge,
filter, read-only gating, dialect selection all flow from `descriptor =
registry[session.originChannel]`. No code branches on a hardcoded channel name.

### 0.5.3 Two orthogonal capabilities a channel MAY have

The core design insight. A channel may have either, both, or (in principle)
neither of two **independent** capabilities:

| Capability | What it means | Descriptor field |
| --- | --- | --- |
| **(a) Interaction surface** | Chat with the agent from here — inbound → session, outbound replies. **ALL channels have this** (it is what makes something a channel). | implicit (every descriptor + its adapter) |
| **(b) Can originate identity** | The channel's inbound is *permitted* to reach an identity-minting/authenticating route. **Only some channels.** This is a **gate**, not a mechanism: `true` means "inbound MAY create/authenticate"; `false` means the adapter's inbound path is fail-closed against identity routes. The identity *mechanism* itself is consumer-specific wiring (§6.6), never generic. | `canOriginateIdentity` |

- **web = true.** Web is where every existing signup happens today
  (email/password, Google, GitHub). The flag exists precisely so web is not a
  special case.
- **WhatsApp = both — but capability (b) is PHASE 2, not pilot.** The pilot uses
  **provisioned bindings** (§0.7): a customer's number is known/allowlisted
  ahead of time, so pilot inbound never mints identity — `canOriginateIdentity`
  is a gate that stays **closed on the pilot path**. Open WhatsApp-native signup
  (minting identity from an unknown inbound) is **Phase 2** (§6.6), where this
  flag is opened and the real phone-identity work lands.
- **Slack / email / pi-excel = interaction only.** `canOriginateIdentity:
  false` — a user is already authenticated in the host product.

Keeping these orthogonal is what stops "channel" from collapsing into "auth
provider": the identity work (§6.6/§7.5) is a **Phase-2** capability of the
WhatsApp consumer, not a tax every channel pays and **not on the pilot critical
path**.

### 0.5.5 The adapter owns delivery, threading, and credentials [GENERIC]

The descriptor is rendering-only (§0.5.1); **everything that makes a channel a
channel at the wire level is adapter-owned**, behind the `ChannelAdapter`
contract (§3.2):

- **Threading model.** WhatsApp = session-per-sender; Slack = per-thread
  (`team:channel:thread_ts`); email = per-subject-thread; excel = per-workbook.
  The store does **not** encode this — see the opaque conversation key below.
- **Delivery constraints.** WhatsApp's 24h-window + template fallback (§7.1)
  lives entirely in the WhatsApp adapter + slices 1a/1b, **not** the descriptor.
- **Webhook / credential / media model, delivery semantics (at-least-once).**
  All adapter-owned.

**Binding key is an OPAQUE, adapter-owned conversation key — not a fixed
`(channel, externalId)` tuple.** The `ChannelBindingStore` maps
`(channel, conversationKey[, agentTypeId]) → (workspaceId, sessionKey)` where
`conversationKey` is an **opaque string the adapter mints and interprets**.
WhatsApp's is the sender number; Slack's is `team:channel:thread`; email's is a
normalized thread id. This is what lets consumer #2 (Slack/email) fit **without
a store schema change** — the store never parses the key. Documented honestly:
the store layer is generic because it treats the key as opaque; the *meaning* of
the key is the adapter's.

### 0.5.4 Session pane renders purely from the descriptor [GENERIC]

The workspace session pane renders **channel icon + read-only-in-workspace
badge** by reading `registry[session.originChannel]` — `icon` and
`sessionsReadOnlyInWorkspace`. There is **no per-channel UI code**: a new channel
appears in the pane the moment its descriptor is registered. This is the generic
form of the earlier "mark WhatsApp sessions read-only with an icon" ask (§6.5),
done once for all channels. Slice 7 delivers this descriptor-driven rendering
using WhatsApp as its first descriptor.

---

## 0.6 Registry-ready future consumers — NOTED ONLY, zero v1 scope [GENERIC]

These prove the mechanism is generic. **None carries a work item or slice in this
plan; there is zero implementation scope for any of them in v1.** They are listed
only to show a new consumer is "register a descriptor + build an adapter":

| Future consumer | Capabilities | Descriptor sketch | Status |
| --- | --- | --- | --- |
| **pi-excel** (spreadsheet add-in) | interaction only | `{ id:'excel', canOriginateIdentity:false, sessionsReadOnlyInWorkspace:true, dialect:'excel/cell' }` (opaque conversationKey = per-workbook) | **Noted only.** A prior demo branch **`demo/pi-excel-coupling`** already validates the channel-coupling pattern end-to-end. Owner ruling: *ignore pi-excel implementation, just note as future consumer.* |
| **Slack** | interaction only | `{ id:'slack', canOriginateIdentity:false, sessionsReadOnlyInWorkspace:true, dialect:'slack/mrkdwn' }` (opaque conversationKey = `team:channel:thread`) | Noted only. `@flue/slack` ingress exists (§2.3) if/when built. Slack threading needs **no store schema change** — the key is opaque (§0.5.5). A future Slack deployment with two-way reply would set `sessionsReadOnlyInWorkspace:false` — it is a policy default, not channel nature (C1). |
| **email** | interaction only | `{ id:'email', canOriginateIdentity:false, sessionsReadOnlyInWorkspace:true, dialect:'email/html' }` (opaque conversationKey = normalized subject-thread) | Noted only. Distinct from the #1165 email *identity* path (which is an identity provider on the web side, not a channel). |

Each is a descriptor + an adapter behind the same `ChannelAdapter` contract
(§3.2) the WhatsApp consumer defines; none needs new session-pane UI, new
identity machinery, or a new mechanism. **Do not scope them here.**

---

## 0.7 Pilot trust posture — PROVISIONED BINDINGS (fail-closed) [WA-SPECIFIC]

**The pilot inbound model is provisioned bindings, not open signup.** This is the
single load-bearing trust decision, resolving the 1a-vs-1c contradiction the
adversarial review flagged (R1). It reinstates the ratified r2.1 §7.3 posture and
removes the "unknown sender = signup" ruling from the **pilot** path.

- **Known/allowlisted senders only.** A customer's phone number is
  **provisioned by us during onboarding** (CLI/admin op, r2.1) and bound ahead of
  time to their pre-created workspace/session. The binding table is the entire
  trust decision.
- **Unknown sender = fail-closed.** An inbound from a number with no binding gets
  **no session, no account, no signup** — a rate-limited polite rejection with a
  stable code (§7.2). There is exactly one inbound trust rule in the pilot, and
  it is deny-by-default.
- **Why this shape.** The pilot needs zero identity build: no phone-keyed
  better-auth work, no account-minting abuse surface, no merge flow. It ships
  fast and safe. Onboarding is a provisioning step we run, not a self-serve
  funnel.

**Open self-serve WhatsApp signup is Phase 2, honestly scoped as real work.**
Minting an identity from an unknown inbound (the old slice 1c) is moved **off the
pilot critical path** into an explicit later phase (§6.6). It carries the real
phone-identity build (better-auth is email-keyed today — §6.6), the abuse
controls (§7.2 Phase-2 subsection), and the account-merge flow (§6.6) — none of
which the pilot needs. **Pilot = provisioned bindings (fast, no identity build);
open phone-first signup = Phase 2 (real work).**

| | **Pilot (v1)** | **Phase 2** |
| --- | --- | --- |
| Inbound from unknown number | fail-closed, no session | SIGNUP (mint identity) |
| Identity build | none (bindings only) | real: phone-keyed better-auth path (§6.6) |
| Abuse controls | rate-limited rejection | account-minting caps (§7.2 Phase 2) |
| Account merge | n/a (one provisioned binding) | required, unspecified/hard (§6.6) |
| `canOriginateIdentity` gate (WhatsApp) | **closed** | opened |

---

## Step 0 — Meta App Review submission (FIRST ACTION OF THE WHATSAPP CONSUMER) [WA-SPECIFIC]

This is step 0 because Slice 6 (the provider edge) cannot be demoed without it
and the owner cites ~24h turnaround. It is owner-side, not engineering-side, and
it runs in parallel with slices 1–5.

**Scope of the Meta setup (2026-08-11 identity ruling, §6.6):** this is
**one verified Seneca WABA + Meta business verification** for our own number —
the number users text. That is all this model needs. **Embedded Signup and
per-customer OAuth are explicitly OUT of scope**: they exist only to send *as a
customer's own number*, whereas here users text OUR number and their number is
merely their identity. The weeks-long per-customer-verification gate does not
exist on this path. Per-customer Embedded Signup remains a **separate future
capability**, in scope only if a specific customer later wants replies sent on
their own number.

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

### Step 0 exit criteria

- App Review approved for both permissions.
- Business verification cleared.
- One phone number registered, display name approved.
- One UTILITY template approved.
- Webhook handshake verified by Meta against our public endpoint.

**Gate:** slices 1–5 do not block on this. Only slice 6's live **production**
demo does — and even that has a dev-loop escape hatch: hermes-agent's Baileys
bridge (§2.5) can demo the channel end-to-end before verification completes,
under the never-for-customer-numbers caveat.

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

**The gap (r2.1):** r2.1 chose Vercel's `@chat-adapter/whatsapp` for the
provider edge (via `cloudflare-channels-assessment.md`) and **never evaluated
`@flue/whatsapp` at all** — despite `@flue/*` being the *ratified* choice and
`@flue/whatsapp` being in the verified list.

**Bake-off RESOLVED (2026-08-11).** The bake-off ran across all three
candidates. **Outcome: BUILD THIN, do not adopt any candidate wholesale.**
`@flue/whatsapp` gives only the inbound signature/webhook **edge** (~250
reusable LOC, Web-Crypto, invariant-clean) — near drop-in as a **seed**, but no
send/media/template/interactive. hermes-agent's `whatsapp_cloud.py` is the
best **correctness reference** (wamid dedup, 24h-window/template fallback, media
caps, formatting, conformance vectors) but is Python — a **port source**, not a
dependency. `@chat-adapter/whatsapp` is **rejected**: it is an adapter to
Vercel's `chat` runtime (Thread/`onNewMention`), so it drags in the very
thread-ownership model the ratified "pi owns the conversation brain" decision
rejected, and it uses `node:crypto`/`Buffer` (violates invariants #1/#2). The
saveable delta from any library is small (~600–750 LOC) and sits at the edge —
exactly what Flue seeds cleanly and Hermes documents. Slice 6 therefore builds
a ~600–750 LOC in-house adapter seeded from Flue (edge) + Hermes (reference).

The r2.1 caveat is why no candidate is adopted wholesale — it is the acceptance
bar the in-house adapter still honors:

> "we want the adapter package standalone behind our contract, **not** their
> Redis-state bot framework (their state/dedupe model would duplicate and fight
> our binding store and cursor semantics)."

### 2.4 Cloudflare — assessed and rejected, unchanged

`cloudflare-channels-assessment.md` stands: Cloudflare's own channel catalog has
**no WhatsApp and no SMS**; "on Cloudflare you would build the Meta Cloud API
webhook/send path yourself, exactly as on any VPS"; and "Cloudflare Inc is US
(CLOUD Act exposure regardless of data location) … Incompatible with Seneca's
'no US data path' positioning for message content."

### 2.5 hermes-agent (NousResearch) — third bake-off candidate + dev-loop bridge

`NousResearch/hermes-agent` (MIT, `github.com/NousResearch/hermes-agent`; WhatsApp
docs at `hermes-agent.nousresearch.com/docs/user-guide/messaging/whatsapp`),
surfaced by the owner 2026-08-11. Four takes:

1. **Bake-off outcome — correctness reference / port source (RESOLVED
   2026-08-11).** Its WhatsApp **Cloud API adapter** (`whatsapp_cloud.py`, MIT,
   ~2,100 LOC Python) was evaluated as the third candidate and is the **most
   complete Cloud API reference** of the three — but it is Python, so it is not
   importable. Verdict: **port its correctness logic and conformance vectors**
   (wamid dedup, 24h-window/template fallback, media up/download + size caps,
   markdown→WhatsApp formatting) into slice 6's in-house TS adapter; use its
   `tests/conformance/vectors/whatsapp.json` as our test oracle. Not adopted as
   a dependency.
2. **Dev-loop option: the Baileys bridge.** hermes-agent also ships a
   **Baileys** bridge — unofficial WhatsApp-Web protocol emulation with QR
   pairing, no Meta Business account needed. Recorded as a **development-loop
   option only**: it lets us build and demo the channel end-to-end before
   Business verification (step 0's real long pole) completes. **Hard caveat:
   ban risk, unofficial protocol — NEVER for customer numbers or pilot
   production traffic.** Meta Cloud API direct remains the ratified production
   path (owner ruling, unchanged).
3. **Patterns worth lifting regardless of bake-off outcome:** their
   markdown→WhatsApp formatting converter (input to §3-shaping/slice 1b's
   dialect work) and their streaming-response **message-edit** pattern
   (progressively editing a sent message as the turn streams — to be evaluated
   against our completed-turns-only rule rather than assumed).
4. **Runtime verdict: same as Flue (§2.1).** Cherry-pick adapters and patterns;
   do **not** adopt the agent frame — no seam for our harness loop, no
   tenancy/authorization story, no approval gating.

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
3. The provider edge is **substitutable behind the contract** — the bake-off
   (§2.3, RESOLVED to build-thin) and any future provider swap must not touch
   the core.

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

### 4.1 Owner ruling (2026-08-11): WORKSPACE sessions on the app host

Channel bindings target **workspace sessions on the app host** — the customer's
own workspace, the one created at signup with the default agent — **not** the
standalone single-agent host. This reverses the r3-draft recommendation below
(kept in §4.2 for the record, now describing the future headless tier).

The owner's rationale is architectural, not incidental: **same session through
two doors.**

1. **Deep-link continuity.** When the medium runs out (long quotes, document
   review, panes), WhatsApp can deep-link into the *running workspace session* —
   the customer opens the very session the channel is driving, rather than a
   copy in a separate headless deployment.
2. **Artifact drop collapses.** Because the recipient is an authenticated
   workspace member, artifact drop becomes *sharing links to workspace files
   rendered by the product's own viewers* — reuse the share-resource seam, no
   channel-side artifact store. See the shrunk slice 4.
3. **One approval intention, two surfaces.** Approvals surface in both WhatsApp
   and the workspace Inbox as a single intention (§6.1), not as a channel-local
   copy.

**What this does NOT change.** Channel CORE placement in
`packages/agent/src/server/channels/` (§3.2) stands — the core is host-agnostic
and composes wherever the agent stack composes. The in-process **server-class
caller** requirement (§6.1) is likewise unaffected: the app host runs the same
`HarnessPiChatService`/`agent-host` composition in one process, so the channel
core mounts there exactly as it would have on the standalone host. The binding
row gains an explicit `workspaceId` alongside the session key, and sessions it
creates carry the typed `channel: 'whatsapp'` property (§6.4).

*Why the old §4.2 objections no longer bind:*
- The channel's N per-binding tails are **in-process event-store listeners**
  (r2.1 decision 1), not browser HTTP streams — the hub's known
  connection-starvation problem (Chrome's 6-per-origin limit) is a browser-side
  phenomenon and does not apply to server-side subscribers.
- The webhook needs no browser auth or `x-boring-workspace-id` header: the
  channel core is a trusted in-process caller minting `AuthorizedAgentScope`
  from the binding row (r2.1 §2), resolving the workspace from the binding —
  the hub's browser machinery is bypassed, not fought.

### 4.2 The standalone host: future headless tier (was the r3-draft pick)

`createStandaloneAgentHostApp` remains **documented as the target for a future
headless tier** — deployments with no product workspace at all. It is not the
v1 ingress. Its §5 verification is *not* wasted: durable replay, cursor resume,
terminal events, prompt idempotency, and restart survival are properties of the
**shared substrate** (`HarnessPiChatService` + `SqliteEventStreamStore`) that
the app host composes identically, so §5 stands as the substrate proof for the
workspace-session routing too.

**Tenancy consequence (supersedes the old one-workspace-scope caveat):** the
binding maps `(channel, conversationKey)` → `(workspaceId, sessionKey)` (opaque
key, §0.5.5). Tenant
separation is **per-workspace** — each customer's own signup workspace — not
per-session inside one shared scope. §7.3 item 4 is updated accordingly; the
one-number identity risks (items 1–3, 5) remain.

### 4.3 Flag interaction — unspecified in r2.1, specified here

`BORING_CHAT_DURABLE_STREAM` is **off by default**
(`buildAgentComposition.ts`), and the entire outbound path depends on it.
`BORING_AGENT_CHANNELS=1` with the durable stream off is a silently broken
deployment. **Boot-time assertion:** if channels are enabled and the durable
store is unavailable, fail boot loudly with a stable code, matching the
precedent already set by `f1e245be1` ("fail loudly when durable-stream flag is
on but store unavailable").

---

## 5. Substrate verification — the shared substrate works (run on the standalone host)

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

**The substrate is healthy.** (Run against the standalone host; per §4.2 the
properties proven here — durable replay, cursor resume, terminal events,
idempotent prompt, restart survival — belong to the shared
`HarnessPiChatService`/event-store stack the app host composes identically.) The
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
inside `packages/agent`, running in-process with whichever host composes the
agent stack — under the 2026-08-11 ruling, the app host (§4.1), which the owner
confirmed leaves this requirement unaffected. The approval lane is the
requirement that makes the in-process placement non-negotiable. Per §4.1, the
same approval also surfaces as one intention in the workspace Inbox — WhatsApp
buttons and Inbox answer the same question, whichever lands first wins the
`askUserPending` CAS. No new public
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

### 6.2 Artifact drop (SHRUNK by the 2026-08-11 routing ruling)

**Ruling effect first:** with bindings targeting the customer's own workspace
(§4.1), the WhatsApp recipient **is an authenticated workspace member**. The
owner's ruling collapses artifact drop to **sharing links to workspace files
rendered by the product's own viewers — reuse the share-resource seam, no
channel-side artifact store.** The r3-draft's "genuinely new public,
unauthenticated, expiring viewer origin" is therefore **out of v1 scope**; the
analysis below is retained because it documents why that surface was thought
necessary (it assumed a recipient with no account) and what still applies
(snapshot-on-publish for quotes, PDF rendering, WhatsApp document-message
delivery).

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
the destination**. *(r3-draft conclusion: "a WhatsApp recipient has no account,
AR1 is not our answer" — now inverted by §4.1: the recipient DOES have an
account, so the authenticated share-resource seam IS the answer.)*

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

### 6.4 Channel as a first-class typed session property [GENERIC — see §0.5.2]

**This is the generic `originChannel` mechanism (§0.5.2), described here in its
original WhatsApp framing.** Sessions carry a **typed channel identity**:
`originChannel: 'whatsapp'` for channel-originated sessions, `'web'` as the
default for everything existing; future channels (slack, email, excel) reuse the
same field rather than adding new mechanisms. This is a session property in the
shared session schema, not channel-local metadata. All three behaviors below are
driven by looking up `registry[session.originChannel]` — the descriptor — not by
branching on a channel name:

1. **Badge** — the workspace session list shows a channel badge on
   channel-originated sessions.
2. **Filter** — the session list is filterable by channel.
3. **Dialect shaping** — the §3-shaping dialect (WhatsApp markdown, 4096
   chunking) is selected per session from this property, not hardcoded per
   deployment.

**Binding schema linkage, made explicit:** the `ChannelBindingStore` row links
`(channel, conversationKey)` → `(workspaceId, sessionKey)` — where
`conversationKey` is the opaque adapter-owned key (§0.5.5) — and the session that the
binding creates (via the CAS create-race machine, §1.2b) is created **with**
`channel: 'whatsapp'` set. The binding's `channel` column and the session's
`channel` property are the same typed value — the binding is the addressing map
(two-handles rule, §1.2c); the session property is the identity the workspace
UI and the dialect shaper read. Slice 1a delivers both.

### 6.5 Reopen-in-workspace — v1 READ-ONLY [GENERIC descriptor property — see §0.5.4]

**Read-only-in-workspace is the descriptor field `sessionsReadOnlyInWorkspace`
(§0.5.1), not WhatsApp UI code.** A channel-originated session **appears in the
customer's workspace session list** (channel-badged from `descriptor.icon`,
filterable per §6.4) and, when its descriptor has
`sessionsReadOnlyInWorkspace: true` (WhatsApp does), **opens as a read-only
transcript** using the existing read-only session idiom: full observability —
WA inbounds as user turns, agent replies, tool runs — with **no send path from
the workspace in v1**. The only workspace-side interaction is answering
approval intentions via the Inbox (already planned, §6.1).

This cuts the reopen requirement to **near-zero new UI**: the transcript
renderer, session list, and read-only idiom all exist; slice 7 adds only the
descriptor-driven badge/filter surfacing and the read-only gating for sessions
whose descriptor sets `sessionsReadOnlyInWorkspace` (WhatsApp is the first such
descriptor; the gate is `descriptor.sessionsReadOnlyInWorkspace`, not
`channel === 'whatsapp'`).

**Read-only is a per-deployment POLICY default, not channel nature (C1).** WhatsApp
reopen is read-only in v1 because of the 24h-window/send-path asymmetry and the
deferral of two-way takeover to v2 — not because a channel is intrinsically
read-only. `sessionsReadOnlyInWorkspace` is a descriptor **default** a deployment
can flip (a Slack channel with two-way reply is entirely plausible in v2). The
plan states this as policy so the descriptor field is not mistaken for an
intrinsic property.

**Two-way human-takeover is v2** (slice 8). Its ready-made design sheet — the
previously-flagged questions, parked not discarded:

- **24h-window behavior:** the send API itself is symmetric (a human-typed
  outbound uses the same send path and the same §7.1 window check/template
  fallback as agent output); specify exact behavior inside vs outside the
  window.
- **Visible labeling:** human-typed messages are visibly distinguished from
  agent output on both ends.
- **Takeover semantics:** recommend the agent **yields while a human is
  active** and **resumes on explicit handback**, not on a timer.

### 6.6 Onboarding & identity [WA-SPECIFIC]

#### Pilot (v1): provisioned bindings — NO identity build

Under the pilot posture (§0.7), **identity is not built in v1.** A customer's
number is provisioned during onboarding and bound to their pre-created
workspace/session; an unknown inbound is fail-closed. There is no account
minting, no phone-as-identity, no magic-link-over-WhatsApp on the pilot path.
The customer's better-auth account already exists (created the normal way when we
onboard them); the binding row simply points the channel at that account's
workspace. **Everything below this line is Phase 2, not pilot.**

---

#### Phase 2: open self-serve WhatsApp signup — REAL WORK, honestly scoped

This is the WhatsApp consumer exercising the "can originate identity" capability
(§0.5.3). It is **off the pilot critical path.** When built, WhatsApp's
descriptor `canOriginateIdentity` gate is opened. It is **not** "extend
better-auth with a config line" — the review verified against the code that
phone-first identity is genuinely new work. Scoped here so it is not
under-estimated later.

**The intended model (Phase 2).** The phone number becomes the account identity:
a first inbound from an unknown number is **SIGNUP** — account + workspace +
default agent, keyed to the number, onboarded conversationally in the thread
(no email, no password, no web form). One Seneca number, multi-tenant by sender
(§4, §7.3). This needs **no Embedded Signup / per-customer OAuth** (those exist
only to send as a *customer's own* number; here the user texts OUR number).

**Why this is real work, not a config line (corrected against code,
2026-08-11).** The r4 draft claimed phone identity is "provider #4, a config line
at ~L151" and "just a magic-link delivery adapter". **Both are false**:

- **better-auth's magic-link is EMAIL-KEYED.** `createAuth.ts:127`:
  `magicLink({ sendMagicLink: async (data: { email; url; token }) => … })`;
  issuance is `signIn.magicLink(email)`. A phone-only user **has no email to key
  the token to**, so the existing magic-link path **cannot be invoked for the
  exact users it is meant for**. Wiring `sendMagicLink` to deliver over WhatsApp
  does not create a phone-keyed identity — it only changes the delivery channel
  of an already-email-keyed token.
- **The magic-link plugin only mounts WITH a mail transport.**
  `createAuth.ts:125`: `transport ? [magicLink(...)] : []`. A WhatsApp-first
  deployment with no SMTP has **no magic-link machinery at all**. And
  `capabilities.ts:74` gates the capability on `emailVerificationEnabled` —
  coupling it to email policy.
- **`phoneNumber` plugin is NOT installed** (no grep hit) and there is no phone
  entry in `socialProviders`. Phone-first identity requires **either** adding
  better-auth's `phoneNumber` plugin + a phone-keyed token/session path, **or** a
  custom identity path. Both are real code.
- **better-auth users require an email.** Phone-only account creation must
  **fabricate a placeholder email** (a `getTempEmail(phone)` pattern) or change
  the schema — with its own collision/linking mess. The r4 draft never named
  this; it is a required Phase-2 work item.

So Phase 2's phone-identity build = { pick phoneNumber-plugin **or** custom path;
solve the placeholder-email problem; add a phone-keyed verification-token mint +
redeem + session-establishment route if not using the plugin }. Token
mint/redeem is **not** "already done" for phone users.

- **Auth factor = control of the WhatsApp number**, proven by messaging from it
  (channel-as-verifier) — this remains a genuine advantage, but it feeds a
  *custom* phone-identity path, not the email-keyed magic-link plugin.
- **Contrast with email-based signup (#1165 signup-domain hook).** That path
  keys identity on a verified email domain and works today. Phone-first does not
  work today.

**Web workspace access = magic link over WhatsApp (Phase 2).** Once a phone user
has a placeholder or real email on their account, the existing magic-link token
can be delivered over WhatsApp. When the user needs the full web UI:

- the bot sends a **one-time, short-TTL (minutes), signed** login link bound to
  their phone-account; tapping it establishes a web session (cookie,
  remember-me);
- **reverse path:** the web login page offers "get login link on WhatsApp" →
  user enters their number → link is sent to that WhatsApp thread;
- **phone OTP is the documented fallback**, but magic-link-over-WhatsApp is the
  **primary** path — lower friction, because the user is already in WhatsApp.

**[UNVERIFIED — load-bearing] OTP templates skip the 24h window.** The claim
that Meta's **authentication-category** templates (OTP) are window-independent
underpins the entire reverse "get login link/code on WhatsApp" path for cold
numbers. The research file (`references/whatsapp-auth-billing-research.md` §1)
marks only the *pricing* as unverified; **the window-independence itself carries
no primary Meta-docs citation** and is load-bearing. If wrong, the reverse flow
is impossible for a number that has never messaged us. **A primary Meta
documentation citation is a required gate before any Phase-2 reverse-flow build.**
If verified: use the **copy-code** button type and a **10-minute TTL** (matching
better-auth's token expiry, §7.5). The channel-as-verifier path (first inbound
proves possession) stays the zero-template primary; OTP is the fallback.

**SMS fallback during the WABA ramp** (research §2). A newly-verified number is
capped at ~2,000 business-initiated conversations/day until the quality tier
climbs. If a WhatsApp auth send is throttled or the number is not on WhatsApp,
fall back to an SMS OTP through a CH/EU SMS provider — **auth-path only**, never
for agent conversation content. Tracked in the billing/ramp note (§7.6), out of
v1 build scope unless the pilot hits the cap.

**SMS fallback during the WABA ramp** (research §2). A newly-verified number is
capped at ~2,000 business-initiated conversations/day until the quality tier
climbs (**[UNVERIFIED]** — the ~2,000 figure drives SMS-fallback scope and needs
a Meta-docs citation). SMS OTP through a CH/EU provider is **auth-path only**,
never conversation content. Phase-2 scope, tracked in §7.6.

**boring-ui fit — what already exists vs. what is NEW (corrected 2026-08-11).**
Verified against code. The r4 draft's "extends better-auth; does not build auth"
framing was **wrong for phone-first users**; here is the honest split:

- **What DOES exist (usable as-is for EMAIL-keyed users):** `socialProviders`
  (GitHub, Google) + `emailAndPassword` in `createAuth.ts`; the `magicLink`
  plugin (`createAuth.ts:127`), its schema (`schema-config.ts`), front client
  (`authClient.ts`), and capability flag (`capabilities.ts:74`). For a user who
  **has an email**, magic-link token mint/redeem/session is done and we only
  choose the delivery channel (email today; WhatsApp is a delivery swap).
- **What is NEW Phase-2 work (phone-first users have NO email):**
  - a **phone identity path** — either better-auth's `phoneNumber` plugin (NOT
    installed) wired in, or a custom phone-keyed verification-token +
    session-establishment route;
  - the **placeholder-email problem** — better-auth users require an email;
    phone-only creation must fabricate one (`getTempEmail(phone)`) or change the
    schema. Named and owned, not hand-waved;
  - **`accountLinking` is NOT configured** (`grep accountLinking
    packages/core/src` → zero hits). Enabling it is real config **and** it
    matches on a shared verified **email** — a phone-first user has no email to
    match on, so "add email later" is **not** accountLinking's native flow; it is
    "add a credential to an already-authenticated user", a different path.
- **The magic-link-over-WhatsApp DELIVERY swap is genuinely small** — but it is
  only reachable **after** a phone user has an email on their account (real or
  placeholder). It is not the identity mechanism; it is the delivery of an
  already-email-keyed token.

**External reference (getnao/nao study, `references/getnao-auth-study.md`).**
nao runs better-auth with the internal-id + `account(providerId → userId)` model
and enables `accountLinking`. It confirms the one-user/N-identities *shape* is
standard — but note nao's linking is **email-anchored**, so it validates Flow A
(web-first, has email), **not** the phone-first placeholder-email problem, which
nao does not solve.

#### Two complementary identity flows (Phase 2)

Entry from **either door**, both converging on ONE better-auth account:

**Flow A — web-first → link WhatsApp (nao's linking-code pattern).** An
already-authenticated *web* user (already has an email) gets a short regenerable
**linking code**, opens WhatsApp and sends `/login <code>`; the backend links
`whatsappUserId → userId`. This needs `accountLinking` **enabled** (currently not
— real config) and is the cleaner flow because the user already has an
email-anchored account.

**Flow B — WhatsApp-first signup → magic-link web (NEW build, the hard one).**
First inbound from a new number creates the account (custom phone path +
placeholder email, above); when the user needs the web UI, deliver a magic link
over WhatsApp. Security shape:

- **Web-session link uses better-auth's single-use `verification(identifier,
  value, expiresAt)` token** — short TTL, single-use, as password-reset does.
- **Never reuse a reusable linking code as a session credential** — that is a
  session-token bug. Sessions go through the single-use token.

Flow B is the trades/SMB path; Flow A serves web-first products. **Both are
Phase 2.**

#### Progressive email — the identity trust-ladder (Phase 2)

**Do not require email at WhatsApp signup** — phone-only, then collect email
**progressively in-conversation** at value moments; effectively required at first
payment (invoices / Swiss business records). Email + phone then sit as linked
identities on one account. **This depends on the Phase-2 phone-identity build +
`accountLinking` being configured + the placeholder-email problem being solved**
— it is **not** free ("no migration" was overstated: enabling accountLinking and
reconciling the fabricated placeholder email against a real email later is real
work). Email's roles: recovery (number-recycling, §7.3 item 3), billing,
cross-channel notices.

#### Account convergence, dedup & MERGE — Phase 2, unspecified/hard

**The pilot does not need this** — a provisioned binding points at one existing
account, so there is no second-door collision to merge (R4). It is documented
here as Phase-2 work and honestly flagged as **hard and unspecified**:

- **Invariant (intended):** one better-auth user, N linked identities, reachable
  via either door.
- **Link-into-current-session** where the user is already authenticated (needs
  `accountLinking` enabled) avoids the collision by construction.
- **The merge case is NOT specified and there is no primitive for it.**
  better-auth has **no account-merge primitive**. Two independently-created
  accounts (phone Monday, email later) are two **workspaces** (each got one at
  post-signup), two session sets, two settings, eventually two billing records —
  the repo's own `deleteUserCompletely.ts` shows how entangled a user is.
  **Unanswered, required before any merge build:** which account survives? what
  happens to the loser's workspace and its agent sessions? audit trail? Until
  answered, "v1 claim/merge" is a label, not a design. **Demoted to Phase 2;** if
  a lightweight interim is needed, it is "detect collision + block second signup
  + support-assisted merge", stated as such — **not** an automated merge.

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
- Mitigations: the fail-closed unknown-sender policy (r2.1 §2 / §0.7,
  rate-limited to once per sender — an unrate-limited auto-reply is itself a
  ban risk), an explicit opt-out keyword (STOP) honoured before any agent
  invocation, and monitoring of the quality rating as an operational alert.

**Pilot avoids the account-minting abuse surface entirely.** Because the pilot is
provisioned-bindings/fail-closed (§0.7), an unknown sender gets a rate-limited
rejection and **nothing is minted** — no account, no workspace, no free LLM
turns. The rate-limit above covers exactly the polite-rejection auto-reply.

**Phase-2 abuse controls — REQUIRED before open signup ships (R5).** Open
self-serve WhatsApp signup (§6.6 Phase 2) turns the Seneca number into a surface
where **anyone of ~2B WhatsApp numbers** can mint a better-auth account +
workspace + default agent + LLM turns, unauthenticated and free. The §7.2
rate-limit above does **not** cover account-minting velocity. Before Phase-2
signup is built, this section must gain: **per-number and GLOBAL signup caps**,
**disposable/virtual-number-farm detection**, **cost caps on unpaid signup
workspaces** (LLM-turn budget per un-converted account), and **signup-velocity
alerting**. This is a required security section for Phase 2, not a v2 note — and
it is one of the reasons the pilot deliberately stays fail-closed.

### 7.3 One-number multi-tenant identity limits

The owner's pilot ruling has consequences worth stating rather than discovering:

1. **A phone number is the only identity we get.** No email, no verified name.
   The binding table is the entire trust decision, and it is explicitly
   provisioned (r2.1: "Bindings provisioned explicitly (CLI/admin op in v1)").
   Someone who knows the number and is not provisioned gets the polite rejection.
2. **One person = one binding = one session.** A user who works with two tenants
   from one phone cannot be disambiguated. v1 accepts this; the binding is
   `(channel, conversationKey, agentTypeId)` (opaque key, §0.5.5) and the pilot
   must not assign one human to two tenants.
3. **Number loss / SIM reuse.** A recycled number silently inherits a binding.
   Bindings need an expiry/re-confirmation policy; v1 mitigates with revocable
   status and the age alert from r2.1 open question 5.
4. ~~Tenant separation is per-session inside one workspace scope~~ **Resolved
   by the 2026-08-11 routing ruling:** bindings target each customer's own
   signup workspace, so tenant separation is **per-workspace** (§4.2). The
   former pilot limitation no longer exists.
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
| Any candidate library drags in a bot framework's state/dedupe model | RESOLVED (§2.3): build a thin in-house adapter (~600–750 LOC), seed the edge from `@flue/whatsapp`, port correctness from hermes-agent; reject `@chat-adapter/whatsapp` (runtime coupling + `node:crypto`/`Buffer`) |

### 7.5 Magic-link web-auth security (owner addition, 2026-08-11)

The magic-link (§6.6) is a **bearer token** — whoever holds the URL can
establish the web session. It is **better-auth's magic-link token** (already
wired, §6.6), so short-TTL and one-time-use are existing plugin behavior, not
new code — we only choose the delivery channel. WhatsApp threads are
forwardable, so keep the link hardened accordingly:

- **Short TTL** — better-auth's magic link is minted at 10-minute expiry
  (`createAuth.ts`); keep it minutes, not hours.
- **One-time-use** — better-auth consumes the token on first successful
  exchange; a second tap fails closed.
- **Optional device/IP binding** — bind the token to the requesting device/IP
  where feasible, so a forwarded link opened elsewhere is rejected.
- **The auth basis is WhatsApp-as-possession-factor** — control of the number
  is what authorizes minting the link in the first place; the link is a
  short-lived hand-off of that already-proven possession, not an independent
  credential. Phone OTP is the documented fallback with the same possession
  basis.

### 7.6 Billing & WABA ramp [WA-SPECIFIC] (owner addition, 2026-08-11; research-grounded)

Billing is **not v1 build scope** — it is captured here so the identity
trust-ladder (§6.6 progressive email) has a defined destination and the pilot
does not discover these constraints late. Grounded in
`references/whatsapp-auth-billing-research.md` §2–§3.

- **Stripe Checkout at first payment.** Do not collect card details at signup.
  The first-payment value moment (the same moment email becomes effectively
  required, §6.6 ladder) triggers a **Stripe Checkout** session, which collects
  the billing email and — for business customers — the **VAT/UID** number. This
  keeps signup zero-friction and defers PII to when the customer chooses to pay.
- **Swiss QR-bill is mandatory for CH invoicing.** Swiss invoices must carry a
  **QR-bill** (standardized payment slip). Use the **`swissqrbill`** library;
  it embeds the QR-IBAN, creditor reference, and amount.
- **Swiss VAT = 8.1%** (standard rate, 2024+); invoices display the **UID**
  (`CHE-###.###.###`, VAT-registered form). Stripe Tax / Checkout collects and
  validates the VAT number at payment.
- **Two data paths, kept separate.** Stripe is a US processor, acceptable for
  payment PII the customer knowingly enters into a payment form — **distinct from
  WhatsApp message content**, which stays CH/EU-side under the no-US-data-path
  posture (§2.4, §6.3). The step-0 privacy policy states both paths.
- **WABA messaging ramp** (research §2): the ~2,000 business-initiated
  conversations/day cap on a fresh number, with the SMS-fallback mitigation for
  the auth path (§6.6). Template messages are conversation-billed (§7.1); an
  auth/OTP-heavy or out-of-window-chatty deployment is a cost line, not just UX.

**Out of v1 build scope** (listed in §11): invoice generation, Stripe wiring, the
QR-bill renderer, and SMS-provider integration. This note fixes the target shape
so Phase-2 progressive-email collection (§6.6) lands on the right ladder.

---

## 8. Slices

**Pilot pipeline:** `1a-i → 1a-ii → 1a-iii → 1b → {3, 4, 5, 7} → 6`; slices
3/4/5/7 are parallel after 1b. **Slice 1c (identity) is Phase 2**, off the pilot
critical path. Slice 8 is **v2**.

**No signup on the pilot path.** Under the provisioned-bindings posture (§0.7),
the pilot has **no account creation from inbound** — bindings are provisioned
during onboarding to pre-created workspaces, and an unknown sender is fail-closed.
So the pilot needs **no identity slice**; the binding row already targets an
existing `workspaceId`. The old "slice 1c sits between 1a and 1b" sequencing is
removed — it welded identity onto the outbound path as a hard prerequisite (C5),
which only existed because of the open-signup ruling that §0.7 reverses.

**Slice 1a is split into three PRs (C4).** The r4 monolithic 1a was three PRs in
a trenchcoat (registry + descriptors + binding store + CAS create-race +
DrainCoordinator + webhook core + CLI + boot assertion). Split:

- **Slice 1a-i — `DrainCoordinator` + `followUp` fix (§1.2a).** Touches
  `HarnessPiChatService` turn phases; **failing test first**. Zero WhatsApp
  dependency. Lands standalone.
- **Slice 1a-ii — channel registry + `ChannelDescriptor` + `originChannel`.** The
  registry (§0.5.1) with `'web'` and `'whatsapp'` descriptors, the typed
  `originChannel` session property (`'web'` default), set at session create. **Zero
  WhatsApp/binding dependency — the registry lands FIRST, standalone**, answering
  "does the registry need to exist before any consumer": yes.
- **Slice 1a-iii — binding store + inbound path.** `ChannelBindingStore` (opaque
  `conversationKey`, §0.5.5; dedupe-row + queue insert in one sqlite transaction;
  owner-token CAS create-race), the explicit `workspaceId` binding column,
  fail-closed unknown-sender policy (§0.7), inbound park policy, async-ack webhook
  core, trusted-caller seam, provisioning CLI op, flag plumbing + durable-stream
  boot assertion (§4.3), fake-channel inbound tests.

**Delta from the rulings:** binding rows gain `workspaceId` and an **opaque
conversationKey**; **slice 1c demoted to Phase 2**; slice 2 retargeted to the app
host; slice 4 **shrinks**; slice 7 (read-only reopen) is new; slice 8 (two-way
takeover) is new and v2.

### Slice 1a-i — DrainCoordinator + followUp fix
**Delivers:** the `DrainCoordinator` + `followUp` stranding fix (§1.2a) in
`HarnessPiChatService` turn phases. **Failing test first.** No WhatsApp/channel
dependency — pure turn-phase correctness.
**Blocked by:** none.
**Proof:** three rapid inbounds mid-turn all reach the agent in order — the
`followUp` regression test, red before the fix, green after.

### Slice 1a-ii — channel registry + descriptor + originChannel (registry lands FIRST)
**Delivers:** the **channel registry + `ChannelDescriptor`** (§0.5.1, rendering-only
contract with `canOriginateIdentity` and open-ended `dialect`) with the `'web'`
(canOriginateIdentity **true**) and `'whatsapp'` descriptors registered; the typed
**`originChannel`** session property with `'web'` default (§0.5.2/§6.4), set at
session create. **Zero WhatsApp/binding dependency — this is the generic mechanism
landing standalone, ahead of any consumer.**
**Blocked by:** none.
**Proof:** the registry resolves a descriptor by `originChannel`; a session created
with no channel defaults to `'web'`; descriptor lookup drives badge/read-only/dialect
with no code branching on a hardcoded channel name; flag off → byte-identical host.

### Slice 1a-iii — binding store + inbound path (fail-closed)
**Delivers:** `ChannelAdapter` contract; `ChannelBindingStore` keyed by the
**opaque adapter-owned `conversationKey`** (§0.5.5) with the explicit
`workspaceId` column (bindings + durable dedupe + inbound queue, **dedupe-row and
queue insert in one sqlite transaction**, owner-token CAS create-race machine);
**fail-closed unknown-sender policy** (§0.7 — no session, no minting); inbound
park policy; async-ack webhook core; trusted-caller seam with guardrails;
provisioning CLI op; flag plumbing + the durable-stream boot assertion (§4.3);
fake-channel inbound tests.
**Blocked by:** 1a-i, 1a-ii — substrate proven in §5.
**Proof:** replayed `providerMessageId` (including across a restart) produces
exactly one turn; a crash between dedupe insert and queue insert loses nothing
(crash-tested); **unknown/un-provisioned sender fail-closed with a stable code
and no session, no account** (§0.7); a provisioned binding resolves to its
existing `workspaceId`; flag off → byte-identical host.

### Slice 1c — phone identity + open WhatsApp signup [PHASE 2 — NOT pilot]
**Not on the pilot critical path.** The pilot uses provisioned bindings (§0.7),
so this slice is **deferred to Phase 2** and is genuinely new auth work, not a
config line (§6.6, corrected against code). It ships only when open self-serve
WhatsApp signup is greenlit, and it is **gated on**: the Phase-2 abuse controls
(§7.2 Phase 2) landing first, and the `[UNVERIFIED]` OTP-window claim (§6.6)
getting a primary Meta citation. Scope when built:
1. **A phone-identity path** — better-auth's `phoneNumber` plugin (NOT installed)
   wired in, **or** a custom phone-keyed verification-token + session route.
2. **The placeholder-email problem solved** — better-auth users require an email;
   phone-only creation fabricates one (`getTempEmail(phone)`) or changes schema.
3. **`accountLinking` enabled + configured** (currently zero config) for Flow A.
4. **Magic-link-over-WhatsApp delivery swap** — reachable only after a phone user
   has an email on their account; delivers the existing single-use token.
5. **Open-signup path** — first inbound from an unknown number mints identity +
   workspace (opening the `canOriginateIdentity` gate), under the §7.2 Phase-2
   caps.
**Merge flow is separately Phase 2 and unspecified/hard** (§6.6 — no better-auth
merge primitive; workspace-disposition/survivor rules unanswered). **Blocked by:**
the whole pilot shipping first, plus its own gates above.
**Proof (when built):** deferred — specified at Phase-2 planning, not v1.

### Slice 1b — durable tail, turn assembly, outbound
**Delivers:** the exported stream-path resolver on the pi-chat service; the
per-binding tail worker (subscribe-then-read-until-`upToDate`, cursor CAS);
terminal-event turn assembler (`agent-end` → render; error/aborted → failure
notice; stall timeout → notice + park); markdown→dialect shaping with 4096
chunking and fence reopen; send-failure/park policy; gone-session recovery;
**the 24h-window check and template fallback (§7.1)**; full fake-channel
conformance suite.
**Blocked by:** 1a-iii. **Risk centre — own review budget** (turn assembly).
**Proof:** conformance loop green in CI surviving graceful restart mid-conversation
with cursor resume and zero duplicate sends; on hard crash between send and CAS,
a duplicate is possible and asserted **not to be loss**; error/aborted/stalled
turns always produce a notice, never silence; a permanently unsendable message
parks without wedging the binding; a reply attempted outside a simulated 24h
window sends the template and delivers the held content after the window
reopens.

### Slice 2 — deployment shape (retargeted 2026-08-11)
**Delivers:** the channel core mounted on the **app host** (§4.1) — wiring into
the deployed workspace host's composition, binding-resolved `workspaceId`
routing, `BORING_AGENT_SESSION_ROOT` on the durable volume,
`BORING_CHAT_DURABLE_STREAM=1`, credentials via `server/credentials/`, public
HTTPS webhook endpoint answering the `hub.challenge` handshake (unblocks step
0.1's endpoint verification).
**Blocked by:** 1a-iii. **Proof:** the §5 substrate loop reproduced against the
deployed app host into a real customer workspace session; Meta's webhook
verification succeeds against the public URL.

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

### Slice 4 — artifact drop (SHRUNK 2026-08-11): share-resource links + PDF
**Delivers:** artifact drop via the **existing share-resource seam** (§6.2) —
links to workspace files rendered by the product's own viewers, opened by the
authenticated workspace member the binding maps to. **Dropped from v1:** the
channel-side `ShareEntryStore` durability work, the new public unauthenticated
viewer origin, and the expiry/revocation link machinery — the recipient has an
account, so authenticated links suffice. **Retained:** snapshot-on-publish for
quotes (a later workspace edit must not change what a client was quoted);
HTML→PDF rendering (headless Chromium, CH-trades lane owns the template);
WhatsApp document-message send of the PDF alongside the link.
**Blocked by:** 1b. Coordinates with the CH-trades lane for the quote template.
**Proof:** a quote artifact produces a workspace share link that opens in the
product viewer for the bound customer; the sent PDF is the snapshot, unchanged
by a later workspace edit; no workspace path or capability secret appears in
the URL or the document filename.

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

### Slice 6 — WhatsApp provider edge (Meta Cloud API) — BUILD THIN (bake-off RESOLVED 2026-08-11)
**Verdict (was "evaluate 3 candidates"):** the bake-off ran and resolved to
**build a thin in-house Cloud API adapter (~600–750 LOC)** seeded from two
sources, **not** adopt any candidate wholesale. Full analysis in §2.3/§2.5.

**Today (bake-off result):**
- `@chat-adapter/whatsapp` (Vercel Chat SDK, MIT) is **REJECTED** — reasons all
  architectural, none about quality (it is in fact the most actively maintained
  candidate). It is an adapter to Vercel's `chat` **runtime** (the
  Thread/`onNewMention` conversation model), not a standalone Cloud client, so
  adopting it means adopting that thread-ownership model — a direct collision
  with the ratified **"pi owns the conversation brain"** decision (the pi-native
  cutover already rejected `useChat`-style thread ownership). It also uses
  `node:crypto` + `Buffer`, violating shared invariants #1/#2, and its most
  "mature" features (24h-window awareness, threading) are exactly the logic
  **our plan deliberately owns** — pure coupling cost for behavior we override.
- `@flue/whatsapp` (Apache-2.0, ~430 LOC) provides **only the inbound webhook /
  signature edge** (~250 reusable LOC) — Web-Crypto based (**no `node:*`, no
  `Buffer`**, workerd-safe), matching `src/shared` invariants #1/#2 near
  drop-in. It has **no** outbound send, media, templates, or interactive.
- hermes-agent's `whatsapp_cloud.py` (MIT, Python, ~2,100 LOC) is the **most
  complete Cloud API correctness reference** but not importable — value is as a
  port source and correctness oracle (it ships conformance test vectors).

**Delta — what slice 6 now builds:** `packages/channels/whatsapp` behind the
contract, hand-built in TypeScript against `@whatsapp-cloudapi/types`:
- **Seed the inbound webhook/signature edge from `@flue/whatsapp`** (Apache-2.0,
  keep the NOTICE attribution) — `x-hub-signature-256` HMAC via Web Crypto,
  `hub.verify_token` constant-time compare, `hub.challenge` handshake,
  body-limit + envelope guard.
- **Port the Cloud API correctness logic + conformance test vectors from
  hermes-agent's `whatsapp_cloud.py`** (MIT, Python→TS): wamid dedup, the
  24h-window / template-fallback shape, media upload + 2-step download with
  per-type Meta size caps, markdown→WhatsApp formatting, text batching. Its
  `tests/conformance/vectors/whatsapp.json` becomes our test oracle.
- Write our own ~250 LOC of Graph-API send + media helpers.
- Reliability-critical state (binding dedup, cursor semantics, turn assembly,
  the authoritative 24h-window enforcement) stays in **our** plan (slices
  1a/1b), never in the adapter — this is why no candidate's bot-framework
  state/dedupe model is adopted.
**Blocked by:** 1b for the contract; **step 0** for the live demo only. The
build feeds 1a/1b (it realizes the `ChannelAdapter` provider edge they define).
**Proof:** ported conformance vectors green for verify/parse/chunk/template/
media; no `node:*` or `Buffer` in the package (invariant guard); live demo
against the Seneca number — a multi-message conversation spanning a server
restart, with one approval answered in WhatsApp and one quote PDF delivered.

### Slice 7 — read-only reopen in workspace (new, 2026-08-11)
**Delivers:** §6.5/§0.5.4 — **descriptor-driven** session-pane rendering: channel
icon badge + channel filter read from `registry[session.originChannel]` (§6.4),
no per-channel UI code; sessions whose descriptor sets
`sessionsReadOnlyInWorkspace` (WhatsApp is the first) open as **read-only**
transcripts via the existing read-only session idiom (send path gated on
`descriptor.sessionsReadOnlyInWorkspace`, not a channel-name check); full
transcript renders (WA inbounds as user turns, agent replies, tool runs).
Near-zero new UI by owner design. This slice delivers the generic mechanism's
pane rendering with WhatsApp as its first descriptor.
**Blocked by:** 1b (needs the channel property + real transcripts). Parallel
with 3/4/5.
**Proof:** a WA session appears badged in the customer's session list, filters
by channel, opens read-only with the full transcript; the composer is absent/
disabled with no send route reachable (guard test); Inbox approvals for that
session still work (§6.1).

### Slice 8 (v2) — two-way human-takeover
**Not v1.** Typing into a channel session from the workspace delivers to the
WhatsApp counterpart — human-takeover as a feature. Carries §6.5's design sheet
as its input: symmetric send path with §7.1 window/template handling, visible
labeling of human vs agent messages on both ends, agent yields on takeover and
resumes on explicit handback. Scoped and sequenced when v1 has shipped.

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

1. **Placement split (§3.2)** — **RESOLVED 2026-08-11**: the owner's routing
   ruling states "Channel CORE placement in packages/agent stands unchanged
   (host-agnostic)". Core in `packages/agent/src/server/channels/`, provider
   edge in `packages/channels/whatsapp`; DECISIONS.md decision 3 is narrowed
   accordingly on merge.
2. **Transcription provider (§6.3)**: self-hosted Whisper (recommended) vs
   Infomaniak, pending confirmation that Infomaniak offers speech-to-text. Names
   a sub-processor in the step-0 privacy policy, so it must be decided before
   step 0 is submitted.
3. ~~Share-link expiry default~~ — **MOOT 2026-08-11**: the public expiring
   bearer link is out of v1 (§6.2 shrink); share-resource links are
   authenticated workspace links with no bearer-expiry question.
4. **Approver identity (§7.3 item 5)**: confirm `approverExternalId` per tenant
   is the right v1 model for "owner approves in WhatsApp".
5. **Slice 3 sequencing**: confirm slice 3 waits for `fix/786`, and that slices
   1/2/4/5 shipping without in-channel approval (deferral message meanwhile) is
   an acceptable intermediate state.
6. **Governance**: this plan reverses the 2026-08-08 deprioritization in
   `docs/direction/STATE.md`. That file needs updating on approval.

## 11. Out of scope

**Open self-serve WhatsApp signup + phone-first identity + account merge** —
these are **Phase 2**, not v1 (§0.7, §6.6, slice 1c). The pilot uses provisioned
bindings (fail-closed); it mints no identity, so it needs no phone-keyed
better-auth path, no placeholder-email handling, no `accountLinking` config, no
merge flow, and no account-minting abuse controls. All of that is real,
honestly-sized Phase-2 work, gated on the §7.2 Phase-2 caps and a primary
Meta-docs citation for the OTP-window claim.

**Any future consumer's implementation** — Slack, email, and pi-excel channels
are **registry-ready future consumers, noted only** (§0.6); this plan builds
**zero** of them (the mechanism proves generic without them, and
`demo/pi-excel-coupling` already demos the coupling). Also out: SMS as a
conversation channel (SMS appears only as the auth-OTP fallback, §6.6/§7.6);
group chats; per-agent grant policy (#1087); proactive outreach beyond the single
fallback template; multi-agent routing per sender; horizontal adapter scale-out;
**billing build-out** (Stripe Checkout wiring, invoice/QR-bill generation, VAT
handling, SMS-provider integration — §7.6 fixes the target shape only);
billing/metering of channel traffic; two-way human-takeover from the workspace
(v2, slice 8); the standalone headless-tier deployment (§4.2); model-readable
inbound PDFs (§6.3); per-customer Embedded Signup /
replies-on-customer's-own-number (§0, §6.6 — separate future capability); the
CH-trades product surface (separate lane).
