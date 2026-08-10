---
github: https://github.com/hachej/boring-ui/issues/1210
issue: 1210
state: needs-owner-approval
updated: 2026-08-10
revision: r1
flag: BORING_AGENT_CHANNELS (reused, from gh-1127), plus BORING_MAIL_INGEST (new)
---

# gh-1210 — CH trades agent: WhatsApp + email-drafting vertical

Vertical product plan. Owner gate: nothing here is built until the owner
ratifies the MVP cut (§4), the pricing (§6), and the residency claims we are
willing to put in a contract (§5e, §7).

## Problem

Swiss SMB trades — fiduciaires/Treuhand, artisans/Handwerker, storage
companies, paysagistes/Gartenbau — bill more than 1000 CHF per invoice and
run their commercial correspondence out of one inbox, answered by the owner
between jobs, in French or German. Every inbound "what would this cost?"
costs them an evening. They will not open a workspace, they will not learn a
CRM, and they buy on two things: the thing answers their email, and their
data stays in Switzerland.

We have a workspace-shaped agent platform. They want a phone-shaped one.

## Today / Delta

Verified against `origin/main` at 0d44b3b5b + merged PRs #1128/#1130/#1135/#1140.

**Today — what already exists and is load-bearing here:**

- **Swiss models are already wired.** `infomaniak` is a first-class provider
  (`packages/agent/src/server/models/modelConfig.ts`), OpenAI-compatible,
  `https://api.infomaniak.com/2/ai/<productId>/openai/v1`, with concrete
  registered models (`Qwen/Qwen3.5-122B-A10B-FP8`, `moonshotai/Kimi-K2.6`,
  `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8`), keyed by
  `INFOMANIAK_API_TOKEN`. Inference in Switzerland is a config choice today,
  not a project.
- **The app is already portable, and Postgres-only.** `apps/full-app` ships a
  reference Dockerfile (`web-runtime` + `worker-runtime`, drops to uid 10001,
  chowns `/data/workspaces` and `/data/pi-sessions`) and takes `DATABASE_URL`
  / `DATABASE_URL_FILE`. Persistence is drizzle + postgres-js in
  `packages/core/src/server/db/`, 25 migrations, advisory-locked, with an
  `additionalMigrations` seam for app-owned tables. A CH-resident instance is
  a deployment, not a port.
- **But this repo no longer owns a deployment.** #853 deliberately deleted
  `fly.toml`, the self-host image workflow, `config/self-host/`, and
  `docs/deployment/**`; `hachej/seneca` is the canonical live deployment, and
  the runbook now lives in
  `.agents/skills/boring-app-setup/manuals/providers/PROVIDER_SNIPPETS.md`
  ("generic hosted baseline" = Vercel + managed Postgres; "our custom
  always-on setup" = Fly + managed Postgres). CI has no deploy job. A CH
  deployment is therefore a *new* provider entry in that runbook, not a
  resurrection of deleted config — and note the Dockerfile's production
  default is `BORING_AGENT_MODE=vercel-sandbox`, which is emphatically not
  Swiss (see §6).
- **Exoscale is already operated** (#1126): `plugins/live-transcription/services/lifecycle/daemon.py`
  drives `exo` from a root-owned loopback daemon behind a default-deny IAM
  role scoped to one instance UUID, with credentials that never reach Boring
  UI. The app-side boundary (`computeLifecycle.ts`) is provider-neutral, so
  swapping providers means a new daemon, not app changes. **Correction worth
  making early: that instance is in `at-vie-2` — Vienna, Austria, not
  Switzerland.** Exoscale does have CH zones (`ch-gva-2`, `ch-dk-2`); we have
  simply never used one. What we have is the operational pattern, not a CH
  footprint.
- **The channel design is done and merged.** `docs/issues/1127/plan.md`
  (owner-gated, `needs-owner-approval`) specifies `ChannelAdapter`,
  `ChannelBindingStore`, durable inbound dedupe in one sqlite transaction,
  async webhook ack, durable-store tail with leased cursor CAS, turn
  assembly, WhatsApp dialect rendering + 4096-char chunking, and the 24h
  template fallback. Decisions: Meta Cloud API direct (no Twilio),
  contract-first with a fake-channel conformance harness, v1 in-process.
- **The durable substrate landed.** `SqliteEventStreamStore`
  (`packages/agent/src/server/events/eventStreamStore.ts`) with idempotent
  append and opaque offsets; every pi-chat event is durably appended before
  fan-out (`harnessPiChatService.publishChannelEvents`), and cold opens
  rehydrate from it (`hydrateDurableReplayBuffer`).
- **Approval machinery exists, carries artifacts, and is already
  channel-agnostic at the seam that matters.** `plugins/ask-user`:
  `AskUserQuestion {questionId, sessionId, status:
  ready|answered|cancelled|abandoned, title, context, schema, artifacts,
  answerToken, ownerPrincipalId}` with a 7-arm `AskUserField` union and an
  append-only per-session transcript. Artifacts are
  `HumanArtifact[] = {id, surfaceKind, target, title, description?}`, hoisted
  out of the plugin to `packages/workspace/src/shared/artifacts/humanArtifact.ts`
  with a handover-projection layer (100 artifacts/run, 256KB, duplicate-id
  rejection). Creation is the `ask_user` tool → `AskUserRuntime.ask()`, which
  registers the waiter *before* persisting and then blocks the tool call.
- **The out-of-band answering seam already exists.**
  `plugins/ask-user/src/server/questionsBridge.ts` exposes
  `handle(command)` with a pluggable `getAuthContext()` and zero
  HTTP/React/Fastify dependency; `answer`/`cancel` already declare
  `callerClassesAllowed: ["browser", "server"]`, and authorization is a
  constant-time compare against a 32-byte `answerToken` — a **capability, not
  an identity**. That is precisely the shape a signed link sent to a
  non-member's phone needs. `AskUserStore.subscribe()` is the
  delivery-notification seam and `AskUserCoordinator` abstracts the waiter for
  a cross-process implementation.
- **The Inbox item model already anticipates non-agent sources.**
  `inboxItemModel.ts`: `InboxItemKind = question|review|approval|notice` and
  `WorkspaceInboxItemSource` includes an `external-hook {externalId}` arm.
- **Managed connectors exist.** `plugins/boring-mcp` has a full Composio
  integration (`composioManagedConnector.ts`, ~23KB) with hosted OAuth,
  server-only key resolution, read-only allowlisting (`readonlyCall.ts`), a
  rate budget gate, and a 9-check security preflight
  (`docs/composio-security-preflight.md`). User-registered MCP endpoints are
  SSRF-hardened at connect time (#1135: resolve-then-pin via undici, redirects
  refused).
- **A share seam exists.** `shareResourceUri(id) => "share:///<id>"` and
  `registerShareEntryResources()`
  (`packages/agent/src/server/mcp/shareEntryResources.ts`), over
  `ShareEntryV1` (`packages/agent/src/shared/share-entry.ts`) — an opaque id
  bound to `{workspaceId, path}`, resolved live (never a blob snapshot), with
  membership checked before any stat so a non-member cannot use it as an
  existence oracle. Deep link route `GET /a/:id`.
- **Per-hostname landing pages are a solved pattern** — seneca PR #48
  (unmerged, tree at `~/projects/seneca/.worktrees/agent-lps/`):
  `AGENT_LANDING_ROUTES: [{slug, hostnames[], htmlEntry}]` plus a copy block,
  a prerendered `<slug>.html`, and a Caddy site block. Adding a vertical LP is
  five mechanical steps, documented in that repo's `DEPLOY.md`.
- **A1 agent authoring is a directory**: `agents/<name>/{agent.json,
  instructions.md, tools/}`, strict schema, persona entirely in
  `instructions.md` prose, tools bound host-side. Convention:
  `definitionId == landing slug == directory name`.

**Delta — what does not exist:**

- **No email reading, anywhere.** `packages/core/src/server/mail/transport.ts`
  is outbound SMTP/Resend for auth mail only. No IMAP, no MIME parsing, no
  threading, no sync cursor, no OAuth. `~/projects/boring-mail` is a *mock*:
  hardcoded threads and `.mail.md` draft files; `src/storage/sqlite.ts`
  returns not-implemented. Salvageable from it: the draft-file format, the
  domain types (`MailThread`/`MailMessage`/`DraftMail` — lacking
  `messageId`/`inReplyTo`/`references`, so real threading needs extension),
  pure filter/sort helpers, and `mailAgentTool.ts` with its path-traversal
  guard. The entire protocol half is new work. Its own plan
  (`docs/plans/boring-mail-chief-of-staff-workbench-plan.md`) leaves
  "Gmail OAuth or IMAP?" explicitly open at line 513.
- **No Gmail toolkit configured.** Composio is wired to `notion` and
  `airtable` only (`apps/full-app/src/server/boringMcp.ts`). The full-catalog
  backend (#937) was reverted and #946 keeps it reverted.
- **No channel code at all.** #1127 is design-only: no `ChannelAdapter`, no
  `ChannelBindingStore`, no webhook, no outbound worker, no
  `BORING_AGENT_CHANNELS` plumbing. Its planning bead is still in progress.
- **The share seam is not shareable.** No expiry, no signature, no capability
  token, no anonymous access, and `InMemoryShareEntryStore` is the only
  implementation — nothing durable. Access is same-workspace membership only.
  A link a business owner can open on their phone is a new layer.
- **ask_user has no notification/delivery abstraction.** The seam for
  *answering* out-of-band is there (above); what is missing is anything that
  *tells a human somewhere else* that a question is waiting.
  `AskUserStatePublisher` targets a workspace `UiBridge` only; grepping
  `plugins/ask-user` and `packages/workspace/src` for
  `slack|notifier|notificationChannel` returns zero hits. This — not the
  answering path — is the gap. (#1127 separately demoted *channel* answering
  to its slice 3.)
- **`FileAskUserStore` is a JSON file** at
  `<workspaceRoot>/.boring/ask-user.json` (atomic tmp+rename). Fine for one
  pilot, not a durable multi-customer store.
- **One pending question per session** (`PENDING_EXISTS`), plus rate limits of
  6/session/min and 30/principal/hr. Load-bearing for us: see §4 — a morning
  batch of eight emails cannot become eight concurrent intentions on one
  session.
- **Signup-to-agent binding by hostname is unimplemented.**
  `BORING_SIGNUP_AGENT_DEFAULTS_JSON` is documented in seneca's `.env.example`
  as the target shape; core does not read it yet (awaits core #1165/0.1.96).
- **No French/German agent presets, no quote templates, no CH deployment.**

## Solution

### 1. Product shape: one template, four presets

**One** agent template — "reads the mailbox, drafts the reply, drafts the
quote, asks the owner to approve" — instantiated four times. Verticals differ
only in prose and data, never in code. This is the whole bet: if a vertical
needs a code branch, we have mis-scoped it.

A preset is a directory following the A1 convention already proven in seneca:

```txt
agents/
  fiduciaire/            # Treuhand / accounting-trustee
    agent.json           # definitionId "fiduciaire", label, instructionsRef
    instructions.md      # persona + trade vocabulary, FR primary / DE variant
    quote-templates/     # line-item skeletons, price bands, standard clauses
  artisan/               # Handwerker
  stockage/              # storage
  paysagiste/            # Gartenbau
```

Locked conventions:

- `definitionId == landing slug == directory name`, as seneca established.
- **Language is per-preset content, not a runtime flag.** A Romandie
  fiduciary gets a French `instructions.md` with French quote templates; the
  Swiss-German artisan preset gets German. Two presets may share a
  `definitionId` stem with a locale suffix (`artisan-fr`, `artisan-de`) rather
  than one bilingual prompt trying to guess. Reply language is mirrored from
  the inbound email; the *drafting* vocabulary and templates are fixed per
  preset. Do not machine-translate quote templates — trade vocabulary
  (*métré*, *régie*, *Regiearbeit*, *Akontozahlung*) is where a wrong word
  loses the sale.
- Quote templates are **data the agent fills**, not prose it invents: line
  items, units, price bands, and the standard clauses (validity period, VAT
  treatment, payment terms). The agent proposes numbers inside the owner's own
  bands; it never invents a price schedule.
- Per-vertical hostname LP via seneca's `AGENT_LANDING_ROUTES` mechanism —
  route entry + copy block + `<slug>.html` + Caddy block + DNS. Four LPs is
  four repetitions of a five-step recipe, not four projects. Note the honest
  gap: hostname→seat binding on signup is not implemented yet, so v1 either
  ships one seat per deployment (fine for a pilot) or waits on core #1165.

### 2. Capability slice (a): email ingestion

**Today:** nothing. Outbound SMTP only; boring-mail is a mock; no Gmail
toolkit configured.

**Delta:** a read-only mailbox sync producing threaded messages in a local
store, with an idempotent cursor.

**Recommendation: IMAP read-only, direct. Not Composio Gmail.** Three
reasons, in order of weight:

1. **Residency.** Composio is a US-hosted managed connector: the OAuth broker
   and the tool-execution path both see message content. Routing a Swiss
   fiduciary's client correspondence through `backend.composio.dev`
   contradicts the one thing we are selling. Our own preflight checklist has
   a "data residency, subprocessors, DPA" line item
   (`plugins/boring-mcp/docs/composio-security-preflight.md`) that we would
   have to check "accepted gap" against — in front of the exact buyer who
   cares. That is not a trade we should make.
2. **Fit.** Swiss SMBs are not on Gmail at the rate US SMBs are — Infomaniak,
   Hostpoint, local providers, and Microsoft 365 dominate. IMAP is the one
   protocol all of them speak. A Gmail-only ingest would disqualify most of
   the pipeline.
3. **Cost symmetry.** Composio Gmail is not free work either — it is a
   `connectorConfigs` entry *plus* full preflight evidence. We are choosing
   between two pieces of new work, not between free and expensive.

Shape: `imapflow` (or equivalent) against one mailbox, app-specific password
or OAuth where the provider requires it, **read-only — never a mailbox
mutation**, no flag setting, no delete, no label writes. Idempotent upsert
keyed on `Message-ID`; threading via `In-Reply-To`/`References` (extend
boring-mail's types, which lack all three). Sync cursor persisted per account.
Fetch bodies for the last N days only; the agent never needs the archive.

Composio Gmail stays available as an **opt-in accelerator** for a prospect who
is on Google Workspace and does not care about residency — behind the
existing connector config, with the preflight actually run. It is a second
provider under the same internal interface, not the default.

### 3. Capability slice (b): WhatsApp channel

**Today:** design complete and merged (`docs/issues/1127/plan.md`), zero code.
Substrate (`SqliteEventStreamStore`) on main.

**Delta:** build #1127 slices 1a/1b/2 — but this product needs materially
less of them than #1127 assumed, because **the identity model inverts.**

In #1127 the external sender is a client's team member talking to a deployed
agent: many unknown senders, per-agent grants, unknown-sender rejection UX,
fail-closed policy, session rotation. Here the external sender is **the
business owner, approving their own drafts**. One phone number, one
workspace, one agent, provisioned by us at onboarding. That deletes or
trivialises:

- unknown-sender UX (§2 of the 1127 plan) → any non-bound number is dropped
  silently at the webhook; no rejection template, no per-sender rate limit,
  no reply-loop risk;
- per-agent grants (#1087 seam) → not needed, the binding *is* the grant;
- multi-agent routing per sender → one agent per binding, by construction;
- the trusted-caller seam's blast radius → still a new seam, still needs the
  guardrails 1127 specifies (mint only when the scope resolves and
  `binding.status === active`, revocable, flag-gated), but it mints a scope
  for a customer against their own workspace, not for a stranger.

What we adopt verbatim from #1127, because it is right and hard-won:

- webhook signature verify (`X-Hub-Signature-256`) + verify handshake before
  any parsing;
- **durable inbound dedupe and queue insert in one sqlite transaction** —
  Meta retries for hours, and a crash between two separate writes eats the
  message forever;
- ack 200 immediately, drain asynchronously, per-binding serialized worker;
- outbound is at-least-once — send precedes cursor CAS, and WhatsApp offers
  no send idempotency key;
- WhatsApp dialect rendering (`*bold*`, `_italic_`, no headings/tables) and
  4096-char splits on paragraph boundaries;
- the single pre-approved template for the lapsed 24h window;
- fake-channel conformance harness so the loop is CI-provable without Meta
  credentials.

What changes: see §4 — the MVP does not need the durable-tail turn assembler
(1127 slice 1b) at all, because MVP WhatsApp traffic is notification-out plus
short command-in, not a streamed agent conversation.

### 4. Capability slice (c): the draft-quote loop

**Today:** `AskUserQuestion` + `AskUserFormSchema` + `HumanArtifact[]` give us
exactly the right primitive — an intention that carries the artifact under
review, with a lifecycle and a store. Better than expected: the answering
path is already channel-agnostic (`questionsBridge.handle`, server callers
allowed, capability-token authorization), so an out-of-band approval is a
*consumer* of an existing seam rather than a new one.

**Delta:** the approver changes identity. Everywhere in the platform so far,
the human answering an ask_user is *the operator of the workspace* — us, or a
technical user. Here it is **the business owner**, who has never seen the
workspace and is holding a phone at a job site. That reframing, not the
plumbing, is the design work:

- an intention must be legible in three lines of WhatsApp: who wrote in, what
  they want, what we propose to answer, how much we propose to charge;
- the affordances collapse to **approve / edit / reject** — a
  `AskUserFormSchema` with a select and an optional textarea, not a form;
- **nothing is auto-sent, ever.** The agent produces a draft; a human tap
  sends it. This is a product guarantee, not a default (§7).
- the artifact link on the intention points at the source email thread, so
  "let me see the actual email" is one tap.

**A constraint that shapes the whole loop:** `AskUserRuntime` enforces **one
pending question per session** (`PENDING_EXISTS`) and rate-limits to
6/session/min. A fiduciary's Monday morning is fifteen emails, not one. Two
options, and this is a real design decision the owner should see:

- **(i) one session per email thread** — each thread gets its own agent
  session, so each can hold its own pending intention. Natural fit, matches
  the artifact model, and it is how the platform already thinks (sessions are
  cheap). Cost: many sessions per customer per day.
- **(ii) a queue in front of one session** — the agent drafts a batch and
  presents them one at a time, the next intention opening as the previous
  resolves. Fewer sessions, but it serialises the owner's morning and adds a
  queue we would have to build.

**Recommendation: (i), one session per thread.** It requires no new
machinery, and the serialisation in (ii) is exactly the friction we are
selling against. Note the notification side must then batch — one WhatsApp
message saying "8 drafts ready", not eight messages.

The MVP shortcut that makes this tractable: **approval happens in a link-opened
approval view, not in WhatsApp.** WhatsApp carries the notification and the
link; the tap opens a mobile-legible approval view authorized by the
question's own `answerToken`; the send happens there. The token model makes
this clean — the business owner needs no workspace account and no session,
because the capability *is* the URL.

This needs zero channel-side ask_user answering (#1127's demoted slice 3) and
zero durable-turn assembly (#1127's slice 1b, the component its own review
isolated as the risk centre). Two-way WhatsApp approval ("reply OK to send")
is a genuinely nice v2, but it is not what stands between us and a paying
fiduciary.

What is genuinely new here is small and well-shaped: a **notification
delivery abstraction** hanging off `AskUserStore.subscribe()` — the one thing
§3's Today section identifies as absent — with WhatsApp as its first
implementation.

### 5. Capability slice (d): artifact drop

**Today:** `shareResourceUri` + `ShareEntryV1` + `GET /a/:id` give an opaque
id bound to `{workspaceId, path}`, resolved live, with membership checked
before any stat. Well-built, and deliberately minimal — its own header says
so.

**Delta:** everything that makes a link openable by someone who is not a
workspace member. Concretely:

1. a **durable** share entry store (today: `InMemoryShareEntryStore` only);
2. a **capability token** — signed, single-purpose, carrying the entry id and
   an expiry — so possession of the URL is the authorization, since the
   business owner has no workspace membership;
3. **expiry and revocation**, with a tombstoned outcome already modelled in
   `resolveShareEntry()` (`ok | not_found | tombstoned`) — the shape is
   there, the lifecycle is not;
4. an unauthenticated read path that returns byte-identical responses for
   expired, revoked, and never-existed, preserving the existing
   no-existence-oracle discipline.

Order: **share link first, PDF attachment second.** A link is one signed URL
and a mobile-legible render; a PDF is a rendering pipeline, a fonts problem, a
storage problem, and a Meta media-upload problem, and it buys us a document
the owner cannot act on. Quotes in the MVP are links; when the owner approves,
the *email* carries whatever formal document the trade expects.

Caveat to state plainly: a capability-token URL in a WhatsApp thread is
forwardable. Expiries must be short (hours, not weeks), tokens single-entry,
and anything genuinely confidential stays behind workspace auth.

### 6. Capability slice (e): CH deployment

**Today:** Infomaniak models wired and already billed in CHF; full-app
Dockerized with Postgres; the Exoscale operational pattern proven (in Vienna);
no deployment config in this repo since #853.

**Delta:** a deployment topology we can put in writing. What runs where:

| Component | Where | Status |
| --- | --- | --- |
| App (full-app container) | Exoscale `ch-gva-2`/`ch-dk-2` or Infomaniak Public Cloud | new deploy; new provider entry in `PROVIDER_SNIPPETS.md` |
| Postgres (core, 25 migrations) | CH-resident managed Postgres, same zone | new |
| Event store / channel bindings / share entries | app volume, CH | new; sqlite-shaped, see risk 6 |
| Session transcripts (`/data/pi-sessions`) | app volume, CH | pattern exists (`BORING_AGENT_SESSION_ROOT`) |
| Mailbox content | fetched into the CH app store; never leaves | new |
| LLM inference | Infomaniak AI (CH), OpenAI-compatible | **already wired** |
| Agent sandbox | **must not be `vercel-sandbox`** — see below | deferred: no sandbox |
| WhatsApp transport | Meta (non-CH) | see §7.1 |
| Email transport | customer's existing provider | unchanged |

**The `vercel-sandbox` landmine.** The reference Dockerfile's production
default is `BORING_AGENT_MODE=vercel-sandbox` — US-operated compute that would
silently see workspace content, in the one deployment where that is a selling
failure. A CH deployment must explicitly set a non-Vercel mode. This is
cheap to get right and expensive to discover late, so it belongs in the
deployment checklist as a hard gate, not a note.

Two Infomaniak deployment notes, both already learned the hard way and worth
carrying into the runbook: pi resolves the API key via `process.env[name]`
without stripping `$`, so a `$`-prefixed value becomes the literal bearer
token and 401s; and `supportsDeveloperRole` / `supportsReasoningEffort` are
both `false` because the endpoint 400s on the `developer` role.

The honest statement we can defend: *storage, processing, and model inference
are in Switzerland; the WhatsApp channel transits Meta.* Not "everything is in
Switzerland."

**Deferred, deliberately: the sandbox question.** The trades agent drafts text
and fills templates — it does not need code execution. A CH-resident sandbox
(gVisor on our own hardware, per the SBX1 direction) is a real question for
the platform and an irrelevant one for this product. Ship without agent
sandboxing; revisit if a preset ever needs to run code.

## Decisions (proposed, not yet ratified)

1. **One template, four content presets.** A vertical that needs a code branch
   is a mis-scope, and we stop and re-plan rather than branch.
2. **IMAP read-only is the default email path**; Composio Gmail is an opt-in
   accelerator for non-residency-sensitive prospects, never the default.
3. **Never auto-send.** Every outbound email and every quote is human-tapped.
   This is a contractual product guarantee, not a configurable default.
4. **MVP approval happens in the workspace via a WhatsApp link.** Two-way
   WhatsApp answering (#1127 slice 3) is v2.
5. **Reuse #1127's transport design verbatim**; invert only the identity
   model. We do not re-plan channels in this epic.
6. **Share links before PDFs.**
7. **One pilot customer, one fiduciary, before any second vertical is built.**
   The four presets are the product thesis; one paying user is the test of it.

## MVP cut — one Swiss fiduciary, 2-3 weeks

Scoped so that a real fiduciary uses it daily, and so that nothing on the
critical path is a component #1127 itself flagged as "the risk centre."

**In:**

1. **IMAP read-only sync** of one mailbox, threaded, cursored, last 30 days.
2. **The `fiduciaire` preset** — French `instructions.md`, real quote
   templates taken from the pilot customer's own past quotes, their own price
   bands.
3. **Draft generation into an ask_user intention** carrying the source thread
   as `AskUserArtifact`. Approve / edit / reject.
4. **A mobile-legible approval view** in the workspace, reachable by link.
5. **WhatsApp outbound only** — "3 new emails need you" plus the link. This
   needs #1127 slice 1a (webhook infra, bindings, credentials) and the
   provider edge from slice 2 (send + template), and **not** slice 1b (the
   durable-tail turn assembler), because we are not streaming agent turns to
   the phone.
6. **Durable, expiring share links** for the approval view.
7. **One CH deployment**: Exoscale CH zone, CH Postgres, Infomaniak models.
8. **One hostname LP** for `fiduciaire`.

**Out of the MVP, explicitly:** inbound WhatsApp commands, ask_user answering
from the channel, PDF generation, the other three presets, German variants,
multi-mailbox, calendar, accounting-system integration, sandboxing, per-agent
grants, session rotation, multi-tenant CH hosting.

**Why this is 2-3 weeks and the obvious version is not:** the obvious version
("chat with your agent on WhatsApp") requires #1127 slice 1b turn assembly —
which that plan's own review kept alone in its own slice as the risk centre —
plus slice 3 answering, which is parked. Outbound-notification-plus-link
routes around both. The agent's actual value (reading the mail, drafting the
quote) is untouched by that cut; only the approval gesture moves from a
WhatsApp reply to a tap.

## Unit economics

Rough, and stated as a hypothesis to test in the pilot, not a model.

**Value side.** A Swiss fiduciary's loaded hourly cost is ~90-130 CHF; the
owner's own time is worth more than that at the margin because it is the
constraint on taking new clients. Quote-and-correspondence admin plausibly
runs 5-12 hours/month for a small firm. At 100 CHF/h that is **500-1200 CHF/mo
of recoverable time**, and the second-order value is larger: quotes that go
out the same evening instead of the following week convert better on >1000 CHF
tickets. One extra won job per quarter pays for the year.

**Cost side, per customer per month:**

- Infomaniak inference, and we have verified CHF rates rather than guesses
  (`docs/credits-prod-deployment.md`): Qwen3.5-122B at **0.40 in / 3.20 out
  CHF per MTok**, Kimi-K2 at 0.60/3.00. A drafting turn that reads a thread
  and writes a reply plus a quote is on the order of 10k in / 2k out, so
  ~0.01 CHF per draft. **300 drafts/month is roughly 3 CHF.** Even at 10x the
  token estimate this is noise. Convenient billing property already
  established: Stripe charges CHF and Infomaniak bills CHF, so 1 credit-unit
  = 1 CHF with no FX;
- WhatsApp: post-July-2025 Meta bills per message; utility templates in
  Europe are cents and service replies inside the 24h window are free — at
  notification volumes this is negligible, single-digit CHF;
- hosting: a shared CH VM + managed Postgres amortises to tens of CHF while
  single-tenant-per-customer would be ~100 CHF;
- support: the real cost, and front-loaded at onboarding.

**Price.** 300-800 CHF/mo is the right band, and the defensible list price is
**500-600 CHF/mo** — roughly half of the low end of the value estimate, which
is the ratio that makes the decision easy for an owner who is not modelling
anything. Below 300 CHF/mo we cannot afford the onboarding; above 800 CHF/mo
we are competing with hiring a part-time administrator, which is a fight we
should not pick.

**Pilot recommendation: 500 CHF/mo from month one, setup waived, 3-month
term, cancel anytime, in exchange for a reference and the right to use their
anonymised quote templates as the preset baseline.** Charge from day one —
a free pilot is not used, and an unused pilot teaches nothing. The waived
setup (worth 1500-2500 CHF) is the concession; the monthly is not.

## Risks / honesty

1. **WhatsApp transits Meta.** The channel is not Swiss and cannot be made
   Swiss. Say it first, in the sales conversation, before the buyer finds it:
   *storage, processing, and inference are in Switzerland; WhatsApp messages
   themselves pass through Meta, which is why we only ever send
   notifications and links over WhatsApp, never client data or documents.*
   That constraint is also a design rule — it is why §5's MVP puts content
   behind a link instead of in the message body. Buyers who cannot accept it
   get an email-and-web-only variant.
2. **Mailbox access is the real trust ask.** We are asking for read access to
   a fiduciary's client correspondence — the most confidential mail in Swiss
   SMB life. Mitigations that must be true and demonstrable, not asserted:
   read-only credentials, never a mailbox mutation, a scoped app password
   they can revoke without changing their own password, a short retention
   window, no content in logs, and a written statement of exactly which
   subprocessors see message content (with IMAP-direct, the answer is: none
   — which is the whole reason for decision 2).
3. **Quote liability.** A wrong number in a quote is a real financial
   exposure for the customer. Every artefact is a **draft**; a human sends.
   The agent proposes within the owner's own price bands and flags anything
   outside them rather than guessing. Terms must state that the customer is
   responsible for what they send.
4. **Meta Business API timeline — correcting the assumption.** This was
   framed as "weeks, the critical path." Current reality: standard onboarding
   is roughly **3-10 business days** — 2-4 days for Meta Business
   Verification, hours for WABA and phone-number setup, 24-48 hours for first
   template approval. The 2-8 week figure is the **green-tick Official
   Business Account badge, which we do not need** for a bot the customer
   already expects to hear from. Start verification on day one anyway — it is
   free, it is owner-side, and it parallelises — but do not sequence the
   engineering behind it, and do not tell the pilot customer it is the
   blocker. #1127's open question 4 (Twilio sandbox as fallback) can stay
   closed unless verification actually stalls.
5. **The real critical path is the pilot customer's mailbox credentials.**
   Engineering is bounded and parallel; a fiduciary's decision to hand over
   inbox access is not, and it is the only unbounded item on the list. Secure
   a named design partner and their written agreement to grant read-only
   access *before* slice 1 starts. If that conversation takes a month, the
   engineering was never the constraint.
6. **A real storage split, not a vague one.** `packages/core` is
   **Postgres-only** (drizzle + postgres-js, 25 migrations, no sqlite
   anywhere). But `SqliteEventStreamStore` is sqlite, #1127 puts the channel
   binding store on that same `SqlStorage` seam, and `FileAskUserStore` is a
   JSON file on the workspace volume. A CH instance therefore has three
   persistence regimes: Postgres for identity and workspaces, sqlite on a
   volume for events and bindings, a JSON file for pending intentions. Each
   is fine for one pilot on one VM; all three are a cliff at the third or
   fourth customer — including for backup, which #853 left
   provider-independent-and-unbuilt (#877). Name it now, pay for it after the
   pilot, and do not let "it worked for the fiduciary" become the
   multi-tenant architecture by default.
7. **Vertical dilution.** Four presets is a thesis about content reuse. If the
   fiduciary pilot needs bespoke code, the other three verticals are not
   presets and the product is four products. Decision 7 exists to catch this
   before we build the second one.
8. **Language quality is a sales risk, not a technical one.** A French quote
   with Belgian or Québécois vocabulary, or German that reads as German
   rather than Swiss, is disqualifying to this buyer. Trade vocabulary comes
   from the pilot customer's own documents, reviewed by a native speaker,
   never machine-translated.

## Test seams

- **Highest public seam:** fixture mailbox → sync → agent drafts → ask_user
  intention with artifact → approval view renders → approve → outbound email
  queued (never sent without the tap). Runs with no Meta credentials, no live
  IMAP.
- IMAP sync: run the same fetch twice, assert zero duplicate threads and a
  monotonic cursor; assert no mailbox mutation is ever issued (spy the client
  and fail on any non-read command).
- Share links: expired, revoked, and never-existed produce byte-identical
  responses; a token outlives nothing.
- WhatsApp edge: recorded fixtures per #1127's slice 2 approach; signature
  verify and template fallback unit-tested. Meta itself is mocked at the
  transport edge.
- Presets: an assertion that the four presets differ only in content — no
  vertical-specific code path exists.
- **Avoid testing:** Meta API behaviour, IMAP server behaviour, pi runtime
  internals, LLM output quality (that is pilot feedback, not CI).

## Slices

### Slice 1: mail ingest (IMAP read-only) + fiduciaire preset
**Delivers:** IMAP sync with idempotent upsert and cursor, threading via
`Message-ID`/`In-Reply-To`/`References`, read-only enforcement, the
`fiduciaire` A1 preset with real French quote templates, drafting into an
ask_user intention carrying the source thread as a `HumanArtifact`,
one session per thread (per §4).
**Blocked by:** pilot customer's mailbox credentials (owner-side, §7.5).
**Proof:** fixture-mailbox seam end-to-end; double-sync idempotence; no-mutation spy.

### Slice 2: approval view + durable expiring share links
**Delivers:** durable share entry store, capability token with expiry and
revocation, unauthenticated read path with uniform not-found semantics,
mobile-legible approval view authorized by the question's existing
`answerToken` and submitting through `questionsBridge.handle` as a server
caller, approve/edit/reject → outbound email on tap.
**Blocked by:** slice 1.
**Proof:** expiry/revocation uniformity; approve-sends, no-tap-never-sends.

### Slice 3: WhatsApp outbound notification
**Delivers:** #1127 slice 1a (webhook core, `ChannelBindingStore` with the
single-transaction dedupe insert, credentials, flag plumbing, trusted-caller
seam with guardrails) narrowed to a single provisioned owner binding, plus
the send half of #1127 slice 2 (Meta Cloud API client, template fallback),
plus the missing piece named in §3's Today: a **notification delivery
abstraction** off `AskUserStore.subscribe()`, batching a set of pending
intentions into one message. **Explicitly not** #1127 slice 1b turn assembly
and not channel-side answering.
**Blocked by:** slice 2; Meta Business verification (owner-side, parallel).
**Proof:** fake-channel notification loop in CI; live demo to a test number.

### Slice 4: CH deployment + fiduciaire LP
**Delivers:** Exoscale CH-zone (`ch-gva-2`) or Infomaniak Public Cloud deploy
as a new provider entry in `PROVIDER_SNIPPETS.md`, CH managed Postgres,
Infomaniak model config, a hard gate asserting `BORING_AGENT_MODE` is not
`vercel-sandbox`, hostname LP via seneca's `AGENT_LANDING_ROUTES` recipe, and
the written residency statement of §6.
**Blocked by:** slice 3.
**Proof:** pilot customer using it against their real mailbox for one week.

### Slice 5 (post-pilot, separate gate): presets 2-4, German variants,
inbound WhatsApp commands (#1127 slices 1b + 3), PDF generation.
Gated on decision 7 — one paying fiduciary first.

## Out of scope

Accounting-system and calendar integration, invoicing, payments, CRM,
multi-mailbox and shared-inbox semantics, agent sandboxing, per-agent grants
(#1087), multi-tenant CH hosting at scale, proactive agent-initiated outreach
beyond the notification template, group chats, inbound media, billing/metering
of channel traffic, SMS and Slack channels.

## Open questions — owner decisions required

1. **Pilot customer.** Who is the named fiduciary, and will they grant
   read-only mailbox access in writing before slice 1 starts? This is the
   critical path (§7.5), not the engineering.
2. **Pricing.** Ratify 500 CHF/mo from month one with setup waived, or choose
   a different point in the 300-800 band. Recommendation: 500, charged.
3. **Residency wording.** Approve the exact sentence in §6/§7.1 that we will
   put in front of buyers and in the contract.
4. **Composio Gmail.** Confirm it stays an opt-in accelerator and never the
   default, accepting that this costs us Google Workspace prospects who want
   zero-config onboarding.
5. **Hostname seat binding.** Ship the pilot as one-seat-per-deployment now,
   or wait for core #1165/0.1.96 to land
   `BORING_SIGNUP_AGENT_DEFAULTS_JSON`? Recommendation: one seat per
   deployment — a pilot does not need multi-tenant signup.
6. **Which second vertical**, and on what evidence from the pilot? Do not
   answer this before slice 4.
