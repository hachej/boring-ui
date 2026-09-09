# Architectural review and improvement recommendations

> Inbox drop 2026-08-17 — rendered from Claude share
> https://claude.ai/share/0b16bcbe-d5c5-4261-8b32-60e4dd87f737
> Verbatim content; not canonical. Target layer: 10-product.md

## User

Carefully review this entire plan for me and come up with your best revisions in terms of better architecture, new features, changed features, etc. to make it better, more robust/reliable, more performant, more compelling/useful, etc.
For each proposed change, give me your detailed analysis and rationale/justification for why it would make the project better along with the git-diff style changes relative to the original markdown plan shown below:

*(Note: the shared conversation hides uploaded file attachments — "Files hidden in shared chats." The original markdown plan the user pasted/attached as input is not visible in this share and could not be retrieved.)*

## Assistant

Read a memory, edited a memory, created a file

Full review with 14 revisions and diffs is in the file. The short version of what I'd change, in order of impact:

**R1 — add a preservation tag (HOOK / ADD / FREE) to every capability.** Essential/Common/Optional measures business importance, not architectural cost. Part 2's mandate ("smallest set of objects") only works if it knows which capabilities force a rewrite if not designed for now (identities, tenant scoping, provenance links, immutable revisions) versus which are purely additive (mobile, billing, connectors). Otherwise "preserve" quietly becomes "build."

**R2 — reframe three families as one family × two axes.** The doc already admits it twice (creator SaaS = A+B; C = A at Level 5). Making it the framing stops Part 2 from inventing a Candidate separate from Artifact, a Subscriber separate from Instance, a Method separate from Agent revision.

**R3 — glossary** for Agent/Source/View/Page/Thread/Artifact/Package/Instance/etc. You use them as terms of art without definitions; reviewers can't validate what isn't named.

**R4 — untrusted content / prompt injection** is missing entirely from governance. Every product reads mail, web, documents, subscriber data. Threat model today is only "Agent misbehaves"; the more common incident is "Agent obeys an email." HOOK-class (taint tracking).

**R5 — per-operation autonomy ladder** (observe → suggest → draft → act-with-approval → act → post-hoc review) as a governed Revision, plus dry-run, compensating actions, concurrency, and a note that parity is one-directional.

**R7 — evaluation validity.** 6.9/6.10 describe storage, not what makes a comparison valid — delayed/noisy/confounded outcomes, minimum evidence, evaluator independence, Goodhart. Also: humans and Agents go through the same Revision pipeline.

**R8 — domain selection rubric** (outcome latency, measurability, decision frequency, cost of error, buyer proximity…). Doesn't answer open question #1, but makes the candidate list visibly re-rank itself — some listed domains have outcome latency in quarters.

Then **R6** triggers/notifications, **R9** Level 0 + degrade-to-human-only + "pages render without a model call", **R10** platform/third-party ownership + who pays tokens + scoped memory, **R11** publisher derives methodology from own usage (fits the creator flow much better than "author instructions first"), **R12** developer/operator capabilities (you're a user too), **R13** SSO/erasure/localization, **R14** trim.

One thing I'd push back on if you disagree: R2. If you want to keep three families as separate architectural concerns for narrative reasons, say so explicitly in Part 2's constraints — but I think it costs you objects.

*(Attached document: "Part1 review revisions" — Document · MD. Full content below.)*

---

# Part1 review revisions

## Review of Part 1 — Business Use Cases and Required Platform Capabilities

### Overall assessment

The document is strong where it matters: the thesis (agent-native ≠ chat-first), the human/Agent operation-parity requirement, the publisher/subscriber ownership boundary, the immutable-revision self-improvement loop, and the refusal to make one shell universal. Those are the parts to protect.

The weaknesses are structural rather than local, and they will bite in Part 2:

- The three "families" are one product class times two axes. The doc already concedes this twice (creator-published SaaS = A + B; the C loop is A at maturity Level 5). Left as-is, Part 2 is tempted to design three subsystems.
- "Essential/Common/Optional" measures business importance, not architectural cost. Part 2's mandate is "smallest set of objects that preserves the space." That needs a second axis: which capabilities force a rewrite if not designed for now versus which are purely additive later. Without it, "preserve" silently becomes "build."
- Security is missing one whole class: untrusted content from Sources (mail, web, documents, subscriber data) reaching the Agent as instructions. Every governance rule in 6.8 assumes the Agent is the only adversary; the more common one is the content it reads.
- Evidence and improvement are treated as data plumbing, not as a statistics problem. Delayed, noisy, confounded outcomes and Goodhart-able evaluators are the reason most "self-improving" systems don't. The doc lists what to store, not what makes a comparison valid.
- Capitalized nouns (Agent, Source, View, Page, Thread, Artifact, Package, Instance, Operation, Evaluator, Revision) are used as terms of art without definition. Part 2 will define them technically, but Part 1 needs business-level definitions so validation reviewers agree on what they're validating.
- Smaller gaps: no triggers/schedules/notifications, no per-operation autonomy ladder, no dry-run/undo, no developer/operator capabilities (you are a user of this platform too), no domain-selection criteria despite that being open question #1, no localization (CH/EU market), no Level 0.

Below: 14 proposed revisions, ordered by impact. Each has rationale and a diff against the original text. Diffs use the plain-text structure of the pasted document; hunk context lines are quoted from the original.

### R1 — Add an architectural-preservation tag to every capability

**What:** Alongside Essential/Common/Optional/Advanced, tag each capability row with one of: HOOK (must be designed for now: an identity, boundary, or link that cannot be retrofitted without migrating data or breaking provenance), ADD (can be added later purely additively — new component, new table, new adapter), or FREE (no architectural constraint at all).

**Why:** This is the single change that most improves Part 2. Business importance and architectural cost are orthogonal. Mobile is Common but FREE; multi-tenant instance isolation is Optional for the first product but HOOK (every record must carry an instance/tenant scope from day one or you migrate everything). Provenance links from Artifact → producing execution → Agent version → data vintage are HOOK even though the recursive loop that consumes them is Advanced. Billing is ADD. Without this tag, "the architecture must preserve" reads as "build," and a solo builder ends up with the 20-capability platform before the first paid product. It also gives Part 2 a concrete acceptance test: everything tagged HOOK must map to an object or relation; everything tagged ADD must have a demonstrated extension point but no object.

**Diff:**

```diff
 Legend:
 
 Essential — intrinsic to the use-case family.
 
 Common — likely in many products, but not universally required.
 
 Optional — useful for selected products.
 
 Advanced — later-stage form of the capability.
+
+Preservation tag (orthogonal to the above, applies to the capability regardless of family):
+
+HOOK — must be designed for now. The capability depends on an identity, boundary, or link
+that cannot be introduced later without migrating existing data or breaking provenance.
+Typical HOOKs: stable identities, tenant/instance scoping on every record, immutable
+revisions, provenance links, event/audit trail, operation catalog.
+
+ADD — can be introduced later purely additively (a new adapter, view type, service, or table)
+without touching existing objects. Part 2 must show an extension point but must not create
+an object for it.
+
+FREE — no architectural constraint; a product decision only.
+
+Rule for Part 2: every HOOK capability must map to a named object or relation; no ADD or FREE
+capability may justify a new object.
```

```diff
 11. Capability Set to Carry Into Part 2
 
 Part 2 should determine the minimal objects and abstractions required to provide the following business capabilities.
+
+Each item is annotated with its preservation tag. Part 2 is required to design for the HOOK
+subset and to demonstrate an extension point for the ADD subset.
 
-1. Purpose-built application experience
-2. Agent identity and versioned behavior
-3. Human/Agent operation parity
-4. Governed access to heterogeneous data and services
-5. Semantic discovery and querying
-6. Durable resumable work
-7. Artifacts and provenance
-8. Human approval and feedback
-9. Real-world outcome capture
-10. Recursive candidate/evaluation/promotion
-11. Agent-generated declarative application changes
-12. Package and version boundaries
-13. Subscriber and tenant isolation
-14. Multi-Agent extensibility
-15. Multi-user extensibility
-16. Multi-application extensibility
-17. Local-to-cloud portability
-18. Sovereignty, residency, audit, and export
-19. Metering, entitlement, and commercial operation
-20. The ability for Boring itself to use the same improvement process
+1. Purpose-built application experience — ADD (View/Page types), HOOK (View↔Operation↔semantic binding model)
+2. Agent identity and versioned behavior — HOOK
+3. Human/Agent operation parity — HOOK (Operation catalog is the spine)
+4. Governed access to heterogeneous data and services — HOOK (Source identity, authority model), ADD (each connector)
+5. Semantic discovery and querying — ADD (engine), HOOK (semantic-model version reference on queries and Artifacts)
+6. Durable resumable work — HOOK
+7. Artifacts and provenance — HOOK
+8. Human approval and feedback — HOOK (event linkage), ADD (UI)
+9. Real-world outcome capture — HOOK (outcome→Artifact→execution link), ADD (capture mechanisms)
+10. Recursive candidate/evaluation/promotion — HOOK (immutable revision + incumbent), ADD (evaluators, loop)
+11. Agent-generated declarative application changes — ADD (relies on 3, 5, 10)
+12. Package and version boundaries — HOOK (package identity + version on every contribution)
+13. Subscriber and tenant isolation — HOOK
+14. Multi-Agent extensibility — HOOK (Agent identity is a participant, not a singleton), ADD (routing)
+15. Multi-user extensibility — HOOK (actor identity on every event), ADD (collaboration UX)
+16. Multi-application extensibility — HOOK (namespacing), ADD (composition UX)
+17. Local-to-cloud portability — HOOK (no object may embed deployment location)
+18. Sovereignty, residency, audit, and export — HOOK (audit, residency metadata), ADD (regions)
+19. Metering, entitlement, and commercial operation — HOOK (cost/usage attribution on executions), ADD (billing)
+20. The ability for Boring itself to use the same improvement process — FREE if 10 and 12 hold
+21. Untrusted-content handling — HOOK (data/instruction separation at the Source boundary; see 6.8)
+22. Automation triggers and attention channels — ADD (see 6.16)
+23. Developer/operator capabilities — HOOK (execution trace), ADD (tooling; see 6.17)
```

### R2 — Reframe: one core family, two axes, three archetypes

**What:** State explicitly that Boring has one foundational family (agent-native application) and that "Distributed Expert Agent" and "Recursive Research/Optimization" are the same family pushed along the Distribution axis (5.4) and the Adaptivity axis (5.5) respectively. Keep A/B/C as archetypes because the business statements, customers, and commercial models genuinely differ.

**Why:** Section 3 currently invites Part 2 to ask "what does the expert-agent subsystem need?" and "what does the optimization subsystem need?" — which produces duplicate abstractions (a "Candidate" separate from an "Artifact", a "Subscriber" separate from a "tenant instance", a "Method" separate from an "Agent revision"). The doc's own text in 3.2 ("not a separate foundational family... an advanced distribution form") and in Section 8 (levels 4–5) already makes the point; making it the framing rather than a footnote closes that door. It also makes Section 5 load-bearing instead of decorative: the axes become the real product-definition tool, and any product = archetype × axis positions.

**Diff:**

```diff
 3. Three core use-case families
 
-The business opportunity can be condensed into three overlapping use-case families.
+There is one foundational family: the agent-native application (3.1). The two further
+archetypes below are that family moved along the evolution dimensions of Section 5:
+
+Distributed Expert Agent (3.2)
+    = agent-native application
+    + Distribution axis at "installed product / expert subscription" or beyond
+    + hard publisher/subscriber ownership boundary
+
+Recursive Research and Optimization (3.3)
+    = agent-native application
+    + Adaptivity axis at Level 4–5 (outcome-driven, recursively improved)
+    + candidate/evaluation/decision workflow as the primary work loop
+
+They are described separately because their buyers, interfaces, evidence, and commercial
+models differ enough to deserve their own business statements. Part 2 must not treat them
+as separate subsystems: a subscriber is an isolated application instance; a candidate is an
+Artifact with an evaluation relationship; a method is an Agent (or Package) revision.
```

```diff
 Relationship to full application publishing
 
 A creator-published full SaaS application is not a separate foundational family.
 
-It is an advanced distribution form combining:
+It is the same family at a further point on the Distribution axis, combining:
```

### R3 — Add a business-level glossary of the capitalized nouns

**What:** A short section (after Section 2) that defines, in one or two lines each and without implementation detail, every noun the document capitalizes: Agent, Operation, Source, Semantic Model, View, Page, Experience, Thread (or Work), Artifact, Outcome, Evaluator, Revision, Package, Instance, Publisher, Subscriber, Actor.

**Why:** The doc uses these consistently enough that they are clearly meant as terms of art, but a validation reviewer cannot tell whether "Thread" (appears once, in the ownership list) is the same thing as "durable work context" (6.6), whether "Page" and "View" are distinct, or whether "Experience" is a View container or a whole product definition. Getting agreement on nouns is the cheapest form of architecture review, and it directly constrains Part 2's object count: if a noun is not in the glossary it should not become an object.

**Diff:**

```diff
 The common capability is:
 
 Humans and Agents can use governed data and operations to perform durable work, produce useful outputs, receive feedback, and—where appropriate—improve the application, the Agent, or the domain result.
+
+2.1 Vocabulary used in this document
+
+These are business-level definitions. Part 2 defines the corresponding objects and may
+merge or split them, but must justify any noun that appears there and not here.
+
+Actor — a human or an Agent performing work under an identity and an authority.
+Agent — a named, versioned actor that performs domain work through Operations.
+Operation — a typed, authorized, auditable domain action or query, invocable by UI,
+  Agent, or automation with the same behavior.
+Source — a governed connection to data or a service (files, database, mail, SaaS, public
+  data), exposed as files, queries, or operations as appropriate.
+Semantic Model — a versioned description of domain entities, measures, dimensions, and
+  relationships over one or more Sources.
+View — a presentation of data and actions; declarative by default, trusted code by exception.
+Page — a routed destination in the application composed of Views.
+Experience — the versioned definition of an application's navigation, Pages, Views, and branding.
+Work (a.k.a. Thread) — a durable, resumable context holding events, participants,
+  linked records, Artifacts, and pending approvals.
+Artifact — a durable, versioned output with provenance (report, draft, dataset,
+  candidate, forecast, View definition, Agent revision...).
+Outcome — a real-world measurement linked back to the Work and Artifact that produced it,
+  distinct from human preference signals.
+Evaluator — a versioned procedure that scores an Artifact or Revision against a definition
+  of "better".
+Revision — an immutable proposed version of anything improvable, compared against an incumbent.
+Package — a versioned, distributable bundle (Agents, Experience, semantic models,
+  requirements) with publisher identity and lineage.
+Instance — an isolated installation of a Package for a specific owner, holding
+  owner data, credentials, Work, and local customizations.
+Publisher / Subscriber — the owner of a Package / the owner of an Instance of it.
```

### R4 — Untrusted content and prompt-injection resistance as a governance capability

**What:** Add to 6.8 (and to the core business rule) that content arriving through Sources is data, never instructions; that Operations triggered in a Work whose recent inputs include untrusted content are subject to elevated approval; that provenance records which Source content influenced an action; and that the Agent must not be able to move data across Source/tenant boundaries by being asked to in that data.

**Why:** Every representative product reads external content: mail clients, CRMs with inbound notes, research terminals fetching web pages, subscriber-uploaded documents, public data sources. The doc's threat model is exclusively "the Agent misbehaves" (widens authority, bypasses approval). In practice the dominant real-world incident is "the Agent obeys an instruction embedded in an email or web page and exfiltrates or acts." This is a HOOK-class capability: taint has to be tracked from Source ingestion through Work events to Operation invocation, which cannot be bolted on later. It is also a sales argument for the sovereign/regulated positioning.

**Diff:**

```diff
 Policy versioning
 
 Common
 Common
 Essential
 
+Untrusted-content handling (Source content is data, not instruction)
+
+Essential
+Essential
+Essential
+
+Taint-aware approval (elevated approval when an action follows untrusted input)
+
+Common
+Common
+Essential
+
+Cross-boundary data movement control (no Source→Source or Instance→Instance transfer without policy)
+
+Essential
+Essential
+Essential
+
 Outcome-unknown handling
```

```diff
 Core business rule
 
 An Agent must never be able to:
 
 grant itself access;
 
 widen a delegated permission;
 
 reveal credentials;
 
 bypass approval;
 
 silently repeat an uncertain external effect;
 
-activate its own unvalidated revision.
+activate its own unvalidated revision;
+
+treat content read from a Source, a document, a web page, a message, or a subscriber
+record as an instruction from an authorized actor;
+
+move data across a Source, Instance, or tenant boundary because content asked it to.
```

### R5 — Per-operation autonomy ladder, dry-run, compensation, and concurrency

**What:** Extend 6.3 with (a) an explicit autonomy ladder that is a property of an Operation × Actor × context, not a global setting; (b) dry-run / plan-preview as a first-class Operation mode; (c) reversibility classification and compensating actions; (d) conflict handling when a human and an Agent touch the same record; (e) a clarification that parity is one-directional.

**Why:** "Approval for consequential actions" is binary; real products need a ladder (observe → suggest → draft → act-with-approval → act → act-with-post-hoc-review) and need to move individual operations up the ladder as trust accumulates — which is exactly what the evidence loop in 6.9 is for. Making the ladder explicit connects governance and adaptivity into one mechanism ("promotion of autonomy level" is a Revision like any other). Dry-run is what makes agent-built Views and optimization candidates safe to preview and is trivial to add to a typed Operation catalog now, expensive later. Compensation matters because "rollback" in the doc only covers Revisions; domain actions (an email sent, a record moved) need their own reversibility class. Concurrency is unavoidable the moment there is background Agent work and a human on the same page. The parity clarification prevents Part 2 from over-constraining: agents may have headless operations without a button; humans may have navigation with no operation.

**Diff:**

```diff
 Business requirement
 
 If a user can perform a meaningful domain action in the application, an authorized Agent should be able to address the same action structurally.
+
+Parity is one-directional. Every human domain action must be Agent-addressable; not every
+Agent-addressable operation needs a human control, and not every UI affordance
+(navigation, presentation state) is a domain operation.
```

```diff
 Required capabilities
 
 typed domain actions;
 
 input validation;
 
 output validation;
 
 authorization;
 
 effect classification;
+
+reversibility classification (reversible / compensable / irreversible) and, where
+applicable, a compensating operation;
+
+dry-run or plan-preview mode returning the intended effects without executing them;
 
 approval policy;
+
+per-operation autonomy level, defined per Actor and context:
+
+  observe → suggest → draft → act with approval → act → act with post-hoc review
+
+where a change of level is a governed Revision (proposed, evaluated on evidence,
+promoted, revocable), not a setting;
+
+optimistic concurrency and conflict surfacing when a human and an Agent act on the same
+record or Work;
 
 idempotency;
```

### R6 — New subsection: automation triggers and attention channels

**What:** Add 6.16 covering how work starts without a human typing (schedules, record/event triggers, inbound webhooks, Source change detection) and how humans are reached outside the application (email, chat, mobile push, digest), including approving or rejecting from those channels.

**Why:** "Ambient Agent", "background work", and "automation" appear throughout, but nothing defines what starts them. Section 6.3's example ("Move opportunity when approval arrives") is a trigger with no capability behind it. Likewise the "attention and approval interface" assumes the user is in the app; in the SME, creator, and expert-agent products most approvals will happen from a phone or an email. Triggers are ADD architecturally, but they change what the durable-work model must accept as an event origin (a non-human, non-Agent actor: "system/schedule"), which is worth stating now.

**Diff:**

```diff
 6.15 Commercial Platform Capabilities
 ...
 This section does not assume which model will be selected.
+
+6.16 Automation Trigger and Attention Channel Capabilities
+
+Business requirement
+
+Work must be able to start without a human present, and humans must be able to
+respond to Agent work without opening the application.
+
+Trigger capabilities
+
+scheduled runs;
+
+record or Work event triggers;
+
+Source change detection (new mail, new file, data release);
+
+inbound webhooks and API calls;
+
+trigger identity as an actor in provenance ("started by schedule X", not by a user);
+
+trigger budgets and rate limits;
+
+trigger pause, disable, and audit.
+
+Attention channel capabilities
+
+notification delivery by email, chat, mobile push, or periodic digest;
+
+approve / reject / edit-and-approve from the channel, bound to the same approval record;
+
+deep link back to the Work and View;
+
+escalation and reminders for pending approvals;
+
+per-user channel preferences;
+
+audit of who responded, from where.
```

### R7 — Evaluation validity, attribution, and one revision pipeline for everyone

**What:** In Section 4 and 6.10, add: evaluator independence and versioning; minimum-evidence and statistical-validity requirements before promotion; explicit treatment of delayed, noisy, and confounded outcomes (holdouts, A/B, attribution confidence); Goodhart protection; and the rule that human-authored changes go through the same revision pipeline as Agent-proposed ones.

**Why:** 6.9 and 6.10 describe storage and workflow but not what makes a comparison valid. Real outcomes in the target domains are slow (portfolio, formulation), noisy (conversion, engagement), and confounded (market moved, sales rep changed). A promotion decision made on 12 samples with a self-graded evaluator is worse than no loop, and "improvements do not rely only on persuasive self-evaluation" (Section 9) is currently an aspiration with no capability behind it. Stating validity requirements now decides one HOOK: outcomes must carry attribution confidence and a comparison design, not just a value. The "same pipeline for humans" rule is a simplification for Part 2: there is one Revision object, and "who proposed it" is a field.

**Diff:**

```diff
 What this capability must prevent
 
 silent live self-rewriting;
 
 an Agent granting itself more authority;
 
 an Agent changing the evaluator that judges its own revision without disclosure;
+
+promotion on insufficient or non-comparable evidence;
+
+optimizing an evaluator proxy at the expense of the real outcome (metric gaming);
+
+a human-authored change bypassing the same validation, comparison, and rollback path;
 
 uncontrolled mutation of production code;
```

```diff
 A product becomes recursively improvable when it can:
 
 identify an improvement target;
 
 define what "better" means;
+
+define how "better" will be measured: which Outcome or evaluator, on what sample, over what
+window, against which incumbent, with what comparison design (offline replay, holdout,
+A/B, expert panel);
 
 gather relevant evidence;
+
+establish that the evidence is sufficient and comparable (minimum sample, same data
+vintage, same semantic-model version, attribution confidence above a threshold);
 
 propose a new immutable revision;
```

```diff
 Required capability distinctions
 
 candidate generation
 evaluation
 promotion
 production execution
 
 These should not be performed under one uncontrolled authority.
+
+Evaluators are themselves versioned Revisions and are never changed in the same
+promotion as the thing they evaluate.
+
+Every change — Agent-proposed or human-authored — is a Revision. Authorship is a
+property; the pipeline is the same.
```

```diff
 Required capabilities
 
 link feedback to the originating work and Agent version;
 
 distinguish human preference from real-world outcome;
+
+attach to each Outcome an attribution confidence and the comparison design under which
+it may be used (single observation, before/after, holdout, controlled);
+
+support delayed and partial outcomes without blocking the Work;
```

### R8 — Domain selection criteria (turn open question #1 into a rubric)

**What:** Add a short section before Section 10 listing the criteria a first domain must score well on. Do not pick the domain; give the scoring instrument.

**Why:** "Which use-case family becomes the first paid product?" and "Which domains provide sufficiently fast and independent outcomes?" are the two open questions that dominate everything else, and Part 1 is the right place for the criteria even if not the answer. Several representative domains in 3.3 (portfolio construction, macro forecasting) have outcome latency measured in quarters — fine for Level 4–5 eventually, fatal for a first product that needs the loop to demonstrate value. Making outcome latency, outcome measurability, decision frequency, and cost-of-error explicit criteria will visibly re-rank the candidate list, which is exactly what a validation draft should do.

**Diff:**

```diff
+9.1 Criteria for the first domain
+
+Part 1 does not choose the first product. It fixes what a candidate domain must
+demonstrate. Score each candidate on:
+
+Outcome latency — days, not quarters, between Agent output and a measurable result.
+
+Outcome measurability — the result is captured by a Source the platform already reads
+(reply, conversion, test result), not by manual entry.
+
+Decision frequency — enough repeated cycles per user per month to accumulate evidence.
+
+Cost of error — mistakes are recoverable and cheap enough to allow "act with approval"
+early rather than "suggest only" forever.
+
+Data accessibility — the buyer can connect the needed Sources in the first session.
+
+Buyer proximity — the person who feels the pain signs the invoice.
+
+Regulatory load — sovereignty is an advantage without residency being a blocker.
+
+Reference density — the audience already trusts the publisher or vendor.
+
+A candidate that fails outcome latency or measurability may still be a Level 1–3 product;
+it should not be chosen to prove Level 4–5.
+
 10. Business Questions Intentionally Left Open
```

### R9 — Level 0, degraded modes, and performance expectations

**What:** Add Level 0 ("Human-only: the application is complete software with the Agent disabled") to Section 8; add to the Section 2 definition that an agent-native application remains usable without its Agent; add a short 6.18 on reliability/performance: routed pages load deterministically without a model call, Agent work is asynchronous by default, provider outage degrades to Level 0, budgets and cost per Work item are visible.

**Why:** Trust (Section 9) is undermined if a model-provider incident takes down the CRM. Level 0 is also the honest MVP shape for many buyers and the guarantee that makes "purpose-built software" credible rather than a chatbot with tabs. Performance expectations belong in Part 1 because they constrain architecture: "page render must not depend on an LLM" is a HOOK-class decision about the View/Operation boundary. It also protects your "boring engineering" stance — most of the platform must be ordinary, fast, deterministic software.

**Diff:**

```diff
 An agent-native application:
 
 feels like normal purpose-built software to a human;
+
+remains a complete, usable application when its Agent is disabled, unavailable, or
+over budget;
 
 lets an authorized Agent perform the same meaningful domain work as the human;
```

```diff
 8. Product Maturity Spectrum
 
 Any product may move along this spectrum without changing its fundamental business identity.
+
+Level 0 — Human-Only
+
+The application is complete domain software with the Agent switched off.
+Every Level above must degrade to Level 0 on provider failure or budget exhaustion.
 
 Level 1 — Agent-Assisted
```

```diff
+6.18 Reliability and Performance Expectations
+
+routed Pages and declarative Views render from governed data without a model call;
+
+Agent work is asynchronous by default; interactive latency budgets are separate from
+background budgets;
+
+model provider, sandbox provider, and Source failures degrade the product to Level 0
+rather than to an error page;
+
+per-Work, per-Agent, and per-Instance cost and latency are recorded and visible;
+
+long-running work survives process restarts and reconnects (see 6.6);
+
+external effects are idempotent or explicitly outcome-unknown (see 6.3, 6.8).
```

### R10 — Ownership: add platform-owned, third-party terms, cost attribution, and memory scopes

**What:** In 3.2, add "Platform-owned" and "Third-party-licensed" to the ownership boundary; in 5.5/6.9, add Agent memory as a scoped capability (user / instance / publisher / organization) subject to the same boundary; in 6.15, add attribution of model/compute cost to publisher vs subscriber vs platform.

**Why:** Two-party ownership is incomplete. Public data Sources (economic series, market data, web content) carry license terms that constrain redistribution inside a Package; the platform itself owns aggregate telemetry, evaluation fixtures, and infrastructure defaults; and creator economics only work if it is defined who pays for tokens when a subscriber runs a publisher's Agent (this decides whether payouts are gross or net and whether the publisher can set a model policy at all). Memory is the most likely leak across the boundary — "remember explicit preferences" is listed but not scoped — so it should be named as a capability with the same scopes as improvements (6.10) so Part 2 uses one scoping mechanism, not two.

**Diff:**

```diff
 Subscriber-owned:
 - connected data;
 - credentials;
 - Threads and history;
 - prompts;
 - Artifacts;
 - local preferences;
 - local customizations;
 - private outcomes.
+
+Platform-owned:
+- infrastructure, defaults, and base evaluators;
+- aggregate, non-attributable telemetry explicitly permitted by policy;
+- package registry and lineage records.
+
+Third-party-licensed:
+- public or vendor data Sources carry their own terms; a Package may reference such a
+  Source but may not redistribute its content unless the license allows it.
```

```diff
 5.5 Adaptivity
 ...
 Possible capabilities:
 
 remember explicit preferences;
+
+Agent memory with explicit scope (user-local, instance-local, publisher/package-level,
+organization-level) governed by the same boundary and promotion rules as improvements
+in 6.10 — a memory written at one scope never becomes visible at a wider scope without
+an explicit, audited promotion;
```

```diff
 usage credits;
 
 metering;
+
+cost attribution per execution to publisher, subscriber, or platform, so that model and
+compute cost can be charged, absorbed, or shared per commercial model;
 
 billing;
```

### R11 — Publisher expertise capture from the publisher's own usage

**What:** In 3.2 "What the publisher can do", add that the publisher can build the Agent's methodology from their own use of the platform (their Work, Artifacts, edits, decisions), not only by writing instructions.

**Why:** The current publisher list is "define, provide, provide, provide" — it assumes the expert authors the methodology up front, which is the step most experts never finish. The far more compelling and differentiated flow is: the expert uses the product as an ordinary Level 1–3 user; their accept/edit/reject history and Artifacts are the methodology; publishing is a governed export of that evidence into a Package revision. This reuses 6.9 and 6.10 rather than adding anything new, and it makes "distributed expert Agent" a natural next step from "agent-native application" instead of a separate authoring product — which is also the honest ordering for a solo builder.

**Diff:**

```diff
 The publisher can potentially:
 
 define the Agent's methodology;
+
+derive the methodology from their own use of the platform — their Work, Artifacts,
+edits, approvals, and rejections — through the same evidence and revision pipeline used
+for improvement (6.9, 6.10), rather than only by authoring instructions;
 
 provide knowledge, instructions, examples, and skills;
```

### R12 — New subsection: developer and operator capabilities

**What:** Add 6.17 for the people who build and run applications on the platform (including you): execution tracing and replay, local development loop, evaluation fixtures as tests, package migrations, diagnostics per Instance, cost dashboards, incident tooling.

**Why:** Section 4 says Boring itself is a user of the improvement loop, and 6.12 mentions "evaluation fixtures", but there is no capability set for the builder role. Every product family depends on someone being able to answer "why did the Agent do that on Tuesday for customer X" quickly; that requires the execution trace to be a HOOK-class object (it is the same trace that provenance and evidence rely on, so it costs nothing extra to name it). For a solo operator, the support burden line in Section 9 ("support burden is sustainable") is decided here.

**Diff:**

```diff
+6.17 Developer and Operator Capabilities
+
+Business requirement
+
+The people who build, publish, and operate applications on the platform — including
+Boring's own team — need to understand, reproduce, test, and repair Agent behavior
+at the cost of minutes, not days.
+
+Required capabilities
+
+per-execution trace: inputs, context, Operations invoked, model calls, cost, latency,
+decisions, and errors, linked to Work and Artifact provenance;
+
+replay of an execution against a new Agent revision, evaluator, or model policy;
+
+local development loop with local Sources and a local sandbox, producing the same
+objects as hosted execution;
+
+evaluation fixtures runnable as tests, in CI, and as part of Package publication;
+
+package migrations and compatibility checks across Instance upgrades;
+
+per-Instance diagnostics accessible to support without exposing subscriber data
+beyond policy;
+
+cost, error, and latency dashboards per Agent, Package, Instance, and Source;
+
+kill switch and budget freeze per Agent, trigger, and Instance.
```

### R13 — Smaller governance and experience additions

**What:** Add to 6.8: identity federation (SSO/OIDC; SCIM later), retention and legal-hold policies, data-subject erasure across Instances and Artifacts, rate limiting for public products. Add to 6.1: localization (interface language and Agent language, per user; multilingual Sources).

**Why:** These are all ADD capabilities, but two of them are easy to forget and painful later: erasure (an Artifact with provenance links to a deleted subscriber's data needs a defined behavior — redact vs. tombstone) and localization (Swiss/EU buyers will expect FR/DE/IT interfaces and Agents that reason over multilingual documents; if Views and Agent instructions assume English, retrofitting is tedious). SSO and retention are enterprise-contract gates worth naming so they don't surprise the commercial model.

**Diff:**

```diff
 Provider credential isolation
 
 Essential
 Essential
 Essential
 
+Identity federation (SSO / OIDC; directory sync later)
+
+Optional
+Optional
+Common
+
+Retention, legal hold, and data-subject erasure across Instances, Work, and Artifacts
+
+Common
+Essential
+Essential
+
+Rate limiting and abuse controls for publicly reachable products or Agents
+
+Optional
+Common
+Optional
+
 Delegation narrowing
```

```diff
 Branding and theming
 
 Common
 Essential
 Common
 
+Localization (interface language, Agent working language, multilingual Sources)
+
+Common
+Common
+Common
+
 Deep links to application context
```

### R14 — Editorial: reduce repetition and move bundles to an appendix

**What:** Consolidate the four "representative products / primary customer types" lists (3.1, 3.2, 3.3, 7.x) into one table keyed by archetype × axis position; move Section 7 (Capability Bundles) to an appendix; cut the second full copy of the generic loop in 3.3 if the same loop appears in Section 4 (they are near-duplicates with different arrows).

**Why:** The document is meant for validation by others. At its current length the important structural claims (Section 2, 6.3, ownership boundary, 6.10 distinctions) are diluted by lists that a reader has already seen. The bundles in Section 7 are useful but are examples of the R2 formula, and once R2 is in place they read as derivations, which is what an appendix is for. This is the lowest-impact change here and the one to do last.

**Diff (illustrative):**

```diff
-7. Capability Bundles by Business Use Case
+Appendix A. Capability Bundles by Business Use Case (derived from Section 3 archetypes and
+Section 5 axis positions)
```

### Suggested order of application

R1 and R2 first (they change what Part 2 is allowed to do). Then R3 (vocabulary), R4/R5/R7 (they add HOOK-class requirements Part 2 must see), then R6/R9/R10/R11/R12/R13 (mostly ADD, but they belong in the inventory), and R8 (criteria) whenever you want to start ranking wedges. R14 last.

Two things I deliberately did not change: the "Part 2 should resist one object per capability" mandate (correct, and R1 makes it enforceable), and the decision to leave the open questions open (correct for a validation draft; R8 gives them a rubric without answering them).
