---
github: https://github.com/hachej/boring-ui/issues/1210
issue: 1210
state: needs-owner-approval
updated: 2026-08-11
revision: r3 (+ 2026-08-11 WhatsApp-native signup/identity ruling)
flag: BORING_AGENT_CHANNELS (reused, from gh-1127); new tenant app repo
---

# gh-1210 — CH revenue agent for Swiss SMBs

**r2 supersedes r1.** r1 planned a secretary that saves admin time. The owner
reframed it: the product makes customers *more money*. That inverts the value
story, changes the pricing anchor, adds two verbs (FIND, BID) ahead of the two
r1 had (RESPOND, FOLLOW UP), and — once the vertical research came back — moves
the recommended pilot away from fiduciaries.

Owner gate. Nothing is built until the owner ratifies the pilot vertical (§4),
the legal position on outbound (§9), and the pricing (§10).

## Problem

A Swiss tradesman with a CHF 28,000 bathroom renovation on offer loses it
because he was on a roof when the request arrived and answered on Thursday.
The German mystery-shop numbers are brutal and they are the best European
evidence available: of 100 standardised enquiries per trade, **roofers replied
to 37, drywallers 54, solar installers 56, heating engineers 57, window
fitters 76** ([Deutsche Handwerks Zeitung, May 2026](https://www.deutsche-handwerks-zeitung.de/100-anfragen-pro-gewerk-wer-antwortet-wer-nicht-378421/)).
Roofers named a concrete appointment in **7 of 100** enquiries.

That is not an admin problem. It is revenue on the floor. The pitch is not
"save four hours a week", it is **"you will win jobs you are currently
losing"** — and the price is anchored against one won job, not against hours
saved.

## The offer — five elements

Sold as one thing. Elements 2-5 are the agent; element 1 is what makes it feel
like *we get you clients* rather than *we sell you software*.

1. **A new landing page for the customer** — delivered at onboarding, on their
   brand and domain, FR or DE, mobile-first, with services, photos, Google
   reviews, a quote-request form and a WhatsApp click-to-chat button. Swiss SMB
   trade sites are typically absent or a decade old. Crucially this is not a
   gift: **the form and the WhatsApp button feed straight into RESPOND**, so
   their own site becomes a lead source the agent owns end to end.
2. **FIND** — the agent hunts opportunities daily: marketplace requests
   matching their trade, region and capacity, plus (per vertical) public
   signal sources. Nobody's secretary does this. It is the differentiator —
   and, per §(a2), the element where our tooling is weakest and the legal and
   ToS constraints sharpest, which is why the MVP implements its defensible
   form (the customer's own alert emails) and defers the rest.
3. **BID** — for each found opportunity the agent drafts the offer from the
   customer's own price book and past quotes, and on approval submits it.
4. **RESPOND** — every inbound lead gets a credible draft answer in minutes,
   FR/DE, owner-approved, including evenings and weekends.
5. **FOLLOW UP** — unanswered quotes chased on a cadence until decided; a
   review request after each completed job; dormant-client reactivation and
   seasonal campaigns.

## Architecture thesis: one engine, verticals are configuration

The strongest structural claim in this plan, and the one to attack first if
it is wrong: **there is one product, not five.**

```txt
                 ┌──────────────────────────────────┐
   signals  ───▶ │  opportunity intake              │ ───┐
   (marketplace  │  normalise → dedupe → filter     │    │
    alerts,      └──────────────────────────────────┘    │
    public                                               ▼
    registers,                                  ┌─────────────────┐
    inbound      ┌──────────────────────────────│  draft engine   │
    email,       │  price book + knowledge      │  (FR/DE)        │
    site form)   └──────────────────────────────└─────────────────┘
                                                          │
                                                          ▼
                                            ┌───────────────────────────┐
                                            │ human intention (ask_user)│
                                            │  approve / edit / reject  │
                                            └───────────────────────────┘
                                                          │
                                    WhatsApp notify ◀──────┴──────▶ send / submit
```

A vertical is then a **configuration bundle**, not a codebase:

| Per-vertical kit | What it is |
| --- | --- |
| Persona | `instructions.md` prose, FR or DE, trade vocabulary |
| Knowledge corpus | curated `knowledge/` files on winning work in that trade |
| Signal filters | which sources, which keywords, which region/capacity rules |
| Quote templates | line items, units, price bands, standard clauses |
| Vertical LP | *our* marketing page, one hostname per vertical |
| Customer-LP template | the site we build for each customer in that trade |

**Falsification test, and it is decision 1:** if the pilot vertical needs a
code branch, verticals are not configurations and this is five products. Stop
and re-plan rather than branch.

## Evidence base

Cited honestly, because two of the most-quoted statistics in this product
category do not survive checking.

**Speed to lead — strong mechanism, old studies.**
[HBR, "The Short Life of Online Sales Leads" (Mar 2011)](https://hbr.org/2011/03/the-short-life-of-online-sales-leads),
auditing 2,241 US companies plus 1.25M leads: firms responding within an hour
were **~7x more likely to qualify** a lead than those waiting two hours and
**60x more likely** than those waiting 24h+. **23% never responded at all**;
average response time among those who did was **42 hours**. The
[Oldroyd/InsideSales Lead Response Management study (2007)](https://www.leadresponsemanagement.org/lrm_study/)
adds the sharper figures: contact odds drop **100x** and qualification odds
**21x** between a 5-minute and a 30-minute response. Note for anyone repeating
it: this is routinely called "the MIT study" — it is vendor data analysed by a
researcher then at MIT Sloan, not an MIT publication. Modern replication:
[XANT 2021](https://www.prnewswire.com/news-releases/xant-releases-lead-response-report-with-data-from-55-million-sales-interactions-301230001.html)
across 5.7M leads found conversion **8x higher** inside 5 minutes, while
**57.1%** of first attempts happen more than a week after the lead arrives.

**Do not use "35-50% of sales go to the first responder", nor "78% buy from
the first responder".** Neither has a traceable primary source; every citation
chain ends in blogs citing blogs. Using them is a real credibility risk in
front of a sharp prospect, and the HBR/Oldroyd numbers carry the same argument
with actual methodology behind them.

**Follow-up cadence — medium.**
[Velocify's secret-shopper study (2014)](https://www.prnewswire.com/news-releases/velocify-study-reveals-sales-crm-users-fall-short-in-online-lead-response-270891471.html)
found sales teams averaging **1.45 calls and 1.56 emails per lead** against an
optimum nearer 6 calls and 5 emails; 13% of enquirers never heard from anyone.
XANT adds that attempts beyond ~20 hours start *reducing* odds — persistence
must be front-loaded. The German trade-press claims that 30-60% of quotes go
unanswered for want of follow-up are unsourced; treat as hypothesis.

**Reviews — the best-evidenced lever.**
[Whitespark's Local Search Ranking Factors](https://whitespark.ca/local-search-ranking-factors/)
puts review signals at **20% of local-pack ranking weight**, the second-largest
factor, and review **recency** jumped into
[the top five factors for 2025 from #20 in 2023](https://whitespark.ca/blog/the-most-underrated-local-ranking-factor-in-2025/).
[Sterling Sky's controlled tests](https://www.sterlingsky.ca/number-of-reviews-impact-ranking/)
found a ranking step at the **10-review threshold** and then a plateau. A
steady monthly trickle beats a large stagnant total — which is exactly what a
post-job review request produces.

**After-hours share and reactivation ROI: no usable data in any market.**
Every figure traces to AI-receptionist vendors. Instrument these in the pilot
rather than marketing them.

**Two source conflicts, recorded rather than resolved.** Independent research
passes disagreed on two facts, and both should be re-verified before anyone
relies on them. **(1) simap's API**: one pass verified `GET
/api/publications/v2/project/project-search` by direct anonymous call, with the
OpenAPI spec at `https://www.simap.ch/api/specifications/simap.yaml`; another
reported "no public API, email subscriptions only". The direct call is the
stronger evidence and this plan follows it, but confirm before scheduling work
against it. **(2) Buildigo**: one pass found it dissolved in October 2025 with
the domain redirecting to mobiliar.ch; another cited it as a live
Mobiliar-backed dispatch network. The liquidation record is more specific and
more recent, so this plan treats it as dead.

**Switzerland specifically: no credible data exists** on trade response rates.
Swiss figures in circulation ("62% of trade calls unanswered", "CHF 125 per
missed call") are reskinned US vendor content. Cite HBR/Oldroyd for the
mechanism and Aroundhome for the DACH proof — and treat the Swiss evidence
vacuum as a thing the pilot fills, because first-party Swiss numbers would be a
genuine marketing asset nobody else has.

## Vertical ranking — the research overturns the assumed pilot

The brief assumed fiduciaries. **The evidence says fiduciaries are the worst
fit of the set**, and that a renovation trade is the right pilot.

Cross-cutting market structure first, because it decides everything:

- **renovero.ch** (owned by localsearch) is the only real lead firehose in
  Switzerland: **~65,000 quote requests/year**, >4,000 executed jobs/month.
  Pricing is a **flat subscription** (CHF 499-2,099/yr, or ~CHF 209/month),
  **not cost-per-lead, with unlimited quotes**
  ([localsearch](https://www.localsearch.ch/en/renovero-bidding-subscription-for-tradespeople/)).
  That single fact is the wedge: when leads are unmetered, **speed wins the
  job, not ad spend**.
- **ofri.ch** is #2, caps a request at **5 quotes**, and its 2019 figures imply
  an **average job value around CHF 1,650**
  ([ofri](https://www.ofri.ch/ratgeber/handwerkerplattformen-in-der-schweiz-im-vergleich)).
- **buildigo.ch is dead** — Mobiliar exited, dissolved October 2025, in
  liquidation ([handwerker.ch](https://handwerker.ch/news/mobiliar-zieht-sich-aus-bauplattform-geschaft-zuruck-buildigo-wird-liquidiert/1856)).
  Do not model it, and note the orphaned demand it left behind.
- **Yarowa is the incumbent to position against**, not Buildigo: >1,000 vetted
  firms receiving insurer- and property-manager-originated jobs with in-platform
  quoting ([yarowa.com](https://www.yarowa.com/deutsch-ch/home/)). Our
  defensible territory is the **homeowner-originated web-form/email lead**
  Yarowa does not route.
- **local.ch / search.ch are directories**, not lead marketplaces.

Ranked:

**1. Kitchen & bath renovation (with Schreiner / Maler / Plattenleger).** Best
overall fit. Average ticket **CHF 22,000-28,000**
([daibau](https://www.daibau.ch/baukostenrechner/badsanierung),
[handwerker-kosten](https://www.handwerker-kosten.ch/kueche/)); the
highest-volume category on renovero and ofri; leads arrive by web form; scope
is templatable from photos plus m² for a credible draft that earns the site
visit; ~1,900 VSSM member firms averaging **12.3 employees**
([VSSM](https://www.vssm.ch/de/verband/zahlen-fakten)) plus ~1,900 SMGV
painter/plasterer firms; and Buildigo's death just removed a competitor.

**2. Heating & solar (heat pump, PV).** Highest ticket by an order of
magnitude — heat pumps **CHF 30,000-42,000**, PV **CHF 23,000-29,000** for a
typical 8-10 kWp system. Uniquely, **PV is already quoted remotely from roof
and location data** ([Helion's Solarrechner](https://www.helion.ch/de/solarrechner/)),
so "credible draft quote in minutes" is proven behaviour rather than a new
ask. Subsidy deadlines create natural follow-up hooks. Caveat: the top of the
market is industrialised — target the installer tail, not Helion.

**3. Movers.** The standout on *low digital maturity*. Tickets CHF
1,100-3,500; **video/WhatsApp surveys are already the norm** in place of a site
visit; Movu sends 5 quotes within 24 hours so minutes decide; and Movu's
reported **~30% commission** is a publicly aired grievance
([Tages-Anzeiger](https://www.tagesanzeiger.ch/preisdumping-wegen-movu-zuercher-umzugsfirmen-kritisieren-vermittlerin-488239022218))
that a direct-response agent sells against. Weakness: no reliable firm count,
and some jobs fall below CHF 1,000.

**4. Plumbers and electricians** as a combined installer wedge — good rates,
price-list-templatable small jobs, but bimodal tickets, much phone-based
emergency demand, and the lucrative property-manager channel already belongs
to Yarowa.

**Not recommended, with reasons:**

- **Fiduciaries — the assumed pilot, and the worst fit.** No marketplace and
  therefore almost no inbound lead volume, which starves an agent whose core
  value is response speed; the **highest digital maturity** of any vertical
  here (Bexio ~80,000 SMEs, Abacus ~40,000); and at least three funded AI
  incumbents already in the space (Accounto, Findea, Kontera). Their
  acquisition is referral and local SEO — a different product.
- **Garden maintenance** — CHF 80-120/h visits are far below the CHF 1,000
  bar. Only the design/build slice qualifies.
- **Self-storage** — **CHF 32/month average**. Recurring low-ticket rental,
  not quotable work. Wrong product shape entirely.
- **Roofers** — excellent ticket, but quoting effectively requires physical or
  drone inspection, and lead flow routes through insurers and property
  managers, i.e. Yarowa.

**Recommended pilot: kitchen & bath renovation, Romandie.** The FR platform
layer is smaller and more local than the DE one, so an FR-native agent meets
less incumbent competition — though no quantified FR/DE split exists for any
vertical, and obtaining one needs a direct BFS STATENT canton pull. That gap
is the biggest hole in the research and worth closing before scaling.

### The high-value verticals: economics beat the trades, fit does not

Three were raised as high-interest additions. All three have per-deal
economics that dwarf a bathroom. All three are **outbound-prospecting shaped**,
which puts them inside the legal constraint in risk 4 — and that, not the
economics, should decide their sequencing.

**Real estate (courtiers, régies) — on the research, the strongest challenger
to the pilot.** Commission is confirmed at **2-3%**, typically 3% in Romandie,
against a median single-family house near **CHF 1.27M** — so **CHF 25-40k
gross per closed deal**. The market is large and fragmented: SVIT/BFS count
**~22,400 brokerage and management firms**, 43% of them with 5-9 staff, and
~85% of sales still go through a broker. All four verbs map, and there is a
genuine hole to fill: **no Swiss incumbent was found doing instant
auto-response, SLA routing, or buyer-book matching** — Immomig, Casasoft,
RealAdvisor and PriceHubble own the plumbing but not the orchestration. Portal
leads arrive by email, which is exactly our ingest shape, and brokers are
publicly angry about SMG's portal price rises, which makes "raise the yield on
the listing you already paid for" an easy opening line.

**But the obvious FIND design is the one thing that is criminally sanctioned.**
Mandate prospecting means contacting private sellers who never asked to hear
from us — B2C, and squarely inside UWG art. 3(1)(o) and the 2021 art. 3(1)(u)
regime (risk 4). The listing supply is also concentrated: homegate,
ImmoScout24, anibis and tutti are all Swiss Marketplace Group, whose terms ban
scraping and the use of ad contact data for one's own advertising. So a real
estate v1 would have to be human-sends, postal, or inbound-opt-in **by
design** — which is buildable, but it is a different product from the one this
plan scopes. Clean targeting signals do exist without touching restricted
data: time-on-market is publicly derivable from listing age, and averages ~84
days for condos and ~79 for houses.

The **régie network effect** is real — régies dispatch maintenance to trades
firms — but that position is already contested by casavi/relay and by
Mobiliar-backed dispatch. The open slice is Romandie and the small-firm tail.
A reason to sequence the two adjacently later, not to start with the harder one.

**Architects: assessed and rejected for v1.** Two decisive findings. Bidding is
**week-of-work shaped, not quick-quote shaped** — a prequalification dossier
runs 20-60 senior hours and a full competition entry 300-800, all explicitly
unpaid — which is our stated weakness rather than our strength. And
response *speed is simply not a lever*: deadlines are multi-month and award
criteria are majority-qualitative. Worth noting for a different day: the SIA
102 percentage-of-construction-cost fee formula was withdrawn after a WEKO
intervention and the 2026 edition publishes no calculation method at all,
explicitly inviting third-party fee tools — a vacuum nobody has filled, and a
separate product rather than a vertical of this one.

**Insurance brokers.** A won corporate mandate is recurring commission for
years. The FIND thesis is the sharpest of any vertical: **Zefix/SHAB publish
new company registrations daily** — up to ~1,500 registry items a day — and a
new Swiss company with employees *must* buy occupational pension and accident
cover. That is a structurally excellent signal, and Zefix does offer a free
REST API (account by request to `zefix@bj.admin.ch`, listed on
[opendata.swiss](https://opendata.swiss/en/dataset/zefix-zentraler-firmenindex)).
But: its terms disallow systematic bulk extraction to build a competing
register, using registry data for unsolicited marketing collides with revDSG,
and the resulting outreach is precisely the UWG art. 3(1)(o) case. Add FINMA
registration duties for intermediaries. **The mechanism is beautiful and the
legal wrapper is the whole project** — it cannot be the pilot.

**IT consulting / consultant placement (Vaud, Léman arc).** Added last and, on
structure, the most interesting challenger to the recommended pilot:

- **The four verbs map unusually well.** FIND = open mandates matched against
  the firm's own consultant bench; BID = a tailored profile and pitch per
  mandate, where the first credible CV in front of the client wins — the same
  speed mechanic as trades, on a much larger ticket; RESPOND = inbound client
  enquiries; FOLLOW UP = bench-availability alerts to past clients ("X frees
  up 1 March"), contract-renewal timing, dormant reactivation. FOLLOW UP here
  is arguably stronger than in any other vertical, because bench availability
  is a *recurring, dated, naturally-occurring reason to make contact* — which
  is exactly what the legally clean form of outbound looks like.
- **B2B, not B2C**, which is a materially better legal position than real
  estate mandate prospecting, and existing-client bench alerts fall closest to
  the existing-relationship exception.
- **simap's IT lots are genuinely in scope** — placement contracts clear the
  CHF 250k threshold routinely, so the one platform with a sanctioned public
  API is actually useful here, unlike for a bathroom renovator.
- **Warm network.** The owner's home market has real placement-firm density,
  and a pilot customer reachable through a warm introduction removes the item
  that risk 9 names as the true critical path.

**Honesty flag: the placement economics in this section are unresearched.**
The web-research budget was exhausted before this vertical was added. The
claims that Swiss placement margins run 15-25% of day rate, that a placement
is worth tens of thousands, and that Vaud has meaningful firm density are
**plausible and unverified**. The structural argument above stands on its own,
but **before this vertical could displace the recommended pilot it needs the
same research pass the trades got** — mandate-flow channels, firm count, day
rates and margins, and what Swiss placement firms use today. That is open
question 9, and it is cheap to close.

## Today / Delta

Verified against `origin/main` plus merged PRs #1128/#1130/#1135/#1140/#1156.

### What the platform already gives us

- **Vertical agents are a ratified, costed recipe.**
  `docs/direction/DIRECTION.md` makes "vertical agent" the one product noun:
  **fleet seat + persona/knowledge package + its own landing page**. A
  *private* vertical agent (invite-only, hand-provisioned workspace) is
  **"fully operational today"** once the landing validation queue merges, and
  the first-agent gap list is costed at **3-8 PRs**, with the binding
  constraint named as "content and ops, not platform code". Each pilot
  customer is exactly one private vertical agent.
- **Knowledge packaging exists and is bounded.** #1168 (gh-1107 slice 2) puts
  `knowledge/` in the definition package: digest-covered, mounted as an
  agent-scoped readonly filesystem `agent_knowledge` with
  `provenance: 'agent-definition'`, at **256KB per file and 128 files**, with
  symlink and non-UTF-8 refusal. That is the vertical corpus mechanism, and
  its 128-file ceiling is a useful discipline (§8).
- **Fleet + landings + default agent**: `BORING_AGENT_FLEET` (#1114, merged),
  config-driven hostname landings (#1154, closed), per-workspace
  `default_agent_type_id` (#1156, merged), per-agent MCP grants (#1131).
- **Swiss models are wired.** `infomaniak` is a first-class OpenAI-compatible
  provider (`packages/agent/src/server/models/modelConfig.ts`), base URL
  `https://api.infomaniak.com/2/ai/<productId>/openai/v1`, registered models
  including `Qwen/Qwen3.5-122B-A10B-FP8` and `moonshotai/Kimi-K2.6`, keyed by
  `INFOMANIAK_API_TOKEN`. Verified CHF rates already recorded: Qwen3.5-122B at
  **0.40 in / 3.20 out CHF per MTok**, and because Stripe charges CHF and
  Infomaniak bills CHF, 1 credit-unit = 1 CHF with no FX.
- **The approval primitive is right, and already channel-agnostic where it
  counts.** `plugins/ask-user`: `AskUserQuestion` with lifecycle
  `ready|answered|cancelled|abandoned`, a 7-arm `AskUserField` union, and
  `HumanArtifact[] {id, surfaceKind, target, title}` hoisted to
  `packages/workspace/src/shared/artifacts/humanArtifact.ts`. Critically,
  `plugins/ask-user/src/server/questionsBridge.ts` exposes `handle(command)`
  with pluggable `getAuthContext`, allows `callerClassesAllowed:
  ["browser","server"]`, and authorizes by constant-time compare against a
  32-byte `answerToken` — **a capability, not an identity**. That is precisely
  what a signed link to a non-member's phone needs.
- **The channel design is ratified.** `docs/issues/1127/plan.md` (#1140)
  specifies `ChannelAdapter`, `ChannelBindingStore`, durable inbound dedupe
  and queue insert **in one sqlite transaction**, async webhook ack,
  per-binding serialized workers, durable-store tail with leased cursor CAS,
  WhatsApp dialect rendering with 4096-char splits, the 24h template fallback,
  and a fake-channel conformance harness. Decisions: **Meta Cloud API direct,
  no Twilio**; v1 in-process.
- **Durable substrate landed** — `SqliteEventStreamStore` with idempotent
  append, wired behind a flag (#1128).
- **Headless scheduled agent runs already work.** `plugins/boring-automation`
  is a shipped cron→agent pipeline on Postgres: croner scheduler, durable run
  receipts, idempotency by `invocationId`, claim/lease with heartbeat and stale
  reconcile, HTTP CRUD plus SSE, and an agent-callable `boring_automation`
  tool. In hosted mode an agent runs daily with nobody in the workspace. This
  is the backbone for FOLLOW UP and, later, for scheduled FIND.
- **A share seam exists** — `shareResourceUri(id) => "share:///<id>"` over
  `ShareEntryV1`, resolved live with membership checked before any stat so
  there is no existence oracle; deep-link route `GET /a/:id`.
- **The app is portable and Postgres-backed** — reference Dockerfile
  (`web-runtime`/`worker-runtime`, uid 10001), drizzle + postgres-js, 25
  migrations, advisory-locked, with an `additionalMigrations` seam.
- **The Exoscale operational pattern is proven** (#1126): a root-owned
  loopback daemon shelling to `exo` under a default-deny IAM role scoped to
  one instance UUID, credentials never reaching the app, behind a
  provider-neutral `LifecycleClient`.

### What does not exist

- **No email reading of any kind.** `packages/core/src/server/mail/transport.ts`
  is outbound SMTP/Resend for auth mail only. No IMAP, no MIME parsing, no
  threading, no sync cursor. `~/projects/boring-mail` is a **mock** —
  hardcoded threads, `.mail.md` draft files, `src/storage/sqlite.ts` returns
  not-implemented. Salvageable: the draft-file format, domain types (missing
  `messageId`/`inReplyTo`/`references`, so threading needs extension), pure
  filter helpers, and `mailAgentTool.ts` with its path-traversal guard. The
  protocol half is entirely new.
- **No inbound mail receiving.** Rung 1 of the trust ladder (§7) needs an MX.
  We have never received an email.
- **No channel code at all.** #1127 is design-only and, per the 2026-08-08
  direction ruling, **deprioritized**. This plan is the named consumer that
  would revive it.
- **The share seam is not shareable.** No expiry, no signature, no capability
  token, and `InMemoryShareEntryStore` is the only implementation. Access is
  same-workspace membership only.
- **No notification delivery abstraction.** `AskUserStatePublisher` targets a
  workspace `UiBridge`; grepping `plugins/ask-user` and
  `packages/workspace/src` for `slack|notifier|notificationChannel` returns
  zero hits. This, not the answering path, is the real ask_user gap.
- **`FileAskUserStore` is a JSON file** at `<workspaceRoot>/.boring/ask-user.json`.
- **One pending question per session** (`PENDING_EXISTS`), plus 6/session/min
  and 30/principal/hr rate limits — load-bearing, see §6.
- **No Gmail toolkit configured.** Composio (`plugins/boring-mcp`,
  `composioManagedConnector.ts`) is wired to Notion and Airtable only.
- **No web tooling and no browser automation** — see §(a2). No fetch tool, no
  search tool, no HTML parser, no SSRF guard, no way to store or deliver a
  customer's third-party site credentials.
- **No CH deployment, no FR/DE presets, no quote templates, no price book.**

## The five capability slices

### (a) Email ingestion — the trust ladder

**Today:** nothing (above).

**Delta:** deliberately *not* "ask for the mailbox". Email access is the
touchiest step in the entire product, so it is a ladder, and rung 1 asks for
no credentials at all.

**Rung 1 — forwarding, zero credentials. The v1 default.** The customer adds
one auto-forward rule for their *lead* addresses only (`info@`, `devis@`,
`offerten@`, or the address their marketplace alerts arrive at) pointing to a
dedicated ingest address we own, e.g. `mueller-gartenbau@in.example.ch`.
Properties that make this the right first rung:

- **nothing to install, no password ever handed over**;
- **revocable by deleting one rule** — the customer keeps control visibly;
- **scoped to leads, never the whole mailbox** — and that scoping *is* the
  privacy story, especially for any vertical handling client-confidential mail;
- it works identically across every mail provider, which matters because Swiss
  SMBs are not concentrated on Google or Microsoft the way US SMBs are.

The clean implication: **we own and host the destination mailbox in
Switzerland, and poll it by IMAP with our own credentials.** No customer
credential exists anywhere in the system at rung 1, and the residency story is
intact because the mailbox is ours and Swiss.

**Receiving it is not free, and no SaaS solves it.** SendGrid Inbound Parse
uses one global MX with no region control; Cloudflare Email Routing runs on an
anycast edge with no documented processing location; Mailgun Routes are
region-bound but EU, not CH. **Every inbound-parse service breaks the
residency claim.** So: for the pilot, one Swiss mailbox with catch-all on
`in.<domain>.ch` polled by IMAP, with the customer extracted from
`To`/`Delivered-To`; at scale, Postfix on a CH VM delivering by LMTP straight
into the parser. Two facts to confirm with one email each before committing:
inbound port 25 reachability on the chosen CH provider, and Infomaniak's
catch-all support and alias limits.

**Provider reality, and it is the biggest threat to the 30-minute promise.**
There is no authoritative survey of Swiss SMB mail hosting; the best proxy
([BuiltWith MX detections for Switzerland](https://trends.builtwith.com/mx/country/Switzerland))
puts Microsoft first, **Infomaniak a strong second (~180k detections)**, then
Google. Roughly: M365 30-38%, Infomaniak 18-25%, Hostpoint 8-12%, Google
7-11%, cyon 3-6%. Note Swisscom is mostly a channel *for* M365, and Infomaniak
likely leads micro-business in Romandie — our recommended pilot region.

Forwarding difficulty runs in almost exactly the wrong order:

- **Infomaniak and cyon: trivial.** Webmail → Redirections → Add, with a
  keep-a-copy toggle and no verification.
- **Hostpoint: awkward** — needs the *hosting* login, which in many SMBs sits
  with their web agency.
- **Gmail: a confirmation code.** Google emails a code to the destination
  before a rule activates, and the Gmail API does not skip it
  (`forwardingAddresses.create` returns `pending`). Our ingest mailbox must
  watch for `forwarding-noreply@google.com`, extract the code and post it back
  — a 1-2 minute async step we should automate rather than ask the customer to
  relay. Workspace admins can bypass it entirely via Gmail routing rules.
- **Microsoft 365: blocked by default, and it fails silently.** Per
  [Microsoft Learn](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-policies-external-email-forwarding),
  the outbound spam policy's default "Automatic — System-controlled" now
  behaves as **off**. The owner sets forwarding in Outlook, sees "Saved", and
  mail bounces with `5.7.520 Access denied`. Fixing it means the *Defender*
  portal — a different admin surface — and where one control allows while
  another blocks, **block wins**, so relaxing Remote domains alone still
  fails.

**The strategic consequence is uncomfortable and worth stating: our largest
segment has the worst rung-1 experience, and it fails in the most confusing
possible way.** Detect the provider from the domain's MX during signup and
route M365 customers into a purpose-built admin script rather than letting
them stall. That script deserves more product investment than the other four
providers combined.

**And the ladder's rungs do not line up with the market either.** The Swiss
hosters that make rung 1 easiest — Infomaniak, cyon, Hostpoint — have **no
OAuth and no message API at all**, so rung 2 there means asking a Swiss SMB
for a raw mailbox password that can also *send* and whose only revocation is a
password reset that breaks all their other clients. Infomaniak is the one
Swiss hoster offering **app-specific passwords**, which is the sole civilised
option in that group. Google and Microsoft do have proper OAuth read scopes,
but Google's restricted scopes require verification plus annual CASA Tier-2
review (weeks and real money).

**Therefore, a sharper position than r2 took:** treat rung 1 as the
**permanent default**, not a stepping stone, and offer rung 2 only to Google
and Microsoft tenants where OAuth makes it defensible. That is a better
product *and* a better privacy story than the ladder implied.

Replies at rung 1 are **drafts delivered to WhatsApp**; the owner sends from
their own client, or approves and we send from a clearly-labelled assistant
address with `Reply-To` set to them.

**Rung 2 — read-only mailbox access, after trust is earned.** OAuth read scope
where it exists (Google, Microsoft); IMAP with an app-specific password where
it does not (Infomaniak, Hostpoint, cyon). This buys full-inbox awareness so
follow-ups catch threads the forward rule missed. State the risk honestly: an
IMAP app password is broader than an OAuth read scope, and we should say so
rather than pretend they are equivalent.

**Rung 3 — send-as their own domain.** Naturally bundled with landing-page
onboarding, since that is when we touch their DNS anyway. Three findings that
change how to build it:

- **Never touch their apex SPF.** [RFC 7208 §4.6.4](https://datatracker.ietf.org/doc/html/rfc7208#section-4.6.4)
  caps SPF at 10 DNS lookups and mandates `permerror` beyond it. A typical
  Swiss SMB is already at 7-9 (`spf.protection.outlook.com` ≈2-3, hoster ≈1-3,
  plus booking and newsletter tools). Worse, the failure can be
  **intermittent**, because evaluation stops at the first match — so adding our
  include can break *their existing mail* for *some* receivers in a way that
  looks unrelated to us. **Rely on aligned DKIM alone**: DMARC needs only one
  aligned identifier. Delegate DKIM by CNAME so key rotation never touches
  their zone again.
- **Aligned DKIM is mandatory, not optional**, and for a specifically Swiss
  reason: **DKIM survives forwarding and SPF does not**, and this market
  forwards constantly. Check `_dmarc` for `aspf=s`/`adkim=s` before designing
  each customer's sending identity, and remember subdomains inherit the apex
  policy via `sp`.
- **Rung 1 sending is good enough to keep permanently.** Sending from our own
  domain with `Reply-To` set to the customer needs zero customer DNS and
  aligns automatically. Its real costs: `Reply-To` is advisory, so budget for
  stray replies (especially Reply All); **do not put the customer's company
  name as the display name over our address** — that is precisely the pattern
  Defender impersonation protection and Gmail display-name checks target; and
  aggregating many customers onto one domain means one bad actor damages
  everyone's reputation. Use **per-customer subdomains** on our domain, and
  enrol in Postmaster Tools and the Yahoo FBL on day one.

**Composio Gmail is explicitly not the default.** It would route a Swiss
customer's client correspondence through a US managed connector, contradicting
the one thing we sell; our own preflight
(`plugins/boring-mcp/docs/composio-security-preflight.md`) has a residency and
subprocessor line item we would have to mark "accepted gap" in front of the
exact buyer who cares. It stays an opt-in accelerator for prospects who do not
care about residency.

### (a2) FIND and BID — the differentiator, and the honest constraints

**Today, on our side: worse than expected.**

- **There is no web tool at all.** No `web_fetch`, no `web_search`, no HTML
  parser (`cheerio`/`jsdom`/`readability` all absent). The pi SDK ships
  `bash, edit, find, grep, ls, read, write` and nothing else. The only route to
  the internet is `bash` → `curl`, with the model parsing raw HTML. **There is
  also no SSRF guard, no allowlist, no private-IP block** — the only network
  control is sandbox-level, and `local` (bwrap) runs with `--share-net` by
  default. A host-proxy web tool is *designed* (Tavily/Firecrawl in
  `docs/issues/820/byok-secret-vault-plan.md`, bead `16f.5`) and unbuilt.
- **There is no browser automation of any kind.** All Playwright in the repo
  is CI/e2e tooling. The only agent↔browser surface is the UI bridge, which
  posts commands into the user's already-open workspace — it cannot launch a
  browser, navigate, or fill a form on an external site.
- **We cannot hold a customer's site credentials.** The credentials vault is
  partly built (`packages/agent/src/server/credentials/`, real AES-256-GCM
  envelope crypto) but has **no non-test caller, no route, no UI, no table**,
  and `sandboxDelivery.ts` is an explicit stub that throws `DELIVERY_FORBIDDEN`
  — by design, no secret can reach the sandbox today. The BYOK plan also
  **bars tenant-authored providers and arbitrary egress**.

**Today, one genuine asset:** `plugins/boring-automation` is a **real, shipped,
Postgres-backed cron→agent-run pipeline** — croner scheduler, durable run
receipts, idempotency by `invocationId`, claim/lease with 30s heartbeat, stale
reconcile, and an agent-callable `boring_automation` tool. An agent can run
daily with nobody in the workspace. **The scheduling half of "hunt for jobs
every morning" is done; the web-touching half is entirely absent.**

**Today, on the platforms: the research is unusually clear.**

- **simap.ch (public procurement) has a live, public, unauthenticated REST
  API** — verified by direct call, returning today's tenders.
  `GET /api/publications/v2/project/project-search`, spec at
  `https://www.simap.ch/api/specifications/simap.yaml`, with exactly the
  filters this product needs: `bkpCodes`, `npkCodes`, `cpvCodes`,
  `orderAddressCantons`, `newestPublicationFrom`. Official "Suchabo" email
  alerts exist, historically with an **XML variant for professional
  providers**. Electronic bid submission has existed since Release 1.2 but was
  only **~35% of offers as of April 2026**, and whether third parties may
  submit via API is unverified.
  **The strategic caveat matters more than the API:** Swiss thresholds mean
  work below CHF 150-300k (Baunebengewerbe/Bauhauptgewerbe) goes *freihändig*
  or by invitation and **is generally not published on simap at all**. So
  simap covers the large-contract slice — real for placement, architects and
  larger installers; mostly irrelevant to a bathroom renovator.
- **No private Swiss lead marketplace publishes an API.** None. Across roughly
  thirty platforms checked.
- **Several explicitly forbid automation.** Ofri's AGB §8.1: *"Der
  automatisierte Zugriff auf die Plattform, beispielsweise mit Bots, Skripten
  oder vergleichbaren Mitteln, ist untersagt."* localsearch/search.ch bans
  crawler and scraper use and commercial data extraction. **Olmero and buildup
  go further** — robots.txt explicitly disallows ClaudeBot, GPTBot, CCBot,
  Google-Extended and others, with an EU-DSM Art. 4 rights reservation, and
  Cloudflare enforces it with 403s.
- **But the platforms email the tradesperson.** Ofri: *"Wir benachrichtigen
  Sie per E-Mail über neue Aufträge."* Houzy mails leads directly. Olmero
  ships "Push-Mail" as a product feature. **That is the answer:** the agent
  reads the customer's own notification inbox — unambiguously the customer's
  own mail, covered by no scraping prohibition, and already built as rung 1.
- **Renovero is the highest-value open question.** Best economics of any
  platform (flat fee, unlimited bids, ~5,000 requests/month, DE/FR/IT), but
  whether it emails on new matching requests is unverified. **Resolve it with
  a real paid account before committing to the pilot vertical's channel mix.**
- **No platform accepts a quote by email.** Every private marketplace requires
  submission in a logged-in dashboard. So BID against them means authenticated
  browser automation acting as the customer — a subsystem we do not have, using
  credentials we cannot yet store.

**Delta, and the resulting architecture:** two connectors, no scraping.

1. **One API connector for simap** — sanctioned, filterable, free.
2. **One email-ingestion pipeline** parsing the customer's own alert mails
   from ofri/houzy/olmero/renovero, reusing the rung-1 forwarding pipe already
   built for RESPOND. A new marketplace becomes a parser, not a project.
3. **Scheduled by `boring_automation`**, which already exists.
4. **BID stays human-completed in v1**: the agent drafts the offer, the owner
   approves it in WhatsApp, and the owner pastes and submits. Unsatisfying,
   but it ships, it breaks no ToS, and it needs neither browser automation nor
   credential storage. Automated submission is a later, separately-gated
   decision — and simap's `digital-submissions` endpoint is the only path
   where it might ever be sanctioned rather than tolerated.

### (b) WhatsApp channel

**Today:** ratified design (#1140), zero code, deprioritized. Substrate on main.

**Delta:** build #1127 slices 1a, **1c** and 2 — but this product needs
materially less of the conversational surface, because **the identity model
inverts**. In #1127's client-channel framing the external sender is a client's
team member: many unknown senders, per-agent grants, rejection UX, session
rotation. Here the sender is **the business owner**, and under the 2026-08-11
WhatsApp-native identity ruling (§ Onboarding, and #1127 §6.6) **the owner's
phone number IS their account** — a first inbound from a new number is
**SIGNUP** (creates account + workspace + agent), not a silent drop. So this
product **needs #1127 slice 1c** (phone-identity provider + magic-link
web-auth) as a first-class dependency, not just the outbound notification path.
What still deletes: per-agent grants (the binding *is* the grant) and
multi-agent routing (one owner, one workspace, one agent). The
"drop unbound numbers silently" posture applies only *after* signup — i.e. to
numbers we choose not to onboard, not to first-contact.

Adopted verbatim because it is right and hard-won: signature verify
(`X-Hub-Signature-256`) plus handshake before any parsing; **durable dedupe
and queue insert in one transaction** (Meta retries for hours; a crash between
two writes eats the message forever); ack 200 immediately and drain
asynchronously; at-least-once outbound, since send precedes cursor CAS and
WhatsApp has no send idempotency key; dialect rendering and 4096-char splits;
the single pre-approved template for the lapsed 24h window; the fake-channel
harness so CI proves the loop without Meta credentials.

**Not needed for the MVP: #1127 slice 1b** (the durable-tail turn assembler),
which that plan's own review isolated as the risk centre — because MVP
WhatsApp traffic is notification-out plus a tap, not a streamed conversation.

### (c) The draft loop — approval by the business owner

**Today:** the primitive and the answering seam both exist (above).

**Delta:** the approver changes identity. Everywhere so far, the human
answering an ask_user is the workspace operator — us, or a technical user.
Here it is a tradesman holding a phone on a building site. That reframing is
the design work:

- an intention must be legible in three lines: who wrote in, what they want,
  what we propose to answer, what we propose to charge;
- affordances collapse to **approve / edit / reject**;
- the artifact points at the source thread, so "show me the actual email" is
  one tap;
- **nothing is ever auto-sent.**

**A constraint that shapes the loop:** `AskUserRuntime` enforces **one pending
question per session**. A Monday morning is fifteen leads, not one. Two
options: **(i) one session per lead thread**, so each holds its own intention;
or **(ii) a queue in front of one session**, presenting drafts one at a time.
**Recommendation: (i)** — it needs no new machinery, and (ii)'s serialisation
is exactly the friction we sell against. The notification side must then
batch: one message saying "8 drafts ready", never eight messages.

MVP shortcut: **approval happens in a link-opened view, not inside WhatsApp.**
WhatsApp carries the notification and the link; the tap opens a mobile-legible
approval view authorized by the question's own `answerToken`; the send happens
there. The owner needs no account and no session, because the capability *is*
the URL. This routes around both #1127 slice 3 (channel answering) and slice
1b. Two-way WhatsApp approval is a good v2, not a blocker.

What is genuinely new is small: a **notification delivery abstraction** off
`AskUserStore.subscribe()`, with WhatsApp as its first implementation.

### (d) Artifact drop

**Today:** `shareResourceUri` + `ShareEntryV1` + `GET /a/:id`, deliberately
minimal.

**Delta:** everything that makes a link openable by a non-member — a durable
share entry store; a **capability token** carrying entry id and expiry; expiry
and revocation (the `ok | not_found | tombstoned` shape already exists, the
lifecycle does not); and an unauthenticated read path returning byte-identical
responses for expired, revoked and never-existed, preserving the existing
no-existence-oracle discipline.

**Share link first, PDF second.** A link is one signed URL and a mobile render;
a PDF is a rendering pipeline, a fonts problem, a storage problem and a Meta
media-upload problem, and it yields a document the owner cannot act on. Caveat
to state plainly: a capability URL in a WhatsApp thread is forwardable, so
expiries are hours not weeks, and anything genuinely confidential stays behind
workspace auth.

### (e) CH deployment

**Today:** Infomaniak models wired and CHF-billed; app Dockerized on Postgres;
Exoscale pattern proven — **but in `at-vie-2`, Vienna, Austria, not
Switzerland.** Exoscale has CH zones (`ch-gva-2`, `ch-dk-2`); we have simply
never used one. And since #853 this repo owns **no deployment config** at all
— Fly files, self-host image workflow and `docs/deployment/**` were
deliberately deleted, `hachej/seneca` is the canonical deployment, and the
runbook now lives in
`.agents/skills/boring-app-setup/manuals/providers/PROVIDER_SNIPPETS.md`.

**Delta** — a topology we can put in writing:

| Component | Where | Status |
| --- | --- | --- |
| App container | Exoscale `ch-gva-2` or Infomaniak Public Cloud | new provider entry in the runbook |
| Postgres (25 migrations) | CH managed Postgres, same zone | new |
| Ingest mailboxes | CH mail hosting we own | new |
| Event store / bindings / share entries | app volume, CH | new; sqlite-shaped, see risk 7 |
| Session transcripts | `/data/pi-sessions`, CH | pattern exists |
| LLM inference | Infomaniak (CH) | **already wired** |
| Agent sandbox | **must not be `vercel-sandbox`** | see below |
| WhatsApp transport | Meta (non-CH) | see risk 1 |

**The `vercel-sandbox` landmine.** The reference Dockerfile's production
default is `BORING_AGENT_MODE=vercel-sandbox` — US-operated compute, in the one
deployment where that is a selling failure. A CH deployment must explicitly set
a non-Vercel mode, as a hard gate in the checklist rather than a note.

Two Infomaniak gotchas for the runbook, both already learned painfully: pi
resolves the API key via `process.env[name]` **without stripping `$`**, so a
`$`-prefixed value becomes the literal bearer token and 401s; and
`supportsDeveloperRole`/`supportsReasoningEffort` are both `false` because the
endpoint 400s on the `developer` role.

**Sandbox deferred deliberately:** this agent drafts text and fills templates.
It does not execute code. Ship without agent sandboxing; revisit only if a
vertical needs it.

## Onboarding — WhatsApp-native, under 30 minutes, nothing installed

A product requirement, and the onboarding slice is designed to this number.

**Signup is WhatsApp-native (owner ruling, 2026-08-11).** The funnel is: the
vertical landing page → a **`wa.me/<seneca-number>` click-to-chat button** →
**conversational signup inside WhatsApp**. The customer's **phone number is
their account identity**: their first message from a new number creates the
account + workspace + agent, keyed to that number, and the bot onboards
conversationally. **No email, no password, no web form.** Auth factor = control
of the WhatsApp number (proven by messaging from it). When the full web
workspace is needed, the bot sends a **magic link over WhatsApp** (one-time,
short-TTL, signed, bound to the phone-account) that establishes a web session;
phone OTP is the documented fallback. This reuses the #1211 WhatsApp-native
identity model verbatim (see `docs/issues/1127/plan-whatsapp.md` §6.6) —
**one Seneca number, multi-tenant by sender, no Embedded Signup, no
per-customer OAuth**.

**This is a small extension of existing better-auth, not new auth code
(verified 2026-08-11).** boring-ui core already runs better-auth with Google +
GitHub OAuth + email/password and the **magic-link plugin already wired**
(`packages/core/src/server/auth/createAuth.ts:127` mounts
`magicLink({ sendMagicLink })`; `src/front/auth/authClient.ts:2,17` registers
`magicLinkClient()`; `src/server/app/capabilities.ts:74` exposes the
`magicLink` capability). So: (1) WhatsApp/phone is **identity provider #4** on
the existing provider-agnostic user model — not a new system; (2) "magic link
over WhatsApp" = wiring the existing `sendMagicLink` (today it renders to email
via `transport.send`) to a **WhatsApp delivery adapter** that sends the *same*
better-auth token URL over WhatsApp — no new token/redeem/session code; (3)
phone verification comes free from the channel itself (an inbound proves number
control), with better-auth's `phoneNumber` OTP plugin as the alternative.
(External validation: getnao/nao runs the same better-auth linked-identity model
with `accountLinking` — `scratchpad/getnao-auth-study.md`.)

**Progressive email — do not require email at signup (owner ruling).** Phone is
the only identity at signup; email is collected **progressively
in-conversation** at natural value moments (first quote, first web access) and
is **effectively required at first payment** (invoices, receipts, Swiss
business records). Email + phone become **linked identities on one better-auth
account** — `accountLinking` makes "add email later" native, no migration.
Email's roles: recovery (number-recycling risk), billing, cross-channel
notices. This is an identity trust-ladder, parallel to the email-*access*
trust-ladder in §(a).

**Two doors, one account.** Support both **Flow B** (WhatsApp-first signup →
magic-link web, the trades default) and **Flow A** (web-first → link WhatsApp
via a regenerable linking code, nao's pattern). Convergence rule: always link
into the current session; a simple **v1 claim/merge** flow (detect + verify-to-
link, no fuzzy matching) handles the case where the same person independently
created a phone account and an email account. Invariant: one better-auth user,
N linked identities, reachable via either door. Web-session magic links use
better-auth's single-use `verification` token, never the reusable linking code.
Full model in #1211 §6.6.

```txt
 1. tap wa.me link, send first message         ~1 min   phone = account identity
                                                         (creates account+workspace)
 2. conversational signup in WhatsApp           ~3 min   no email, no password, no form
 3. add ONE forwarding rule                    ~10 min   guided, per-provider,
                                                         with screenshots
 4. paste price list / last 3 quotes            ~8 min   becomes the price book
 5. confirm trade, region, capacity             ~2 min   the signal filter
 6. live — first draft on the next lead
```

**This REPLACES the email-forward-rule as the OWNER onboarding path.** The
owner no longer signs up via email; they sign up by texting our number. Email
forwarding (step 3, rung 1) is **not** how the owner establishes identity — it
stays relevant only for **ingesting the owner's own inbound LEADS** later (the
RESPOND/FIND pipe, §(a)). Keep that distinction explicit: *owner identity =
WhatsApp; lead ingestion = forwarding.* Two different concerns that happen to
both touch email/WhatsApp.

Everything else is progressive and post-value: OAuth (rung 2), send-as
(rung 3), marketplace accounts for BID, the customer landing page (delivered
within days, not during signup). The 30-minute clock stops at "live", not at
"fully configured".

**Step 3 is the whole risk.** Detect the provider from the domain's MX at
signup and branch: Infomaniak and cyon customers finish in two minutes; Gmail
customers hit the confirmation code, which our ingest mailbox consumes
automatically; **M365 customers cannot complete step 3 at all** without a
Defender-portal change, and will otherwise believe they have succeeded while
mail silently bounces. For them, either walk their admin through it live, or
be honest that onboarding takes a day. Do not let the 30-minute promise turn
into a broken first impression for the largest segment of the market.

## The per-vertical kit and its content pipeline

Each vertical ships as a package, produced by the factory, not by engineering.

**Knowledge corpus.** A curated set of `knowledge/` files on how to win work in
that trade: quoting norms and CH price bands, speed-to-lead and follow-up
cadence, platform-specific tactics, review-generation playbooks, seasonal
patterns, objection handling, FR/DE terminology. This rides #1168's mechanism
exactly — digest-covered, agent-scoped, readonly — and inherits its **128-file,
256KB-per-file ceiling**, which is a feature: it forces curation and forbids
dumping a scrape into the package.

**The pipeline, as a repeatable factory process:**

1. **Harvest** — research workers per vertical gather sources.
2. **Filter for Swiss reality** — the single most important step. Most
   "get more clients" content online is US-centric and actively wrong here:
   different platforms, different price levels, different consumer norms, and
   a legal regime (§9) that forbids tactics that are routine in the US. A
   distillation that imports US sales-blog advice would make the agent sound
   foreign to the buyer, which in these trades is disqualifying.
3. **Distil with mandatory source citations** — every normative claim in a
   knowledge file carries its source. No invented price norms, ever: a
   fabricated price band would flow straight into a customer's quote.
4. **Editorial pass by a native FR or DE speaker** — trade vocabulary
   (*métré*, *régie*, *Regiearbeit*, *Akontozahlung*) is where a wrong word
   loses the sale.
5. **Refresh quarterly**, with the digest making staleness visible.

**Effort estimate: roughly 3-5 factory days per vertical** for the first
corpus, less on refresh — dominated by steps 2 and 4, which are judgement, not
generation. Budget the editorial pass explicitly; it is the step most likely to
be skipped and the most expensive to skip.

**Two landing pages per vertical, and they are different things.** The
**vertical LP** is ours, one hostname per trade, selling the offer — built with
the `AGENT_LANDING_ROUTES` recipe. The **customer LP template** is the family
we instantiate per customer at onboarding, on their brand and domain. Confusing
them would be an expensive mistake in the roadmap.

## MVP — one pilot customer

Scoped so a real Swiss renovation firm uses it daily, and so nothing on the
critical path is a component #1127 flagged as its risk centre.

**In:**

1. **Rung-1 email ingest**: a CH mailbox we own, forwarding rule, IMAP poll
   with our own credentials, threading, idempotent upsert.
2. **The renovation preset** — FR `instructions.md`, quote templates and price
   bands taken from the pilot customer's own past quotes, first knowledge
   corpus.
3. **RESPOND**: draft reply plus draft quote per lead, one session per thread,
   as an ask_user intention carrying the source thread as a `HumanArtifact`.
   Leads arrive from three sources through one pipe — direct enquiries, the new
   landing page's form, and **marketplace alert emails** the customer already
   receives from Ofri/Houzy/Olmero (and renovero, pending open question 10).
4. **Approval view** reachable by an expiring capability link, submitting
   through `questionsBridge.handle` as a server caller.
5. **WhatsApp outbound notification**, batched — #1127 slice 1a narrowed to a
   single provisioned binding, plus the send half of slice 2, plus the
   notification abstraction.
5b. **WhatsApp-native signup** — #1127 slice 1c: the owner's first inbound to
   the Seneca number creates their account + workspace + agent (phone = account
   identity), conversational onboarding in the thread, and a magic link over
   WhatsApp for web workspace access. This REPLACES email-based owner signup;
   there is no email-forward fallback for establishing identity.
6. **FOLLOW UP v1**: a cadence on unanswered quotes and a post-job review
   request. Cheap, and it carries the best-evidenced lever we have.
7. **CH deployment**: Exoscale CH zone, CH Postgres, Infomaniak models,
   non-Vercel sandbox mode.
8. **The customer's landing page**, with its form wired into RESPOND.

**Deliberately out of the MVP: automated FIND and BID.** This is the plan's
sharpest recommendation and the research hardened it into a near-certainty.
Automated FIND would need a web-fetch tool, an HTML parser and an SSRF guard —
none of which exist. Automated BID would additionally need browser automation
(absent) driving a customer's marketplace login (unstorable: the sandbox
credential delivery path throws by design). Meanwhile Ofri's AGB bans bots
outright and Olmero blocks our crawler at the edge.

**But the MVP gets most of FIND's value for free anyway**, because the
marketplaces email the customer. Ofri, Houzy and Olmero all send lead
notifications to the tradesperson, and rung-1 forwarding already carries them
into the same pipeline as their direct enquiries. So the MVP does not "skip
FIND" so much as implement its defensible 80%: **every lead that reaches the
customer's inbox — direct, from their new landing page, or from a marketplace
alert — gets the same minutes-fast draft.** What waits for v2 is *proactive*
hunting on sources the customer is not already subscribed to, plus automated
submission.

Also out: inbound WhatsApp commands, channel-side answering, PDF generation,
other verticals, German variants, multi-mailbox, accounting integrations,
sandboxing, per-agent grants.

## Unit economics — price against one won job

**Value.** The pilot vertical's average ticket is **CHF 22,000-28,000**. Swiss
gross margins on renovation work of 15-25% put contribution per job in the
**CHF 3,500-7,000** range. So the question is not "how many hours does this
save" but **"does this win one extra job per year?"** — and on the HBR
mechanism, applied to a firm currently answering some leads on Thursday, one
extra job a year is a low bar. One extra job a *quarter* is the realistic
target and it is 15-25x the annual price.

**Cost per customer per month.** Inference is the surprise: at Infomaniak's
verified 0.40/3.20 CHF per MTok, a drafting turn of ~10k in / 2k out is about
**0.01 CHF**, so 300 drafts/month is **~3 CHF**. WhatsApp utility templates in
Europe are cents and service replies inside the 24h window are free — single
digits. Hosting amortises to tens of CHF shared, ~100 CHF single-tenant. **The
dominant cost is human: onboarding, the landing page, and the corpus.**

**Price.** Anchor on the won job, not on hours. **CHF 500-600/month** is the
defensible list price: against a CHF 3,500-7,000 contribution per job, it pays
for itself if it wins **one extra job every 12 months**, which is an easy
sentence to say and an easy one to believe. Below CHF 300 we cannot afford
onboarding; above CHF 800 we are competing with hiring a part-time
administrator, a fight not worth picking.

**Setup fee: CHF 500-1,500**, covering the landing page — and the landing page
is what makes the setup fee feel like a purchase rather than a toll. It also
covers CAC honestly.

**Pilot recommendation: CHF 500/month from month one, setup waived, 3-month
term, cancel anytime**, in exchange for a reference and the right to use their
anonymised quote templates as the vertical baseline. **Charge from day one** —
a free pilot is not used, and an unused pilot teaches nothing. The waived setup
is the concession; the monthly is not.

**Instrument from day one**, because the Swiss evidence vacuum is fillable and
first-party numbers would be a marketing asset nobody else has: leads received,
time-to-first-draft, time-to-sent, quotes sent, quotes won, value won, and the
share of leads arriving outside business hours.

## Risks and honesty

1. **WhatsApp transits Meta.** The channel is not Swiss and cannot be made
   Swiss. Say it first, before the buyer finds it: *storage, processing and
   inference are in Switzerland; WhatsApp messages pass through Meta, which is
   why we send only notifications and links over WhatsApp, never client data or
   documents.* That constraint is also a design rule — it is why §(d) puts
   content behind a link. Buyers who cannot accept it get an email-and-web
   variant.
2. **Email mishandling is the existential trust risk of this product.** The
   standing rules, which must be demonstrable rather than asserted:
   **read-only by default; leads-scope only, never the whole mailbox; CH
   storage; deletion on request; and never auto-send.** Rung 1 is designed so
   that at the moment of maximum customer suspicion — signup — we ask for a
   forwarding rule rather than a password.
   **The DPA is a sales accelerator, not a blocker.** Under revDSG art. 9 we
   are an *Auftragsbearbeiter*: a contractual basis is required in substance,
   but Swiss law imposes no written-form requirement and no mandatory clause
   catalogue; sub-processors need prior authorisation, which can be general.
   GDPR's fuller art. 28(3) set applies whenever the customer targets EU
   prospects, which is common — so publish one GDPR-shaped DPA with a Swiss
   annex, bilingual DE/FR, plus a sub-processor list and a TOM annex. Flag in
   Annex 1 that inbound email is *uncontrolled input* and may contain sensitive
   data.
   **The one clause that decides deals is the LLM sub-processor** — sending a
   customer's client correspondence to a US model is an art. 16 disclosure
   abroad and an art. 9(3) sub-processor needing their authorisation. Our
   Infomaniak choice **moots the entire objection**, which is worth
   recognising as a commercial asset and not merely a residency preference.
   Have a Swiss data-protection lawyer sign off the template.
3. **Quote liability.** A wrong number in a quote is real financial exposure.
   Everything is a **draft**; a human sends. The agent proposes inside the
   owner's own price bands and flags anything outside them rather than
   guessing. Terms must state the customer is responsible for what they send.
4. **The legal split between the four verbs — the most important item here,
   and worse than r2 assumed.** RESPOND and FOLLOW UP operate inside an
   existing or customer-initiated relationship and are legally unremarkable.
   **Automated cold outbound is close to prohibited.**
   - **UWG art. 3(1)(o)** makes mass electronic advertising unfair unless
     prior consent, correct sender identification and a free opt-out are *all*
     present; it **applies to B2B**; breaches are criminal on complaint under
     art. 23, up to three years.
   - **The hoped-for escape does not work.** r2 speculated that individualised,
     signal-triggered outreach might not count as *Massenwerbung*. Swiss
     doctrine and case law key the test on **automation, not volume** —
     advertising sent *"ohne nennenswerten menschlichen Aufwand"*
     ([OGer ZH UE160194](https://www.gerichte-zh.ch/fileadmin/user_upload/entscheide/oeffentlich/UE160194-O4.pdf)).
     An AI outreach pipeline is, by construction, exactly the thing the norm
     targets. **Assume it is caught.**
   - **art. 3(1)(u)**, revised in 2021, compounds it: addresses *not* published
     in a directory — a mobile number or email in a classified ad — are
     protected like star entries, and doctrine extends this to email and to
     B2B ([Walder Wyss, sic! 11/2021](https://www.walderwyss.com/assets/content/publications/Lauterkeitsrechtliche-Aspekte-des-revidierten-Rechts-zum-Telemarketing_Anthamattan_Altmann_sic_2021-11.pdf)).
     Effectively an opt-in regime.
   - Enforcement is complaint-driven and patchy, which is cold comfort: a
     competing broker or tradesman has both standing and motive.

   Consequences: **(a)** marketplace bidding is clean — the customer is invited
   to quote; **(b)** register- and listing-driven prospecting is the loaded
   form, and it is exactly what the insurance-broker and real-estate-mandate
   ideas depend on; **(c)** the compliant designs are narrow and known —
   the agent scores, targets and *drafts* while **a human sends the
   individualised first contact**; postal mail (only Robinson-list
   suppression); or inbound opt-in funnels such as a valuation widget. Build
   those shapes, not a send pipeline. **(d)** Get written Swiss advice before
   any of it; for insurance, FINMA's registered-intermediary duties point the
   same way — the registered broker owns the contact.
5. **Source-access constraints on FIND, now concrete.** Ofri's AGB §8.1 bans
   automated access in terms; Olmero and buildup disallow ClaudeBot and peers
   in robots.txt with an EU-DSM Art. 4 reservation and Cloudflare enforcement;
   localsearch/search.ch bans crawlers and commercial extraction, and its
   directory API caps at 1,000 queries/month and forbids redistribution. Zefix
   terms disallow bulk extraction into a competing register, and registry-driven
   marketing collides with revDSG. **LinkedIn scraping violates its user
   agreement** — the compliant shape is the customer working their own network
   with agent-drafted messages. The one clean API is **simap**. Everything else
   goes through the customer's own inbox, which no scraping clause reaches.
6. **Platform dependency and channel conflict.** renovero is owned by
   localsearch, which also sells the local-SEO products these firms buy. A
   product that helps firms win renovero leads faster is tolerated; one that
   automates against the platform may not be. Prefer email-alert ingestion and
   human-approved submission, and do not build anything that breaks if one
   platform closes a door — Buildigo's liquidation is a reminder that Swiss
   platforms do disappear.
7. **Three persistence regimes.** `packages/core` is Postgres-only, but
   `SqliteEventStreamStore` is sqlite, #1127 puts bindings on the same seam,
   and `FileAskUserStore` is a JSON file. Each is fine for one pilot on one
   VM; all three are a cliff at the third or fourth customer, including for
   backup, which #853 left provider-independent and unbuilt (#877). Do not let
   "it worked for the pilot" become the multi-tenant architecture by default.
8. **Meta Business API timeline — and it is now the true single technical
   critical path (2026-08-11 identity ruling).** Standard onboarding is roughly
   **3-10 business days**: 2-4 days for Business Verification, hours for WABA
   and number setup, 24-48 hours for first template approval. The 2-8 week
   figure is the **green-tick Official Business Account badge, which we do not
   need** for a bot the customer expects to hear from. Start verification on
   day one — it is free and parallel.
   **What changed:** because signup is now WhatsApp-native (§ Onboarding), the
   verified Seneca WABA is the gate through which every customer enters —
   **there is no email-forward fallback for establishing identity**. So Meta
   WABA verification, previously "do not sequence engineering behind it", is now
   the **single technical critical path for onboarding at all**. It is still
   only ~3-10 days and still parallelisable with engineering — but it can no
   longer be treated as optional or deferrable. **Note the scope stays small:**
   one Seneca WABA + business verification, **no Embedded Signup, no
   per-customer OAuth** (users text OUR number; their number is just their
   identity). The genuine *business* critical path remains the named pilot
   customer (risk 9); these are two different gates.
9. **The real critical path is the pilot customer.** Engineering is bounded and
   parallelisable; a firm's decision to route its leads through us is not.
   Secure a named design partner, in the recommended vertical, with written
   agreement to add the forwarding rule, **before slice 1 starts**.
10. **Vertical dilution.** Four presets is a thesis about content reuse. If the
    pilot needs bespoke code, they are not configurations and this is several
    products. Decision 1 exists to catch that before the second vertical.
11. **Language quality is a sales risk, not a technical one.** French with
    Belgian or Québécois vocabulary, or German that reads as German rather than
    Swiss, is disqualifying. Vocabulary comes from the customer's own
    documents, reviewed by a native speaker, never machine-translated.
12. **The speed-to-lead canon is old.** Its two pillars are from 2007 and 2011
    and one is vendor data wearing an MIT badge. Strong enough to sell with,
    but a sharp prospect can pick at it — which is another reason to generate
    Swiss first-party numbers early.

## Decisions (proposed, not ratified)

1. **One engine; verticals are configuration bundles.** A vertical needing a
   code branch falsifies the thesis and triggers a re-plan.
2. **Pilot vertical = kitchen & bath renovation, Romandie** — not fiduciaries.
   The evidence is unambiguous and it contradicts the original brief.
3. **MVP ships RESPOND + FOLLOW UP + the customer landing page. FIND and BID
   are v2**, gated on a ratified legal position and per-platform ToS review.
4. **Rung-1 forwarding into a CH mailbox we own is the default email path.**
   No customer credential in v1. Composio Gmail is never the default.
5. **Never auto-send.** A contractual product guarantee, not a setting.
6. **Reuse #1127's transport design verbatim**, inverting only the identity
   model. Channels are not re-planned here.
7. **Share links before PDFs; approval in a link-opened view, not in WhatsApp.**
8. **This ships as a tenant app repo, not in boring-ui.** Per the ratified
   commercial-premises position, the platform provides premises and never
   pricing; each tenant app adapts the offer. Only genuinely platform-level
   pieces land upstream: #1127 slices, the share capability-token layer, and
   the notification abstraction.
9. **One paying customer before the second vertical is built.**
10. **Owner onboarding is WhatsApp-native (2026-08-11 ruling):** phone number =
    account identity, conversational signup via a `wa.me` click-to-chat link, no
    email/password/web form; web access by magic link over WhatsApp. Reuses
    #1211 §6.6 verbatim (one Seneca number, multi-tenant by sender, no Embedded
    Signup, no per-customer OAuth). This REPLACES email-based owner signup;
    email forwarding stays only for lead ingestion. Consequence: the verified
    Seneca WABA becomes the single technical onboarding gate (risk 8).
    **Implementation is a small extension of existing better-auth** — phone as
    identity provider #4 + a WhatsApp delivery adapter for the already-wired
    magic-link plugin — not a new auth system.

## Test seams

- **Highest public seam:** fixture mailbox → ingest → draft → intention with
  artifact → approval view renders → approve → outbound queued (never sent
  without the tap). No Meta credentials, no live IMAP.
- Ingest: run the same fetch twice, assert zero duplicate threads and a
  monotonic cursor; spy the IMAP client and fail on any non-read command.
- Share links: expired, revoked and never-existed return byte-identical
  responses.
- WhatsApp edge: recorded fixtures; signature verify and template fallback
  unit-tested; Meta mocked at the transport edge.
- Verticals: assert the presets differ only in content — no vertical-specific
  code path exists. This is decision 1's automated guard.
- **Avoid testing:** Meta and IMAP server behaviour, pi internals, and LLM
  output quality — the last is pilot feedback, not CI.

## Slices

### Slice 1: rung-1 ingest + renovation preset + draft loop
**Delivers:** CH ingest mailbox, forwarding onboarding script, IMAP poll,
threading, idempotent upsert, the FR renovation persona with price book and
first knowledge corpus, drafting into an ask_user intention with the thread as
`HumanArtifact`, one session per thread.
**Blocked by:** named pilot customer (owner-side, risk 9).
**Proof:** fixture-mailbox seam end-to-end; double-ingest idempotence;
no-mutation spy.

### Slice 2: approval view + durable expiring capability links
**Delivers:** durable share entry store, capability token with expiry and
revocation, uniform not-found semantics, mobile-legible approval view
authorized by `answerToken` through `questionsBridge.handle`, approve/edit/
reject → send on tap.
**Blocked by:** slice 1.
**Proof:** expiry/revocation uniformity; approve-sends and no-tap-never-sends.

### Slice 3: WhatsApp-native signup + outbound notification
**Delivers:** #1127 slice 1a narrowed to one provisioned binding (webhook core,
binding store with the single-transaction dedupe insert, credentials, flag,
trusted-caller seam with guardrails); **#1127 slice 1c** — WhatsApp/phone as
better-auth identity provider #4 (first inbound = account+workspace creation
keyed on the sender number, channel-as-verifier, conversational onboarding) and
the **magic-link WhatsApp delivery adapter** wiring the existing better-auth
`sendMagicLink` to WhatsApp (no new token/session code; phone OTP fallback);
the send half of slice 2;
and the notification delivery abstraction off `AskUserStore.subscribe()` with
batching. **Explicitly not** slice 1b turn assembly or in-channel answering.
**Blocked by:** slice 2; Meta WABA verification (owner-side, now the single
technical onboarding gate — risk 8).
**Proof:** fake-channel loop in CI; a first inbound from a new number
provisions exactly one account+workspace (idempotent on repeat); a magic link
establishes a web session on first tap and fails closed on second tap; live
demo to a test number.

### Slice 4: FOLLOW UP + customer landing page
**Delivers:** follow-up cadence on unanswered quotes, post-job review request,
the customer-LP template family and the per-customer content pass, with the
form wired into RESPOND.
**Blocked by:** slice 3.
**Proof:** a cadence fires and stops correctly on reply; a real customer page
live with a form submission producing a draft.

### Slice 5: CH deployment
**Delivers:** Exoscale CH-zone or Infomaniak deploy as a new runbook provider
entry, CH Postgres, Infomaniak models, the non-`vercel-sandbox` hard gate, the
vertical LP, and the written residency statement.
**Blocked by:** slice 4.
**Proof:** the pilot customer running on it against real leads for one week,
with the instrumentation of §10 reporting.

### Slice 6 (separate gate, post-pilot): proactive FIND, then BID
Gated on a written Swiss legal position (risk 4) and per-platform ToS review.
Order, cheapest and safest first:
1. **Marketplace alert parsers** — already carried by rung 1; this slice only
   adds per-platform parsing and dedupe against direct enquiries.
2. **simap connector** — the one sanctioned API, scheduled by the existing
   `boring_automation` cron. Useful for placement, architects and larger
   installers; largely irrelevant below the CHF 150-300k thresholds.
3. **A host-proxy web tool** (the shape already designed in the BYOK plan,
   bead `16f.5`) with the SSRF guard that does not exist today — a prerequisite
   for anything else, and a platform-level contribution.
4. **Automated BID** — browser automation plus credential storage, both new
   subsystems, both needing their own gate. Not before a customer asks for it.

### Slice 7 (research, not code): placement vertical validation
Close open question 9 before considering a pivot: mandate-flow channels, firm
count, day rates and margins for Swiss IT placement, Vaud density. One research
pass, no engineering.

## Out of scope

Accounting, calendar, invoicing, payments, CRM, shared-inbox semantics, agent
sandboxing, per-agent grants (#1087), multi-tenant CH hosting at scale, group
chats, inbound media, SMS and Slack channels, and any automated outreach to
people who have not contacted the customer.

## Open questions — owner decisions required

1. **Ratify the pilot vertical.** The research contradicts the brief:
   fiduciaries rank worst (no marketplace, highest digital maturity, funded AI
   incumbents), storage is the wrong product shape (CHF 32/month), and garden
   *maintenance* is below the ticket bar. Recommendation: **kitchen & bath
   renovation, Romandie**. This is the decision everything else hangs on.
2. **Named pilot customer**, and their written agreement to add the forwarding
   rule before slice 1 starts. The genuine critical path.
3. **Legal position on outbound.** Commission Swiss counsel on UWG art. 3(1)(o)
   as applied to individualised, signal-triggered B2B outreach. Until it
   returns, FIND stays inside marketplace bidding and the customer's own mail.
4. **Pricing.** Ratify CHF 500/month from month one with setup waived, or pick
   another point in the 300-800 band.
5. **Residency wording.** Approve the exact sentence used in sales and in the
   contract, including the WhatsApp caveat.
6. **Repo placement.** Confirm this ships as a tenant app repo (decision 8),
   and which pieces are allowed to land upstream in boring-ui.
7. **Does this revive #1127?** Channels were deprioritized on 2026-08-08 for
   want of a named consumer. This plan is one. Confirm that slice 1a + the send
   half of slice 2 may be pulled forward on that basis.
8. **Real estate and insurance brokers** — better per-deal economics, both
   outbound-shaped, so their sequencing depends entirely on question 3.
   Revisit after the pilot, not before.
9. **Does the placement vertical displace the pilot?** It has the best verb-fit
   of the high-value set, a B2B legal position, real simap coverage, and a warm
   network in Vaud — but its economics are **unresearched** (the research
   budget ran out). Commission one research pass (slice 7) before deciding. If
   it confirms, placement plausibly beats kitchen & bath on ticket size while
   matching it on legality, and the warm introduction removes the true critical
   path.
10. **Does renovero email its members on new matching requests?** A single
    factual unknown that materially changes the pilot's channel mix and the
    value of the MVP. Resolve with one paid account before slice 1 finishes.
11. **Accept that rung 1 is permanent, not transitional?** The provider
    research argues for it: the Swiss hosters with the easiest forwarding have
    no OAuth at all, so rung 2 there means a raw mailbox password. Ratifying
    "forwarding is the product, OAuth is a Google/Microsoft-only extra" would
    simplify the roadmap and strengthen the privacy story.
12. **Three cheap facts to close before slice 1:** inbound port 25
    reachability on the chosen CH provider; Infomaniak catch-all support,
    alias limits and price; and re-verification of the simap API and Buildigo
    status (§ source conflicts). One email or one call each.

## Revision note

**2026-08-11 addendum:** owner ratified a WhatsApp-native signup/identity model
— phone number = account identity, conversational signup via `wa.me`
click-to-chat, magic-link-over-WhatsApp for web access. This replaces
email-based owner onboarding (email forwarding is retained only for lead
ingestion), pulls in #1127 slice 1c, and makes the verified Seneca WABA the
single technical onboarding gate. Folded into § Onboarding, §(b), MVP, risk 8,
slice 3, and decision 10.

r3 folds in the platform, tooling, mail-provider and real-estate research.
Four things changed materially from r2, all of them corrections rather than
additions: automated cold outbound is **closer to prohibited** than r2's grey
zone (the test is automation, not volume); **M365 blocks forwarding by
default and fails silently**, putting the largest market segment at odds with
the 30-minute onboarding promise; **rung 1 should be permanent** rather than a
stepping stone, because the easiest Swiss hosters have no OAuth; and **we own
no web tooling at all**, which turns deferring automated FIND/BID from a
judgement call into a near-necessity.
