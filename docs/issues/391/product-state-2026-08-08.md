# Product state & strategic analysis — 2026-08-08

Ground truth: `origin/main` merge history through 2026-08-08, open PR queue,
[`runtime-refactor/VISION.md`](runtime-refactor/VISION.md),
[`../DECISIONS.md`](../DECISIONS.md) D25–D29,
[`../DIRECTION.md`](../DIRECTION.md) (recovered 2306eb86d/f41e186cb),
[`../issues/809/runtime-refactor/GTM-STRATEGY.md`](../issues/809/runtime-refactor/GTM-STRATEGY.md),
[`../issues/809/runtime-refactor/MARKETPLACE-PATH.md`](../issues/809/runtime-refactor/MARKETPLACE-PATH.md).
Discipline: Today / Delta — nothing is called "missing" without checking what
partially exists. **This document analyses; it ratifies nothing.**

## 1. Where we are — VISION components and DIRECTION waves

### DIRECTION wave status

| Wave | Ratified content | Status today |
|---|---|---|
| Wave 1 — multi-agent console | Two agents visibly in one UI, playground AND full-app | **Substantially delivered.** #1102 (multi-agent UI + lifecycle races), #1149 (Agents section, per-agent cards, labeled chat list), #1114 (`BORING_AGENT_FLEET` production fleet loader), #1143 (per-automation agent selection), #1105/#1104 (exact-SHA release, hermetic dev smoke). Residue: runtime identity separation #1147 open. |
| Wave 2 — streaming durability | Activate SqliteEventStreamStore, one lane | **Wired.** #1128 (flagged production wiring), #1141 (async driver). Open: #1142 readiness/observability. The 07-31 "wiring plus a read path" verification held — this closed fast. |
| Wave 3 — BYOK / MCP / authored catalog | Trigger: named consumers | **Opened, triggers legitimately fired.** BYOK: #1132 vault (KmsBackend + local-KEK) merged; #1145 durable credential persistence open; onboarding plan #1151 open. MCP: #1130 user-registered typed source + #1131 per-agent grants merged; #1135 SSRF slice open — this is exactly the missing "user-supplied on-ramp" the Lane-reality section identified. Authored catalog: #1136 plan merged, #1150 persona-discovery slice open. |
| Wave 4 — v2 era (SBX1, remote host, marketplace lanes) | Frozen behind owner gates | **Correctly untouched.** |
| Off-wave | — | Landing lane revived within D28 as presentation-only (#1153 memo, #1154 hostname landings, #1156 default-agent persistence). Channels #1127 and executable environments #1123: ratified plans, zero implementation. |

### VISION component table (rows 1–9)

| # | Component | Status |
|---|---|---|
| 1 | Environment-independent agent core | **Merged** (v0.1.91 AgentGateway v0, `createAgentHost()` funnel, CI invariant — D29, still PROPOSED status). |
| 2 | Multi-fs | **Merged** (#416 bindings; company_context readonly). Generalized E1 attachments: not built (per plan, deferred). Executable environments #1123 planned. |
| 3 | Flexible sandbox | **Partial.** bwrap + vercel real, packages extracted; gVisor non-executing on main; remote-worker transport unimplemented; CLI defaults to `direct`, no network egress isolation (Lane-reality facts, still owned by no wave). |
| 4 | External MCP + artifact delivery | **Partial.** MCP consumption now has a real user-registered on-ramp (#1130/#1131). Managed-agent MCP ingress (M1 seam) exists but hardcoded off in released hosts; AR1 shareable artifacts not delivered. |
| 5 | Flue blocks — durable streams/transport | **Partial→merged.** Durable store wired flagged (#1128/#1141); T2 transport contract not recut. Streaming keying (`agentTypeId` absent from buffer key) still undecided before durable schema hardens — flag before unflagging. |
| 6 | eve UX — workspace as control plane | **Partial, big jump this week.** Agents section + fleet cards (#1149), session live status (#1112), inline ask-user (#1090), Inbox review pane (#1088). Missing: cross-surface session observability, unified approval inbox across surfaces (S3), `/info` inspection. |
| 7 | Multi-agent EU Docker delivery | **Partial.** Fleet config + exact-SHA release + hermetic smoke merged; hostname landings + default-agent persistence in validation queue (#1154/#1156). The v1 acceptance golden path (15-min scaffold→deploy proof, rollback proof) has **no recorded evidence**. |
| 8 | EU-sovereign hosting | **Holds** (Exoscale GPU lease #1126/#1155 reinforces EU stack). |
| 9 | The farm (deferred epic) | Substrate accumulating as planned (tasks, inbox, fleet view seeds); correctly not built as product. |

## 2. What to prioritize — lanes vs business horizons

H1 is services-led vertical agents. Ranking of currently-active lanes by H1 pull:

1. **Landing/default-agent validation queue (#1154, #1156, #1147, #1153)** —
   HIGHEST. This is the literal front door of Motion 5 vertical agents; every
   week unmerged delays the first shippable product entry point.
2. **BYOK completion (#1145, #1151)** — high. Determines who pays for tokens
   per client workspace; blocks clean per-client cost accounting. Note the
   `.30` model-cap revisit is still mandatory and still has no bead.
3. **Persona packages (#1150 / #1107)** — high for the influencer/creator
   direction, medium for the first niche agent (fleet config suffices for one
   agent). Keep the slice moving but do not gate the first vertical agent on it.
4. **Durable-stream observability (#1142)** — medium; finish and close the lane.
5. **MCP SSRF slice (#1135)** — medium; security completion of merged work,
   finish it, then pause the MCP lane (its H1 consumer is still unnamed —
   directories are Motion 6, post-ID1).
6. **Weak-pull flags:** *Executable environments #1123* — ratified plan but no
   named H1 customer needs multi-root exec grants; park until a client does.
   *Channels #1127* — H1 buyers are B2B web-UI users (GTM demo-door note says
   the web UI is the opener); WhatsApp/SMS is Motion 4/2b territory, i.e.
   influencer-agent scope — sequence it behind the first influencer agent
   decision, not before. *Mobile shell polish #1144* — nice, but no H1 buyer
   has asked; conclude the epic and stop. *Transcription/GPU lane* — already
   shipped; ensure it doesn't grow without a client pull.

## 3. What is missing between "substrate exists" and "a paying customer"

| Gap | Today | Delta |
|---|---|---|
| Billing/metering (#819) | **Nothing merged.** Issue open, BL1 deferred by owner ruling. H1 pricing is retainer + pass-through LLM cost — that requires per-workspace usage evidence to invoice honestly. | Minimal metering slice: per-workspace token/cost facts on the existing event stream (now durable, conveniently). Invoicing itself stays manual (Stripe invoice / bank transfer) — do NOT build BL1. |
| Onboarding friction | Signup exists; hermetic dev-login (#1104) is dev-only. Signup-domain→default-agent hook in progress (#1156). BYOK onboarding is a plan (#1151). | A client can only be onboarded by the owner hand-provisioning. Acceptable for 3 lighthouse clients; document the runbook so it is repeatable, don't productize. |
| Deployment repeatability | Exact-SHA release + atomic tags (#1105), fleet-as-config (#1114), hermetic smoke (#1104). Strong week. | The VISION v1 golden-path proof (timed scaffold→deploy, rollback, digests) has never been recorded. GTM Motion 1 explicitly gates the "15-minute" demo claim on it. |
| Docs/demos | GTM call kits exist (customs + analytics, French scripts). Demo agents referenced by the kits are **not built**. No recorded golden-path demo. | Per the kits' own prerequisite: no call goes out while the demo agents don't exist. Building the first vertical agent (§6) IS the demo asset. |
| Security posture for less-trusted use | Lane-reality's two sandbox facts still true: CLI defaults `direct`; no network-egress isolation in either real backend. | Fine for managed H1 clients (owner-operated hosts); must be resolved before any third-party/influencer consumer runs untrusted-adjacent load. |

## 4. Business next steps — H1 GTM readiness

Honest read: **engineering has overtaken GTM.** The platform can nearly serve a
lighthouse client; zero Motion-1 motions have been run (no recorded demo, no
demo agents, no calls). Concrete order:

1. Merge the validation queue (#1147 → #1154 → #1156; #1153 memo ratified).
2. Build **Engagement Analyst** or the **analytics agent** (owner's
   unfair-authority vertical per GTM selection matrix) as the first fleet seat
   with a real hostname — this simultaneously produces the demo recording, the
   call-kit prerequisite, and the golden-path timing evidence.
3. Record the golden-path run; only then activate Motion 1 outreach with the
   existing LGM machinery and call kits.
4. Add the minimal metering slice so the first retainer can be invoiced with
   usage pass-through.
5. MacroAnalyst second, reusing the same landing/fleet/knowledge pattern —
   that repeat is the test of "topology is the product line".

## 5–6. Niche agents and influencer agents — capability map and shortest paths

**Interpretation (needs owner confirmation):** a *niche/vertical agent* is a
named domain agent (Engagement Analyst, MacroAnalyst, customs pre-filing…) as
one fleet seat with its own landing at `<agent>.senecaapp.ai`, sold B2B —
VISION Horizon 1 / GTM Motion 5. An *influencer agent* is an agent packaged
around a person or brand: their voice (persona package), their content corpus
(knowledge filesystem), a landing under their name, and their audience funnel
(channels, later rev-share) — GTM Motion 2b "expert-in-a-box" first, Motion 4
creator marketplace later. The influencer reading especially is inferred from
MARKETPLACE-PATH's fitness-influencer canonical scenario and needs the owner
to confirm scope (B2B expert vs consumer creator changes the channel and
billing requirements materially).

### What the platform already does for both (Today)

- **Fleet seats:** production fleet from config (`BORING_AGENT_FLEET`, #1114);
  per-agent model policy; per-agent MCP grants (#1131); per-agent UI cards
  (#1149); per-automation agent selection (#1143).
- **Knowledge:** named filesystem bindings incl. readonly `company_context`
  (#416) — a persona's corpus can ship as a readonly binding today.
- **Landing:** presentation-only hostname landings in review (#1154), with
  D28-compatible governance already reconciled (#1153); signup-domain →
  default-agent persistence in review (#1156).
- **Keys:** BYOK vault merged (#1132), persistence in review (#1145);
  instance-key fallback works today (D27).
- **Persona packaging:** plan ratified (#1136), discovery slice in review
  (#1150) — not yet usable end-to-end.
- **Channels:** plan only (#1140); web UI is the only consumer surface.

### First niche agent — gap list (target: one named agent live at `<agent>.senecaapp.ai`)

1. Merge the validation queue: #1147, #1154, #1156 (+#1153 memo). — **0 new
   PRs**, 3–4 merges.
2. Seneca-side ops: wildcard/exact DNS + TLS for `*.senecaapp.ai`, host env
   config mapping hostname → landing content + workspace/default-agent
   binding. — **1 PR** (config/compose) + ops.
3. Agent content: fleet-seat definition (system prompt, skills, model policy)
   plus knowledge-fs corpus population. Fleet config suffices; the #1107
   package path is NOT required for agent one. — **1–2 PRs**.
4. Bounded landing content (title/summary/CTA text per D-landing memo) for the
   agent. — folds into gap 2, **0–1 PR**.
5. Payer decision per client workspace: instance key works now; finish BYOK
   (#1145 merge + #1151 onboarding) only if the client must hold the key. —
   **0–3 PRs**.
6. Minimal usage-metering slice for invoicing (see §3). — **1–2 PRs**.

**Total: roughly 3–8 new PRs plus merging the existing queue.** The binding
constraint is content and ops, not platform code.

### First influencer agent — additional gaps on top of the above

1. **Persona-as-package (#1107):** finish the slice chain so a creator's
   persona (voice, instructions, assets) is an installable, versioned unit
   updated without redeploying the platform. Slice 1 (#1150) in review. —
   **~3–5 PRs**.
2. **Corpus ingestion:** repeatable import of the creator's content (posts,
   transcripts, courses) into the knowledge fs with provenance. Manual
   curation works for agent one; a script/tool makes it repeatable. —
   **1–2 PRs** (or 0 with manual curation).
3. **Consumer self-signup from the landing CTA:** today workspaces are
   membership-gated and hand-provisioned; an audience funnel needs
   signup → workspace creation → default-agent binding without operator
   action. #1156's hook is the seed. — **2–4 PRs**.
4. **Channel presence (#1127):** WhatsApp/Telegram is where influencer
   audiences live; plan is ratified, zero code, and it sits on the durable
   streams that just landed. Skippable for a web-only v1. — **0 now /
   ~5–8 PRs when activated**.
5. **Abuse/cost guardrails:** budget-capped free tier (caps only, per GTM —
   no feature-flag system) + the sandbox network-egress fact from §3 if
   anything less-trusted executes. — **1–2 PRs**.
6. **Rev-share/billing:** stays manual (BL1 deferred by owner ruling). —
   **0 PRs**.

**Total: ~7–13 additional PRs for a web-only influencer agent; channels add
~5–8 more.** Recommended order: ship the first NICHE agent first (it exercises
the identical landing/fleet/knowledge spine with zero new consumer-facing
auth), then the first influencer agent as Motion 2b (a B2B niche expert, not a
consumer celebrity) so self-signup and channels can lag one step behind.

## 7. Proposed VISION.md amendments (proposals only — do not edit VISION history)

1. Mark component rows 5–7 status changes (durable streams wired; landing
   lane revived presentation-only) in a dated addendum, not by rewriting rows.
2. Record that Wave 3 opened ahead of the original trigger wording, with the
   consumer named (multi-agent model costs + user-registered MCP demand).
3. Ratify D29 (still PROPOSED since 2026-07-31) — the entire shipped spine
   depends on it.
4. Add the niche/influencer-agent product direction as Horizon-1 execution
   detail once the owner confirms the interpretation above.
5. Resolve the D27/#819 tension: H1 invoicing needs a metering slice earlier
   than BL1's "deferred" framing implies; propose splitting "metering facts"
   (now) from "billing product" (deferred).
