---
issue: 1127
kind: decision-memo
updated: 2026-08-07
question: Reuse the Cloudflare Agents framework's channel integrations for external
  channels instead of building plan r2's adapter ourselves — including the owner's
  reframed variant, vendoring the OSS channel-adapter code self-hosted on our VPS?
---

# gh-1127 — Cloudflare channels reuse assessment

Research date 2026-08-07 (web research + repo grounding against plan r2).

## TL;DR

**The channel adapters the owner remembers are not Cloudflare's — they are
Vercel's.** cloudflare/agents delegates all messenger I/O to Vercel's Chat SDK
(`vercel/chat`, MIT). Cloudflare's own channel catalog has **no WhatsApp and no
SMS**. Cloudflare's `Agent` runtime is hard-coupled to Durable Objects/workerd
and is not sanely self-hostable on a Node VPS. But **`@chat-adapter/whatsapp`
(Vercel, MIT, Node >= 20, plain-Node)** is a real, substantive Meta Cloud API
adapter that covers most of plan r2's Slice 2.

**Recommendation: no to Cloudflare (cloud or vendored); yes-partially to
Vercel's adapter layer** — keep plan r2's backend core (slices 1a/1b)
unchanged, and evaluate `@chat-adapter/whatsapp` as the provider-edge
implementation inside Slice 2 behind our own `ChannelAdapter` contract.

## 1. What Cloudflare actually offers today (Aug 2026)

Docs "Communication channels" catalog is exactly five entries: **Chat, Voice,
Email, Slack, Webhooks**
([overview](https://developers.cloudflare.com/agents/communication-channels/)).

- **Email** — real: inbound Email Routing rule → Worker `onEmail()`; outbound
  `sendEmail()`/`replyToEmail()` via Cloudflare Email Service, **public beta**
  since 2026-04-16
  ([docs](https://developers.cloudflare.com/agents/communication-channels/email/),
  [blog](https://blog.cloudflare.com/email-service/)). Inbound routing GA/free.
- **Slack** — a documented recipe (Slack Events API → Worker → DO-per-workspace
  agent), not a managed connector
  ([docs](https://developers.cloudflare.com/agents/communication-channels/slack/)).
- **Voice** — `@cloudflare/voice`, browser-audio-to-DO, **Beta**; telephony
  only via a Twilio adapter
  ([docs](https://developers.cloudflare.com/agents/communication-channels/voice/)).
- **WhatsApp: not in the catalog. SMS: not in the catalog.** Bluntly: on
  Cloudflare you would build the Meta Cloud API webhook/send path yourself,
  exactly as on any VPS.
- Telegram/Discord/Teams/GChat appear only via the **Chat SDK integration**
  ([docs](https://developers.cloudflare.com/agents/runtime/communication/chat-sdk/)),
  i.e. Vercel's `chat` + `@chat-adapter/*` hosted inside an Agent DO.
- The [cloudflare-os blog](https://blog.cloudflare.com/cloudflare-os/) ships no
  messaging integrations; Slack-workspace talk there is roadmap language. The
  catalog is thinner than the marketing.

Programming model: `Agent` = Durable Object subclass — SQL-in-DO state
(`this.sql`), DO alarms, WebSocket hibernation, `cloudflare:workers` imports,
partyserver, wrangler bindings ([repo](https://github.com/cloudflare/agents),
MIT, very active, core `agents` pkg still 0.x).

## 2. The reframed option: vendor the OSS channel adapters self-hosted

**Finding: the adapter layer is `vercel/chat`, not Cloudflare code.**
Verified on npm 2026-08-07:

- Publisher Vercel, repo [vercel/chat](https://github.com/vercel/chat), MIT,
  `engines: node >= 20` — **plain-Node fetch-based libraries, no Workers
  dependency**. State backends pluggable (e.g. `@chat-adapter/state-redis`).
- Adapters at v4.37.0, lockstep active releases: slack (728k dl/wk), telegram
  (174k), whatsapp (73k), discord (78k), teams, gchat, twilio-SMS. Core `chat`
  pkg 2.08M dl/wk. Multi-maintainer, healthy — not an experiment.
- **`@chat-adapter/whatsapp`** ([README](https://github.com/vercel/chat/tree/main/packages/adapter-whatsapp),
  [changelog](https://vercel.com/changelog/chat-sdk-adds-whatsapp-adapter-support)):
  Meta WhatsApp Business Cloud API (Graph v25.0), `X-Hub-Signature-256` HMAC
  verify + `hub.verify_token` handshake, inbound parse (text/media/location/
  interactive), outbound send with **4,096-char auto-chunking**, **template
  sends** for outside-24h-window, buttons/lists, typing indicators. That is
  most of plan r2 Slice 2's checklist. Still ours: Meta business verification,
  number setup, template approval, and markdown→WhatsApp dialect rendering of
  *agent* output.

**Vendoring cloudflare/agents itself is a non-starter**: the runtime is
workerd-shaped (DO storage, alarms, hibernation); self-hosting means
workerd/miniflare with no durable-storage ops story off Cloudflare, plus 0.x
churn risk (docs rewritten June 2026, high commit velocity). The Cloudflare
value-add (durable agent identity, DO SQLite, hibernating sockets, scheduling)
is precisely the proprietary-runtime part — and we already have our own durable
substrate (`SqliteEventStreamStore` + `HarnessPiChatService`).

## 3. Architecture comparison

**(a) Plan r2 self-built (baseline).** Meta webhook → our host endpoint →
durable dedupe+queue (single sqlite txn) → per-binding drain → prompt/followUp
→ durable-store tail with CAS cursor → turn assembler → dialect render → Meta
send API. Everything in-process with `HarnessPiChatService`.

**(b) Vendored Vercel adapter at the edge (recommended variant).** Identical to
(a) except `ChannelAdapter.parseInbound` / `renderOutbound`-send are
implemented on top of `@chat-adapter/whatsapp` (verify, parse, chunked send,
template fallback) instead of hand-rolled Meta API code. Integration caveat to
spike in Slice 2: the adapters are designed for use inside the `chat`
framework's bot loop; we want the adapter package standalone behind our
contract, **not** their Redis-state bot framework (their state/dedupe model
would duplicate and fight our binding store and cursor semantics).

**(c) On-Cloudflare hybrid (comparison row only).** Worker terminates webhooks
at edge → HTTPS forward to VPS. Technically clean: CPU-time (not wall-clock)
billing makes proxying cheap (paid $5/mo; DO pricing
[here](https://developers.cloudflare.com/durable-objects/platform/pricing/));
Meta/Slack ack deadlines easily met. But since Cloudflare has no
WhatsApp-specific anything, the Worker contributes only edge presence — we'd
still write the same adapter code, plus a second deploy surface, plus US-entity
exposure (below). Only genuinely differentiated piece: free inbound Email
Routing → code, relevant to a later email channel at most.

## 4. What of plan r2 survives in every variant — claim verified

Verified against plan r2 (`docs/issues/1127/plan.md`) and the repo: streams are
keyed by composite sessionKey on our pi-chat service; the durable store,
replay-window limits, and the trusted-caller seam are all internal to our
backend. Therefore, **regardless of who terminates the webhook**:

- `ChannelBindingStore` (bindings, durable inbound dedupe + queue, park
  policies) — ours; no external framework knows our scopes/sessions.
- Trusted-caller seam minting `AuthorizedAgentScope` — ours by definition.
- Durable-store tail worker, CAS cursor, terminal-event turn assembly
  (agent-end/error/stall) — ours; it consumes our `SqliteEventStreamStore`
  and pi event semantics. No third party can supply this.
- Markdown→dialect shaping of agent turns and the ask_user deferral — ours
  (the Vercel adapter chunks and sends; it does not understand pi turns).

So slices 1a and 1b are invariant. Only Slice 2's provider-transport edge is
substitutable. The claim in the task framing holds.

## 5. Sovereignty, lock-in, cost

- **Self-hosted Vercel adapters**: MIT code from npm running on our EU VPS —
  no US infrastructure operator in the data path besides Meta itself (which
  WhatsApp implies in every variant). Sovereignty concern dissolved. Lock-in:
  a library dependency behind our own `ChannelAdapter` contract — flip-cost
  is Slice-2-sized. Churn risk: v4.x lockstep releases are frequent; pin +
  renovate.
- **On-Cloudflare**: Cloudflare Inc is US (CLOUD Act exposure regardless of
  data location). DO `jurisdiction("eu")` exists
  ([docs](https://developers.cloudflare.com/durable-objects/reference/data-location/))
  but Workers still execute globally, and the full Data Localization Suite is
  Enterprise-only ([DLS](https://www.cloudflare.com/data-localization/)).
  Incompatible with Seneca's "no US data path" positioning for message
  content. Cost is trivial ($5/mo class) — cost is not the discriminator.
- **Effort**: variant (b) saves the Meta-API plumbing of Slice 2 (verify,
  parse, chunked send, template call) — real but modest, since Slice 2 was
  the smallest slice; slices 1a/1b dominate effort in every variant.

## 6. Recommendation

1. **Do not adopt Cloudflare** — cloud or vendored. Its catalog has no
   WhatsApp/SMS; its runtime is not Node-portable; its jurisdiction conflicts
   with our positioning; its one unique asset (Email Routing) is out of scope
   for this epic.
2. **Keep plan r2 as written for slices 1a/1b** — the binding store, trusted
   seam, durable tail, and turn assembly are backend-invariant and have no
   OSS substitute.
3. **Amend Slice 2 with a bounded spike (half-day)**: attempt
   `@chat-adapter/whatsapp` standalone (no `chat` framework, no Redis) behind
   our `ChannelAdapter` contract for verify/parse/send/template. If it
   composes cleanly standalone, use it; if it drags in the framework's bot
   loop or state model, fall back to plan r2's hand-rolled Meta client. Either
   outcome keeps the conformance suite and acceptance criteria unchanged.
4. Answer to the owner's question — "reuse the OSS channels layer self-hosted,
   yes or no": **yes for the provider edge, via Vercel's `@chat-adapter/*`
   (which is what actually ships WhatsApp/Telegram); no for anything from
   Cloudflare's own code.**

## Sources

[CF communication channels](https://developers.cloudflare.com/agents/communication-channels/) ·
[email](https://developers.cloudflare.com/agents/communication-channels/email/) ·
[voice](https://developers.cloudflare.com/agents/communication-channels/voice/) ·
[slack](https://developers.cloudflare.com/agents/communication-channels/slack/) ·
[chat-sdk integration](https://developers.cloudflare.com/agents/runtime/communication/chat-sdk/) ·
[cloudflare/agents](https://github.com/cloudflare/agents) ·
[cloudflare-os blog](https://blog.cloudflare.com/cloudflare-os/) ·
[Email Service beta](https://blog.cloudflare.com/email-service/) ·
[Email pricing](https://developers.cloudflare.com/email-service/platform/pricing/) ·
[DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) ·
[DO data location / eu](https://developers.cloudflare.com/durable-objects/reference/data-location/) ·
[Data Localization Suite](https://www.cloudflare.com/data-localization/) ·
[vercel/chat](https://github.com/vercel/chat) ·
[WhatsApp adapter](https://github.com/vercel/chat/tree/main/packages/adapter-whatsapp) ·
[WhatsApp adapter changelog](https://vercel.com/changelog/chat-sdk-adds-whatsapp-adapter-support) ·
[Telegram adapter changelog](https://vercel.com/changelog/chat-sdk-adds-telegram-adapter-support) ·
npm registry metadata (versions/downloads/engines) queried 2026-08-07.
