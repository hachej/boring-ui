# Part 1 — Business Use Cases and Required Platform Capabilities

**Status:** Fourth-pass superior hybrid — traceable business requirements, preservation constraints, and open decisions  
**Revision date:** 2026-08-17  
**Purpose:** Define the jobs Boring may be hired to do, the capabilities those jobs require, the trust and ownership boundaries that must remain coherent, and the option space that the future architecture must preserve.  
**Out of scope for this section:** implementation sequencing, MVP versus post-MVP decisions, repository migration, package layout, database schema, concrete interfaces, service decomposition, and final naming of architectural objects.

## Reading and traceability

This document uses five explicit clause classes:

- **REQUIRED** — a business invariant or preservation constraint that a conforming Part 2 must satisfy.
- **RECOMMENDED** — a rebuttable design obligation; Part 2 may diverge only with a recorded rationale and equivalent protection.
- **OPTIONAL** — an allowed capability, example, product choice, or extension that is not universal.
- **DECISION** — an intentionally unresolved product or architecture choice identified by a stable `DEC-xxx` ID.
- **INFORMATIVE** — rationale, reference flow, example, or explanatory material that creates no conformance obligation by itself.

In prose, **must** and **must not** indicate REQUIRED clauses; **should** and **should not** indicate RECOMMENDED clauses; **may**, **can**, and examples indicate OPTIONAL clauses unless an adjacent stable requirement ID says otherwise. This is a business-requirements language, not an assertion that Part 1 is a wire-protocol specification.

The following section map classifies the existing clauses without requiring a tag on every sentence:

| Document area | Default clause class and applicability |
|---|---|
| Header and §§0–2 | REQUIRED business thesis, boundaries, vocabulary, and preservation semantics, except text explicitly introduced as an example, possibility, recommendation, or DECISION. |
| §3 | REQUIRED for a product that claims the named business job or consumption mode; representative examples and possible commercial forms are OPTIONAL. |
| §4 | REQUIRED independence and option-preservation rules; the particular position chosen on a dimension is OPTIONAL or a DECISION. |
| §5 | REQUIRED when the capability's §6 applicability trigger is true. A paragraph introduced only by “may include,” “possible,” or “for example” is OPTIONAL unless it contains an explicit must/must-not invariant. |
| §6 | REQUIRED capability identity, applicability, preservation, and conformance metadata. Business-context annotations are INFORMATIVE and never make a capability applicable by themselves. |
| §7 | RECOMMENDED user-visible proof patterns unless a product advertises the corresponding Quality Claim, in which case the relied-upon proof becomes REQUIRED. |
| §8 and Appendix A | OPTIONAL derived examples; they may pressure-test requirements but cannot create a new universal invariant. |
| §9 | REQUIRED declaration vocabulary when a product makes the corresponding posture or Quality Claim; choosing a particular category is OPTIONAL or a DECISION. |
| §10 | REQUIRED validation, falsification, and architecture-acceptance rules for the applicable business claim. |
| §11 | DECISION only; an open entry never supplies an implicit default. |
| §12 | REQUIRED Part 2 handoff, anti-proliferation, terminology reconciliation, and traceability. |

A narrower explicit class, applicability trigger, `BR`, `CAP`, or `DEC` reference overrides the section default. Informative reference flows and examples never weaken a REQUIRED invariant.

Stable requirement-family IDs are defined now in §12.5 as `BR-001` through `BR-056`; Part 2 may split a family into finer invariant IDs but must preserve the parent mapping. Stable capability IDs are defined in §6 as `CAP-001` onward. Stable open-decision IDs are defined in §11 as `DEC-001` through `DEC-068`.

The traceability chain is:

```text
source clause or feedback finding
→ BR requirement family and applicable CAP capability
→ identity / boundary / lifecycle / extension point
→ conformance, negative, fault, and exit tests
→ applicable golden journeys
→ owner, waiver, supersession, and unresolved DEC decision
```

The machine-readable capability/conformance manifest must carry, at minimum:

```text
manifest schema version
subject Package / Release / Deployment / Instance
required, supported, and intentionally omitted CAP IDs with versions
applicability trigger and dependency closure
limits, quality claims, continuity surface, and failure behavior
evidence references, producer, freshness, and verification result
waivers, expiry, owner, compensating control, and supersession
compatibility range and negotiation result
```

Review reports, diffs, audits, and validation logs are maintained as separate non-normative artifacts. When sources conflict, an explicit user instruction controls product intent, a ratified normative decision controls established runtime semantics, and review prose remains evidence rather than authority. No recommendation becomes binding merely because it appeared in an analysis pass.

Part 1 still does not select a physical topology, repository layout, service decomposition, implementation sequence, or MVP. Reference flows and test fixtures are forcing functions, not implementation commitments.

# 0. Executive summary

Boring has **one foundational product family**:

> **A purpose-built, sovereign, agent-native application in which humans, Agents, automations, and authorized external clients can perform durable domain work through the same governed operations.**

That product family can be hired for three overlapping jobs:

1. **Operate:** help a person or organization perform domain work through normal software, with an Agent underneath.
2. **Distribute:** turn an expert’s method, Agent, knowledge, tools, and application experience into repeatable software for other private contexts.
3. **Improve:** compare candidates and methods against evidence, real outcomes, and an incumbent, then promote or reject improved revisions safely.

These are not three platforms and must not become three parallel object models.

They are one application family moved along independent dimensions:

```text
Distribution
private application
→ reusable package
→ installed expert product
→ subscription / external consumption

Adaptivity
human-only
→ Agent-assisted
→ personalized
→ evidence-aware
→ outcome-driven
→ controlled recursive improvement
```

A creator-published SaaS application sits far along both dimensions. An industrial optimizer sits far along the adaptivity dimension. A CRM with an ambient Agent may remain close to the beginning. A personal expert Agent may use a small chat-heavy experience while still relying on the same ownership, Work, operation, evidence, and package foundations.

The strongest shared business requirements are:

- the visible product feels like real domain software rather than an Agent console;
- every product declares an honest model-independent continuity surface and failure-domain matrix rather than treating the Agent as an invisible availability dependency;
- a bounded Agent job may begin in a Page, first-party chat, WhatsApp, email, Slack/Teams, voice, MCP, or an API, while the durable Work remains independent of the channel;
- delegable human, Agent, automation, and external-client actions use the same governed domain semantics, while non-delegable human acts remain explicitly human-only;
- Work, outputs, costs, approvals, effects, deliveries, and outcomes remain attributable and recoverable;
- outside content is treated as untrusted data, never as authority;
- calculation-heavy products use deterministic, versioned domain kernels rather than invented model arithmetic;
- private customer evidence does not silently become publisher knowledge or platform training data;
- changes are proposed as immutable revisions, compared with an incumbent on sufficient and comparable Evidence using a versioned Evaluator, and activated only through authorized promotion;
- publishing, multi-Agent work, collaboration, multi-application composition, and cloud placement remain possible without dictating today’s user experience;
- usage and cost facts are captured consistently, while pricing, payer, billing unit, invoicing, and publisher settlement remain configurable by vertical and commercial offer;
- Admission precedes model, tool, sandbox, and billable execution: Party, Actor, Agent revision, authority, platform-bound context, payer/funding, budgets, and provider-credential policy are resolved before usage can occur;
- Work, Run, Attempt, Operation Invocation, and Effect have distinct causal roles: Work carries customer value and Outcomes, while each Run carries exact execution authority, inputs, Vintages, cost, and Effects;
- Package, Release, Deployment, and Instance remain distinct so upgrades, staging, rollback, and subscriber ownership do not collapse into one mutable object;
- derived caches, indexes, embeddings, summaries, and Views inherit information-flow policy and revocation from their Sources rather than becoming hidden copies of customer data;
- operational facts used for metering, reliability, audit, and support are separable from Work content, so ordinary operations do not require reading prompts, messages, documents, or Artifact bodies;
- approvals bind to an exact proposal and intended effect, become invalid when that proposal materially changes, and can require stronger authentication or multiple approvers according to risk;
- evaluation is treated as an adversarial measurement system: held-out evidence, evaluator independence, platform-recorded facts, anti-gaming checks, and suspicious-win audits protect the recursive loop;
- Package and application contributions compose deterministically through explicit collision rules rather than registration order, and failed refreshes or upgrades preserve a clearly marked last-known-good result;
- Boring’s own orchestrator-and-worker code factory uses the same Work, review, inbox, evaluation, and promotion paths as customer products;
- an independent developer can scaffold, test, and deploy an Agent or agent-native application through a stable framework and hosted deployment path such as `npx boring create` and `npx boring deploy`.
- a Channel conversation may remain Thread-only while a request is ambiguous; any model-assisted clarification uses a separately admitted, tightly constrained Intake Run, and full domain execution begins only after a plausible customer-value request is contracted as Work;
- Work fulfillment, Run execution, Delivery, human Decision, budget/service state, and Outcome observation have orthogonal lifecycles, so one failed Attempt or Run does not silently fail the customer Work;
- actual model behavior is recorded per Model Invocation—including resolved provider/deployment, parameters, cache and fallback behavior, policy, usage, latency, and drift—rather than inferred from an admission-time model preference;
- Entitlement, Usage Facts, quote, billing, and settlement have distinct lifecycles; downgrade or suspension changes what may be admitted without destroying the customer’s Work or Level-0 access.

Part 2 will determine the smallest set of objects and relations capable of satisfying this business space. Part 1 deliberately does **not** turn every capability into an object.

---

# 1. Purpose, boundaries, and anti-goals

## 1.1 Why this section exists

Boring may eventually appear in many product forms. The canonical product-combination table is in §3.7, with detailed derived examples in Appendix A. Those examples overlap heavily and should pressure-test the platform rather than mint one architecture per example.

This section answers:

1. What jobs can customers hire Boring to perform?
2. What can the users, publishers, subscribers, operators, and Agents do?
3. What capabilities recur across those jobs?
4. Which ownership and trust boundaries must be explicit?
5. Which business dimensions may evolve independently?
6. Which capabilities are structurally expensive to retrofit?
7. What business possibilities must Part 2 preserve without prematurely building them?

## 1.2 What this section may constrain

This section may define:

- jobs users hire the product to do;
- business-level vocabulary;
- user-visible capabilities;
- ownership and trust boundaries;
- capability invariants;
- business success and failure conditions;
- preservation requirements that later architecture must not collapse.

It may not:

- turn every capability into an architectural object;
- prescribe a microservice or package layout;
- require a marketplace, one fixed billing model, a billing engine, multi-app operating system, or generalized optimizer;
- assume chat, Dockview, a workbench, or route-first SaaS is the universal shell;
- assume that every Source is a filesystem;
- assume that every application needs the current analytical semantic engine implementation or an explicit optimization ontology;
- choose the first commercial vertical;
- decide implementation order.

## 1.3 Anti-goals

The capability space is wide, but Boring is not intended to become everything.

Boring is not primarily:

- a consumer chatbot platform with plugins;
- a horizontal no-code application builder competing on breadth; Agent-built Experiences remain catalog-constrained projections over an existing Domain Contract, not arbitrary application generation;
- a Zapier-like workflow automation product; Boring automations are governed Actors bound to an application Domain Contract, not an arbitrary cross-SaaS connector graph;
- a BI or semantic-layer company;
- a foundation-model provider;
- an ungoverned Agent framework;
- a public Agent marketplace or one mandatory per-token pricing model as its foundational product;
- an operating system for arbitrary untrusted third-party applications;
- a system whose moat depends on silently training on customer data;
- a universal event-sourced world model;
- or an optimization ontology imposed on mail, documents, CRM, and ordinary operational software.

Boring is a way to build and operate agent-native applications whose:

```text
domain behavior
data
authority
Work
outputs
history
costs
outcomes
and improvement process
```

remain controlled by the application owner.

A non-goal may be revisited only through an explicit product decision, not by accidental accumulation.

## 1.4 Capability preservation classes

Business importance and architectural retrofit cost are different dimensions.

Part 1 uses three preservation classes. They describe **how Part 2 must preserve the option**, not when the capability must be implemented.

### STRUCTURAL

The capability depends on an identity, boundary, or historical link that is expensive or unsafe to retrofit after customers have data.

Typical examples:

- Party ownership, Instance scoping, and Party/Actor separation;
- Actor identity on every consequential event;
- immutable Agent, Package, Release, and Revision identity;
- Work / Run / Attempt / Operation Invocation / Effect causal links;
- the joins between Execution, Artifact, cost, Decision, Delivery, Source/Vintage, and Outcome;
- Package/Release/Deployment lineage and pinned dependency closure;
- Source/Projection/Vintage lineage;
- untrusted-content taint and derived-data information-flow policy;
- Operation kind, complete Effect dimensions, and durable Effect protocol;
- Admission-first execution and Payer Binding;
- separation of content, operational facts, audit, and observability;
- exact Approval binding, invalidation, assurance, and enforcement;
- Evaluator/held-out-Evidence separation;
- deterministic composition and collision resolution;
- staged promotion, last-known-good, and incumbent preservation;
- deployment-independent identity.

Part 2 must represent the necessary identity or relation, even if the user-facing feature is absent.

### EXTENSIBLE

The capability can be introduced through a new driver, View type, trigger, evaluator, adapter, or service without migrating the core historical identity model.

Typical examples:

- a new CRM connector;
- a new chart renderer;
- a new notification channel;
- a new model provider;
- a new evaluation method;
- a public marketplace UI.

Part 2 must expose a clean extension point; this capability alone must not justify a new root object.

### PRODUCT

The capability is primarily a product or presentation choice and imposes little or no universal architectural constraint.

Typical examples:

- whether the Agent appears in a drawer or full page;
- whether the product uses tabs;
- mobile-native versus responsive web;
- exact pricing model;
- visual brand.

The preservation classes are not a roadmap and must not be interpreted as “build all STRUCTURAL capabilities first.”

## 1.5 Part 2 scope constraints and non-normative completeness lens

Part 1 does not choose services, repositories, database tables, deployment units, final object names, queue technology, storage topology, or a physical control-plane/data-plane architecture.

The five areas below are an **informative completeness lens** for Part 2 reviews and later ADRs. They are not a decomposition mandate. They may be co-located, split, or implemented through another topology provided the ownership and dependency constraints remain true.

1. **Sovereignty and control concerns** — Party ownership, Instance boundaries, membership, policy, entitlement, residency, credentials, and liability.
2. **Work and coordination concerns** — Work, Threads, Attention, Human Decisions, Delivery, causality, and human/Agent collaboration.
3. **Data and provenance concerns** — Sources, Projections, Artifacts, Vintages, Evidence, information-flow constraints, and lineage.
4. **Execution concerns** — Admission, Runs, Attempts, worker claims, Model Invocations, Operation Invocations, Effects, scheduling, and Usage Facts.
5. **Experience and Channel concerns** — Pages, Views, chat, inbox, WhatsApp, email, MCP, API, and other human or machine projections.

Part 2 must preserve these constraints regardless of topology:

- Experience and Channels may create, inspect, and steer Work; they do not own Work identity, Authority, commercial identity, or terminal truth.
- Execution workers consume admitted Work; they do not own Human Decisions, pricing, membership, Package lineage, or customer history.
- Projections derive from Sources and inherit their policy; a cache, index, mount, fixture, or embedding store does not become a new Source of truth.
- Billing consumes content-minimized Usage Facts; it does not reconstruct ownership, payer, entitlement, or provider-credential identity after execution.
- Observability references business identities but never replaces durable audit, Work, Effects, Decisions, Deliveries, or receipts.
- each product’s declared continuity surface remains available without the unavailable Agent/model/runtime dependency, subject to explicit identity, policy, key, Source, residency, entitlement, and safety failure behavior;
- every external write obeys the same Effect and Approval protocol whether its trusted adapter is central, regional, embedded, in-process, or remote.

Part 1 requires traceability and conformance, not a prescribed implementation. The golden journeys and failure matrices in §10.6 are the pressure tests. A proposed STRUCTURAL identity or relation must survive at least two materially different journeys unless it exists because of a documented non-negotiable trust, legal, privacy, billing, or recovery boundary.

Part 2 should define the machine-readable **capability and conformance manifest** described in Reading and traceability. A Package, Release, Deployment, Instance, Work type, Operation contract, or advertised service may declare which `CAP` capabilities and versions it requires, supports, or intentionally omits; the applicable `BR` families and `DEC` dependencies; limits, Quality Claims, continuity behavior, owner, tests, evidence freshness, waivers, expiry, and compatibility range.

Part 2 should include at least one **informative** reference topology and the executable reference flows in §12.7. They may not redefine durable identity, choose an MVP, or make implementation sequencing normative in Part 1.

---

# 2. Core business thesis and vocabulary

## 2.1 What an agent-native application is

An agent-native application:

- feels like familiar purpose-built software to a human where a human-facing application is part of the product;
- declares a model-independent continuity surface appropriate to its product form instead of claiming that every intrinsically generative service remains fully productive without an Agent;
- exposes each **delegable** meaningful domain act through shared governed semantics for the Actor types allowed to perform it;
- preserves explicitly human-only acts—such as secret entry, biometric presence, professional signature, break-glass activation, or legally non-delegable decisions—without manufacturing an Agent equivalent;
- admits Work from humans, Agents, automations, services, messaging channels, developer clients, and external machine consumers;
- connects private and public data without surrendering credentials or ownership;
- preserves durable Work independently of a browser, model, process, sandbox, or external conversation;
- produces citable and reviewable Artifacts rather than only transient model text;
- records approvals, edits, Effects, failures, costs, Deliveries, and available Outcomes;
- can become adaptive without requiring a new platform;
- changes improvable behavior through immutable revisions and controlled promotion.

Representative product combinations are summarized once in §3.7 and elaborated in Appendix A. The common capability is not a shell.

The common capability is:

> **Actors use governed domain behavior over controlled data to perform durable Work, produce Artifacts, allocate human attention, and learn from permissioned evidence.**

## 2.2 Human-native outside, Agent-native inside

The human experiences domain nouns and normal application affordances:

```text
Accounts
Campaigns
Forecasts
Formulations
Patients
Documents
```

An Agent receives an authorized projection rather than the human’s ambient session:

```text
an authenticated and authorized context manifest
a discoverable Domain Contract
relevant typed Operations only
approved Source Projections
versioned deterministic calculations
structured Artifact contracts
```

The Agent does not need to see the same pixels as the human.

For a **delegable semantic act**, parity means shared:

- command identity and business meaning;
- validation and concurrency semantics;
- Effect dimensions, idempotency, reconciliation, and audit;
- information-flow, cost, and Outcome linkage.

Parity does **not** mean identical input surfaces or identical authority. Humans, Agents, automations, and external clients may receive different projections, field visibility, assurance requirements, limits, and allowed subsets over the same semantic command. Authorization is evaluated for the exact Actor, represented Party, Authentication Context, purpose, target, and Invocation.

Parity also does not mean:

- every gesture is a tool;
- every human act is delegable;
- every Agent-only exploration becomes a button;
- the full Operation Catalog is injected into every prompt;
- the Agent controls the application by simulating clicks;
- an Operation’s existence grants authority.

A non-delegable act must be identified in the Domain Contract with the human role, Authentication Context, evidence, and legal or safety reason that make it human-only.

## 2.3 Declared continuity surface — useful and honest operation through failure

Every product declares a **continuity surface**: the exact capabilities that remain safe and useful when a dependency or policy domain is unavailable. “Level 0” remains a convenient product label for the model-independent surface, not a universal claim that all products remain fully productive.

A continuity declaration distinguishes, where applicable:

```text
read prior Work and Artifacts
search already-authorized local projections
run deterministic calculations
perform selected deterministic writes
view or resolve safe Attention Items
reconcile already-dispatched Effects
export permitted data
accept new intake without beginning Agent execution
schedule or queue future Work
```

It also declares behavior for each relevant failure domain:

- model provider, sandbox, or compute;
- Source or connector;
- identity, Authentication Context, or directory;
- policy/authorization service;
- control plane, queue, or regional dependency;
- key-management or secret broker;
- Channel provider;
- storage, index, or projection;
- entitlement, budget, or payer service.

A route-first application may retain broad read, deterministic calculation, and selected deterministic-write behavior. An intrinsically generative or channel-first service may retain only intake, status, prior Artifacts, export, and Effect reconciliation. Both can satisfy this requirement when the declared surface is useful, testable, and honest.

Continuity never overrides safety. Identity, policy, key, residency, legal-hold, or sensitive-data failures may require fail-closed behavior. A product must not display stale, unauthorized, partially restored, or semantically incompatible data merely to claim availability.

Each advertised continuity claim is a versioned Quality Claim with applicability, failure-domain assumptions, numeric target where promised, test evidence, owner, and last verification date. The user-visible state identifies what is available, what is stale or blocked, and why.

## 2.4 Work as the durable unit of customer value

Chat messages are not the commercial unit. The meaningful unit is **Work**:

```text
ACME renewal
Eurozone inflation scenario
New supplier formulation
Q4 creator campaign
Portfolio concentration review
```

Work can carry a goal, context, participants, accepted Job Contract Revisions, Runs, Artifacts, Attention, Effects, Deliveries, cost, disputes, and delayed Outcomes. It has orthogonal lifecycle facets rather than one overloaded “final status.”

A **Job Contract Revision** is the immutable agreement for bounded Work. It may be a child record rather than a root object, but it has stable identity and orthogonal lifecycle facets:

```text
proposal/control: proposed → accepted | rejected | withdrawn
accepted revision → fulfilled | terminated | superseded by a new accepted revision

dispute: none → opened → resolved | withdrawn | reopened
```

A dispute may open before or after fulfillment and never erases the revision's control or fulfillment history. “Amendment” creates a new revision; it is not an in-place state change.

It identifies inputs and Source references, exclusions, deliverable contracts and formats, acceptance criteria, budget and service obligations, deadline, allowed Effect dimensions, Delivery destinations, charging basis, and amendment rules. Quotes, full Execution Runs, Approvals, Deliveries, acceptance Decisions, service measurements, and delivery-based charges bind to the exact accepted revision that governed them. A material amendment never silently changes an admitted Run.

The platform keeps these moments distinct:

```text
Produced = a valid Artifact or result version was created
Delivered = an authorized consumer obtained the exact handoff promised
Accepted = an authorized Human Decision accepted that exact target
Successful = a later Outcome met the intended real-world objective
```

A completed model turn is not necessarily Produced Work. Produced is not Delivered. Delivered is not Accepted or Successful. Delivery is evaluated per destination and exact Artifact/result version.

Work and Thread remain distinct. A Work item may have no Thread, one Thread, or several Threads and provider conversations. Thread never owns Work authority, Job Contract Revision, terminal truth, cost, Delivery, or Outcome.

Work lineage must support split, merge, duplicate consolidation, fork/clone, reopen, archive, supersession, and parent/child relationships without overwriting history. Each transition declares whether customer identity, Job Contract Revision lineage, Artifacts, Decisions, Outcomes, and economics are inherited, referenced, reallocated, or merely rolled up. A retry is not new Work; delegated customer value may be child Work; duplicate intake may link to existing Work without erasing either intake record.

## 2.5 Business-level vocabulary

These definitions constrain meaning, not implementation. Part 2 may merge or split them only with an explicit reason.

| Term | Business meaning |
|---|---|
| **Party** | A person, organization, or other business/legal principal that may own, control, publish, operate, pay, license, benefit, be represented, or bear liability. Purpose- and jurisdiction-specific legal roles are declared explicitly rather than inferred from hosting topology or product labels. |
| **Binding / role** | The revocable contextual relation by which an Actor or Agent acts for a represented Party within an Instance, purpose, and capability ceiling. It records whose authority and liability apply without turning the role into a new identity root. Authentication evidence is separate. |
| **Publisher** | A Party role that authors, versions, signs, and distributes a Package. The Publisher owns its methodology and Package lineage, but never thereby owns subscriber data. Publisher is a role, not a separate identity object. |
| **Subscriber** | A Party role held by the owner of, or commercial entitlement holder for, an Instance installed from a Package. Subscriber is an Instance-owner role, not a separate identity or root object. |
| **Actor** | A human, Agent, automation, service, or authorized foreign client that initiates, performs, approves, or observes Work on behalf of a Party. A model process is not itself the durable Actor. |
| **Agent** | A stable software Actor identity in an issuer/owner namespace, with a collision-resistant subject identifier and explicit fork/derive/transfer/revocation/compromise-recovery lineage. It remains distinct from behavior revisions, Instance bindings, model policy, Memory, and runtime processes. |
| **Agent revision** | An immutable behavior definition containing instructions, tool/Operation requirements, schemas, examples, and other behaviorally relevant assets. Every consequential Execution records the exact Agent revision it used. |
| **Authority** | The business concept describing what an Actor may do now, to which data or records, for which purpose, under which policy, approvals, budgets, and limits. Its enforceable parts are represented through grants/bindings, policy decisions, approvals, delegation, and boundary revalidation. |
| **Admission** | The host decision that accepts or rejects one exact execution request and, on acceptance, resolves a canonical Run plus immutable Admission snapshot: Work or Intake scope, Actor, represented Party, Authentication Context, Agent revision, authority ceiling, context manifest, payer/funding, budgets, provider policy, service class, and accepted Job Contract Revision where applicable. |
| **Intake Run** | A separately admitted, tightly constrained clarification Run attached to a Thread and optional draft/prospective Work. It has its own immutable Admission snapshot, narrow budget and context, limited Sources/Capability Providers, and an Effect ceiling that cannot silently widen into the later full Run. |
| **Approval** | An authorized Human Decision bound to an exact rendered proposal, Operation Invocation, target, business-input digest, Artifact revision, complete Effect set/group, policy decision and obligations, cost/quantity ceiling, Authentication Context, and expiry. Material change or stale precondition invalidates it; consumption is atomic with authorization. |
| **Operation** | A typed domain query, calculation, proposal, command, or coordination request with shared semantic behavior for authorized humans, Agents, automations, and external clients. It declares Operation kind plus all possible Effect dimensions; it is not reduced to one primary effect class. |
| **Operation Invocation** | One governed call of an Operation under captured Actor, Work, Execution, authority, policy, input, and concurrency context. It is a lifecycle record, not necessarily a root business object. |
| **Effect** | One planned or dispatched consequence of an Operation Invocation—state mutation, disclosure/egress, Delivery, administrative change, coordination/delegation, or another declared dimension—with stable intent, idempotency, observation, reconciliation, and compensation semantics. |
| **Source** | A governed data lineage. A Source Connection binds authorized access to a provider, account, local root, public endpoint, or collection—with credentials/consent when required—and exposes Resources and Items that may be projected under policy. Remote executable capability is represented as a Capability Provider rather than being silently treated as data. |
| **Vintage** | A Source, Projection, semantic-result, or external-state observation reference plus an assurance descriptor: exact immutable, provider snapshot, transactional cursor, bounded-staleness as-of, best-effort timestamp, or explicitly unversioned. |
| **Domain Contract** | The application’s discoverable nouns, verbs, identifiers, schemas, errors, effects, and compatibility rules. It is broader and more universal than an analytical semantic model. |
| **Semantic Model** | A versioned analytical description of entities, measures, dimensions, relationships, units, time, Vintages, and lineage over one or more Sources. |
| **Work** | A named, durable, resumable unit of customer value with explicit lineage and orthogonal control, fulfillment, service/budget, Delivery, Decision, and Outcome facets. It may contain accepted Job Contract Revisions, Runs, Artifacts, Attention, and economics. |
| **Job Contract Revision** | One immutable version of the bounded-Work agreement: inputs, constraints, deliverable contracts, acceptance criteria, budget/deadline/service obligations, allowed Effect dimensions, Delivery destinations, charging basis, and amendment rules. It may be a child record rather than a root object. Proposal/control, fulfillment/supersession, and dispute are independent; amendment creates a new revision. |
| **Channel** | A transport or interaction surface such as app chat, WhatsApp, email, Slack/Teams, voice, MCP, or API. Channel, Channel Binding, External Conversation, Message, Thread, Authentication Context, and Work are distinct. |
| **Delivery** | A business handoff intent and its per-destination lifecycle for an exact Artifact/result version. Dispatch Effect, provider confirmation, access grant, recipient acknowledgement, acceptance, expiry, revocation, and attempted withdrawal remain distinct facts. |
| **Thread** | A durable product-level conversational or event history that may aggregate Messages from one or more External Conversations and relate to zero or more Work items. It does not own Work authority, cost, Delivery, or Outcome. |
| **Execution / Run** | One logical admitted execution under a stable `RunId`. A constrained Intake Run may attach to a Thread and optional draft/prospective Work; a full Execution Run attaches to Work. The Run joins admitted inputs, Actor, Agent revision, authority, payer/funding, Vintages, Operation Invocations, Effects, gates, cost, and produced Artifacts as applicable. Concrete retries and replacement workers are Attempts beneath the same Run. |
| **Attempt** | One concrete worker/runtime generation beneath a Run. Same-generation reconnect or Lease renewal may continue it; process loss, replacement, incompatible checkpoint, or execution-policy change creates a new Attempt. |
| **Artifact** | A durable logical output governed by a versioned type contract, with immutable content versions, component manifest, provenance, citations, policy, lifecycle, renditions, external copies, and derivation/branch/merge lineage. |
| **Attention Item** | A human-facing request linked to exact Work, Effect intent, Artifact version, Delivery, record version, or Revision. It can be reassigned, superseded, cancelled, expired, or resolved; it is not itself the response. |
| **Human Decision** | An append-only typed response to an Attention Item or exact target: Approval, acceptance, rejection, attestation, promotion, override, deferment, or another governed decision. Editing a proposal creates a new target rather than mutating the decided object. |
| **Evidence** | A permissioned typed claim, measurement, receipt, decision, observation, or evaluation result with producer, method, target, assurance, uncertainty, deduplication/adjudication status, purpose, and lineage. |
| **Outcome Definition** | A versioned declaration of what real-world result is measured for a Work type: signal, Source, observation window, attribution method, confidence rules, and missing-data behavior. |
| **Outcome** | An observed result in the world under an Outcome Definition, distinct from preference or acceptance. It may have several causal contributors, attribution weights/confidence, deduplicated observations, corrections, disputes, adjudication, withdrawal, and recomputation lineage. |
| **Objective Basis** | A versioned statement of what “better” means for an improvement target across one or more Work items: metrics, guardrails, population, observation window, comparison budget, evaluator, Outcome Definition, rollout scope, and promotion authority. It is optional outside explicit improvement. |
| **Evaluator** | A versioned procedure or human protocol used to compare an Artifact or revision against declared criteria. Its fixtures and held-out evidence are not readable, selectable, or modifiable by the Actors it judges. |
| **Revision** | An immutable proposed replacement for an incumbent Agent, Experience, semantic definition, Evaluator, deterministic kernel, workflow, autonomy/authority policy, Package, or domain candidate. “Method” in this document always means an Agent, workflow, policy, Evaluator, Experience, Semantic Model, kernel, or Package Revision—not a separate object. |
| **Experience** | The versioned human-facing definition of navigation, Pages, Views, action bindings, branding, and Agent presence. |
| **View** | A presentation of data, Work, and actions; declarative by default, trusted code by exception. |
| **Page** | A stable routed destination composed of one or more Views. |
| **Package** | A durable Publisher-owned lineage for a distributable application, Agent, or methodology. It carries Publisher identity, version/fork/derive lineage, and provenance but no subscriber data or live credentials. |
| **Package Version** | One immutable authored definition in a Package lineage: methodology, Agents, Experience, Knowledge, Semantic Models, requirements, dependency declarations, migrations, and optional trusted code. |
| **Release** | An immutable deployable build resolved from a Package Version and pinned dependency closure, verified against the applicable supply-chain, compatibility, policy, and impact requirements. |
| **Deployment** | A binding of a Release to an Instance environment, region, configuration, Source/secret bindings, and rollout state. |
| **Instance** | A durable isolated application context with exactly one controlling Party. Other operators, represented clients, beneficiaries, joint controllers, managed-service Parties, or collaborators participate only through explicit Party Relationships, mandates, and Bindings. It survives Release, Deployment, provider, and runtime changes. |
| **Projection** | A purpose-scoped derived representation of authorized Source Resources/Items for a user, Agent, process, View, cache, index, or external consumer. It carries a dependency manifest, transformation version, policy composition, freshness/coverage, and revocation state. |
| **Automation** | A stable governed software Actor plus a versioned trigger/rule definition that may admit Work from a schedule, event, Source change, webhook, or queue. |
| **Operational Fact** | A content-minimized status, timing, cost, policy, receipt, integrity, or health fact used for metering, reliability, audit, and support without exposing Work content by default. |
| **Usage Fact** | An identified, immutable content-minimized estimate, reservation, actual, correction, reversal, or allocation fact attributed to exact execution and commercial context. It is deduplicated and never edited into a price, invoice, entitlement, or payout. |
| **Payer Binding** | A host-resolved Admission relation identifying the Party or funding source, entitlement, budget reservation, provider-credential policy, and settlement scope for an Execution. It is not model-selectable, does not come from ambient credentials, and cannot change retroactively. |
| **Party Relationship / mandate** | A versioned relation authorizing cross-Party participation or Work for a purpose, with controlling and represented Parties, consent/legal basis, liability allocation, data/Effect boundaries, effective period, termination, and post-termination handling. |
| **Authentication Context** | Durable evidence about how an Actor was authenticated for a session, Message, Decision, Invocation, or support/break-glass action: authenticator/factor, device/session, assurance, step-up, recovery/impersonation state, issued/expiry/revocation times, and evidence references. It is not Actor identity or Authority. |
| **Channel Binding** | A revocable mapping from an external account/address/device/provider identity to an Actor, represented Party, Instance, and permitted purposes. It does not by itself establish transaction-level Authentication Context. |
| **External Conversation** | A provider-scoped conversation/mail thread/call/session identified by provider and external ID. It may map to several Threads or Work items and may be reassigned only through audited identity recovery. |
| **Message** | An immutable-versioned inbound or outbound communication with provider ID, sender Authentication Context, content/attachment references, reply/reaction relation, edit/delete history, origin labels, and Admission influence. Later edits never rewrite an existing Run snapshot. |
| **Source Connection** | A governed access binding to a provider, account, local root, public endpoint, or collection, recording credentials, consent, and reauthorization only where required, plus scopes, ownership/control, region, license, health, revocation, and lifecycle. |
| **Source Resource** | A stable provider-relative collection or container—such as a mailbox, repository, database, bucket, tenant, or dataset—with external identity mapping, schema/coverage, policy, health, and lifecycle. |
| **Source Item** | An addressable record, object, message, file, row set, or item version beneath a Source Resource, with stable external mapping, rename/move/merge/split/delete/tombstone semantics, Vintage, and policy. |
| **Capability Provider** | A governed remote or local executable service—model, deterministic kernel, API, MCP server, or tool runtime—whose invocation policy, credentials, Effects, and receipts are distinct from Source data lineage. |
| **Instruction Envelope** | An authenticated Actor directive carrying represented Party, purpose, scope/audience, Authentication Context, Channel/Message provenance, nonce/replay state, issue/not-before/expiry time, supersession/revocation, and signature or trusted-host binding. Narrative Source content never becomes an Instruction Envelope. |
| **Context Manifest** | The ordered, digested record of every context segment actually supplied to a model or worker: origin, selector/rank, transformation, instruction/policy/Knowledge/Memory/Source/Artifact reference or retained content where permitted, schema, truncation/redaction, precedence, information-flow/taint labels, and actual inclusion. It never requires a second raw-content copy when policy permits only a governed reference/digest. |
| **Effect Group** | A stable grouping of planned Effects with immutable membership/digest, ordering or independence semantics, all-or-nothing versus best-effort policy, cumulative impact, Approval target, status aggregation, reconciliation, and compensation rules. |
| **Promotion Plan** | An immutable governed plan for candidate exposure and activation, including incumbent/candidate, assignment, entry/stop criteria, monitoring owner and source, consent/charging policy, rollback or forward-fix feasibility, and lifecycle. |
| **Quality Claim** | A versioned externally or internally relied-upon promise—availability, continuity, latency, freshness, recovery, Delivery, accuracy, cost, or assurance—with scope, target/bound, method/source, window/tolerance, evidence/freshness, owner, validity, breach/remedy, waiver, and withdrawal/supersession lifecycle. |
| **Worker claim / Lease / fence** | Revocable scheduling authority allowing one worker generation to publish for an Attempt. It is distinct from Attempt history and carries a fence token or epoch that stale workers cannot use. It may remain a child relation rather than a root object. |
| **Model Invocation** | One actual provider/model call beneath an Attempt, including the provider-reported model/deployment or alias, parameters, policy-relevant configuration, cache/fallback facts, usage, and result status. One Attempt may contain several Model Invocations. |
| **Record version** | A monotonic concurrency token or ETag for mutable state. It is distinct from an immutable business **Revision**, Package Version, Artifact version, Vintage, or content digest. |
| **Entitlement** | A versioned commercial or contractual fact describing which Package, service class, usage, or Work a Party/Instance may admit. It never grants Source/Operation Authority and remains distinct from price, Usage Facts, invoice, payment, and settlement state. |

## 2.6 Party roles and five data categories

Distribution and delegated professional work create several **Party roles**. One Party may hold more than one role, but the roles remain distinguishable:

1. **Instance owner or controlling customer:** the Party whose private context, Work, data, and Outcomes are being processed.
2. **Publisher:** the Party that authors the Package, Agent methodology, default Experience, and Release lineage.
3. **Platform or deployment operator:** the Party operating identity, hosting, policy, metering, Package, and Deployment infrastructure; this may be Boring, a dedicated operator, or the customer.
4. **Payer/funder:** the Party or contract funding an Execution. It may differ from the user, acting Agent, Instance owner, or Publisher.
5. **Provider or licensor:** a Party supplying models, compute, messaging, market data, SaaS APIs, software, data, or another third-party capability under its own terms.
6. **Beneficiary, data subject, represented client, or external collaborator:** a Party whose interests, data, consent, or professional relationship are affected even when it does not operate the product directly.

Legal roles such as controller, processor, fiduciary, professional of record, or regulated adviser must be declared per purpose, relationship, and jurisdiction. They are not inferred merely because one Party hosts an Instance or another Party uses it.

Consequential Work, Human Decisions, support access, Channel interactions, cross-boundary transfers, and Usage Facts should preserve both:

- the **acting Actor**; and
- the **represented Party and Binding/role** under which the Actor acted.

This matters when the same consultant, service account, or Agent acts for several customers: the audit must retain whose authority, consent, contract, and liability applied.

The platform-operator role owns or controls platform infrastructure, defaults, base Evaluators, and the Package registry and lineage records. It may process content-minimized, Instance-attributed Operational Facts for metering, reliability, security, and support under explicit policy; telemetry reused for broader platform analytics must be aggregate, non-attributable, and explicitly permitted. It never owns subscriber Source data, prompts, Work, Artifacts, Memory, or Evidence merely because it hosts the product.

### Controlling Party and cross-Party mandate

Every Instance has exactly one **controlling Party** for the relevant application context. Hosting operator, payer, Publisher, represented client, beneficiary, professional of record, support Party, and collaborator are separate roles and do not become co-owners merely by participating.

Cross-Party Work requires an explicit Party Relationship or mandate. It declares purpose, represented Party, controlling Party, consent or legal basis, allowed Sources and Effect dimensions, information-flow boundaries, liability/responsibility, effective period, revocation, termination, and what happens to active Work, Artifacts, Delivery access, and retained audit afterward. An Actor’s Binding must identify the mandate under which it acts where one is required.

Some products depend on third-party-licensed data whose terms constrain use, model eligibility, retention, and redistribution.

The platform must keep five data categories conceptually distinct even when infrastructure is shared:

| Category | Meaning |
|---|---|
| **Source data** | Customer-connected, provider, or public data. Party-controlled or licensed, revocable where applicable, and governed by its own terms. |
| **Knowledge** | Publisher-packaged methodology, examples, fixtures, and instructions. Versioned with the Package; not a live copy of customer data. |
| **Memory / preference** | Scoped personalization for a user or Instance. It is not automatically Evidence and never widens scope silently. |
| **Evidence** | Permissioned preference, evaluation, or Outcome signals linked to Work and revisions. It is not retrieved as Publisher Knowledge unless explicitly approved for that purpose. |
| **Operational facts** | Content-minimized Admission, status, timing, usage, Effect-receipt, policy, and integrity facts used for metering, reliability, audit, and support. They do not contain prompts, message bodies, documents, or Artifact bodies by default. |

A subscriber fact copied into Publisher Knowledge is a privacy incident, not “learning.” Metering, reliability, and ordinary support should read operational facts by default; access to Work content requires separate authority, purpose, redaction, and audit.

## 2.7 Explicit trust-boundary transfers

Nothing should cross an Instance, publisher/subscriber, or platform boundary merely because two systems share a database.

Cross-boundary movement should take an explicit business form:

- **Projection:** attenuated, purpose-scoped input, often read-only;
- **Artifact:** immutable output with provenance and citations;
- **Evidence export:** explicit, permissioned, preferably aggregated or fixture-shaped;
- **Package:** versioned methodology and Experience without live customer data;
- **Entitlement:** what an Instance may run, not what private data it contains;
- **Operational-fact export:** content-minimized usage, health, receipt, and integrity facts under an explicit telemetry/support policy.

A cross-boundary movement that actually occurs also creates a durable **Transfer record**. It identifies sender and receiving boundary, exact subject/version or selective proof, purpose, policy decision and obligations, Authentication Context where relevant, destination, time, receipt or failure, downstream propagation expectations, and revocation/withdrawal limits. A transfer form describes what may cross; a Transfer record proves what did cross.

Policy composition is explicit rather than “take the strictest label.” For each dimension—audience, purpose, residency, retention, provider eligibility, license, onward transfer, support use, evaluation use, and deletion—the composition operator is declared as intersection, union under authority, threshold, override with obligation, or incompatible/fail-closed. Unknown combinations fail closed.

Declassification or aggregation creates a new governed output through a versioned validator, residual-risk assessment, threshold basis, lineage, owner, test evidence, expiry/review, and rollback or quarantine path if the transformation later proves defective.

If a cross-boundary flow cannot be explained through an explicit transfer form, the boundary is not trustworthy. A support or metering integration is not permission to read customer content.

---

# 3. One foundational family, three business jobs

There is one foundational family: the agent-native application.

The following are three jobs the same platform can be hired to do. They remain separate in this business document because their buyers, scarce resources, interfaces, evidence, and commercial models differ.

They must not become three parallel architectures.

| Job | Scarce resource | What must be true |
|---|---|---|
| **Operate** | Time, throughput, consistency | The product feels like normal software; humans and Agents share domain behavior. |
| **Distribute** | Expert time and audience reach | Publisher methodology is versioned; subscriber context is private and isolated. |
| **Improve** | Decision quality versus reality | Candidates, incumbents, evidence, delayed outcomes, and controlled promotion can be compared. |

## 3.1 Job A — Operate domain work

### Business statement

> **I want to build purpose-built software for an individual or organization, where people perform normal domain work through a familiar interface and an authorized Agent can perform the same meaningful work underneath.**

### Representative combinations

The canonical examples and their positions across Operate, Distribute, Improve, and external/headless consumption are summarized in §3.7. Detailed capability bundles are derived in Appendix A.

### What the user can do

The user can:

1. navigate through domain-specific Pages and Views;
2. create, inspect, update, and organize domain state;
3. work with records, files, messages, documents, tasks, dashboards, and calculations;
4. ask the Agent to act on current semantic context;
5. let the Agent perform authorized domain Operations;
6. preview or approve consequential work;
7. receive background results through an attention surface;
8. resume named Work on another device or after a process restart;
9. inspect what happened, under which authority, with which sources and costs;
10. optionally connect the Work to later outcomes;
11. optionally compare improved Agent or Experience revisions.

### What it should feel like

```text
Purpose-built navigation
+
normal Pages and Views
+
records, documents, dashboards, and actions
+
ambient Agent and attention plane
```

The Agent may be hidden, ambient, available in a drawer, or visible on a dedicated page. The app remains visually and operationally primary.

### Business value

- saved professional time;
- increased throughput;
- fewer missed tasks and exceptions;
- higher-quality analysis or decisions;
- safer and more consistent execution;
- access to specialized capability;
- better business or operational outcomes.

### Commercial forms

- recurring SaaS;
- per-seat or per-Instance subscription;
- usage-based pricing;
- private deployment;
- design-partner service;
- enterprise contract;
- selected outcome- or value-linked models.

## 3.2 Job B — Distribute expert capability

### Business statement

> **I want to turn an expert’s method, Agent, knowledge, tools, and optional application Experience into repeatable software that other people can use with their own private context.**

### Representative combinations

The canonical examples and their positions across Operate, Distribute, Improve, and external/headless consumption are summarized in §3.7. Detailed capability bundles are derived in Appendix A.

### What the publisher can do

The publisher can potentially:

1. encode methodology as Agent definitions, knowledge, examples, deterministic tools, and workflows;
2. derive the methodology from their own Work, edits, approvals, rejections, and successful Artifacts instead of writing everything upfront—through the same Evidence and Revision pipeline described in §§5.8–5.9, so publishing is a governed, permissioned export into a Package Revision rather than a second authoring system or a copy of subscriber data;
3. provide a chat-heavy, minimal, or full SaaS Experience;
4. declare required Sources and Operations;
5. provide evaluators and example fixtures;
6. publish immutable versions and change logs;
7. communicate which capabilities and estimated costs the Package requests;
8. improve the product from evidence that is explicitly permitted at publisher scope;
9. distribute through an existing audience.

### What the subscriber can do

The subscriber can:

1. use the expert Agent or application;
2. connect their own private Sources and credentials;
3. retain private Work, memory, Artifacts, and outcomes;
4. approve consequential Operations;
5. apply local preferences and Experience overlays;
6. choose whether to upgrade;
7. export their data and Work;
8. later expose selected capabilities to their team or another authorized client.

### Product shapes

```text
chat-first expert Agent
small purpose-built Agent application
full branded SaaS
embedded sidecar
headless expert service
```

### Ownership promise

The Publisher owns methodology and Package lineage.

The Subscriber/Instance owner owns connected Source data, credentials, prompts, Work and Threads, Artifacts, scoped Memory and preferences, local Experience overlays, and private Outcomes.

The platform operator owns or controls infrastructure, defaults, base Evaluators, and Package registry/lineage records. It may process content-minimized Operational Facts for metering, reliability, security, and support under explicit policy; broader product telemetry is aggregate, non-attributable, and explicitly permitted.

Third-party data keeps its original license obligations.

### Business value

The publisher gains leverage, recurring revenue, and productized expertise.

The subscriber gains persistent context and repeatable access to a trusted method at lower cost than repeated one-to-one service.

### Commercial forms

- monthly or annual subscription;
- usage credits;
- team subscription;
- bundled membership or course;
- API/Agent access;
- platform revenue share later.

A creator-published SaaS is not another foundational family. It is Job A plus Job B at a more advanced distribution position.

## 3.3 Job C — Improve candidates and methods against evidence

### Business statement

> **I want humans and Agents to use proprietary and public evidence to generate alternatives, compare them, observe what actually happens, and improve both the solution and the method that produced it.**

### Representative combinations

The canonical examples and their positions across Operate, Distribute, Improve, and external/headless consumption are summarized in §3.7. Detailed capability bundles are derived in Appendix A.

### What the user can do

The user can:

1. connect proprietary and public Sources;
2. describe a problem, objective, hypothesis, or desired result;
3. express hard constraints, units, tolerances, and soft preferences;
4. generate and retain several candidate Artifacts;
5. run deterministic calculations, simulations, or constraint checks;
6. compare candidates with an incumbent;
7. review assumptions, confidence, and uncertainty;
8. approve, reject, edit, defer, or attest a result;
9. execute or test a candidate under controlled authority;
10. capture delayed real-world outcomes;
11. distinguish preference signals from actual performance;
12. compare Agent or method revisions under controlled conditions;
13. promote or roll back a revision without deleting the incumbent.

### Generic loop

```text
Evidence and context
      ↓
Problem / objective / hypothesis
      ↓
Agent exploration
      ↓
Candidate Artifact
      ↓
Deterministic checks / simulation / expert review
      ↓
Decision
      ↓
Test, deployment, or observation
      ↓
Delayed real-world Outcome
      ↓
Comparison with expectation and incumbent
      ↓
Improved candidate or method
```

### Business value

- lower cost;
- higher yield;
- improved forecast accuracy;
- improved risk-adjusted decisions;
- faster R&D;
- more alternatives tested;
- better use of expert time;
- safer, reproducible decision processes.

### Commercial forms

- paid pilot;
- professional or enterprise subscription;
- private deployment;
- research partnership;
- compute or usage pricing;
- selected value-based contracts.

## 3.4 Cross-cutting consumption modes — channel-first Agent Job Delivery and external/headless use

This is not a fourth business job. It is how Jobs A, B, or C may be requested, steered, approved, and delivered when the user is not primarily operating through a full Boring application.

### 3.4.1 Agent Job Delivery

#### Business statement

> **I want to submit a bounded job with inputs, constraints, expected deliverables, budget, deadline, and allowed effects; let an authorized Agent complete the Work asynchronously; answer questions or approvals only when needed; and receive durable, versioned Artifacts with provenance.**

Representative jobs include:

```text
research these companies
→ investment memo

analyze this dataset
→ report and dashboard

review this contract
→ issue list and revised draft

prepare this campaign
→ content package

compare these suppliers
→ sourcing recommendation

turn these notes into a deck
→ presentation
```

The customer may buy the job without initially wanting a full persistent application. The richer application can emerge later around history, connected Sources, editing, dashboards, recurring jobs, automation, team access, and outcomes.

### 3.4.2 Channel-first intake, steering, and delivery

The first interaction may occur through:

- a first-party Boring chat or composer;
- WhatsApp, Telegram, Slack, Teams, email, SMS, or voice;
- an embedded widget inside an existing application;
- MCP or another Agent-facing protocol;
- HTTP API or webhook.

The channel is an intake, steering, approval, notification, and delivery surface. It is not the durable identity of the Work.

The common lifecycle is:

```text
brief / input
→ identity, entitlement, Channel deduplication, callback/signature verification, assurance resolution, rate/abuse control, and safe attachment-security processing
        ↓
Thread-only conversation
        ↓
optional constrained Intake Run
        ↓
agreed Job Contract Revision
        ↓
customer-value Work
        ↓
full Run Admission
→ Agent execution
→ questions or Approvals when required
→ durable Artifact Delivery
→ accept, revise, reject, or close
→ optional later Outcome
```

Not every message should automatically become Work. Ambiguous or casual interactions may remain only in a Thread. Draft Work is created only when there is a plausible customer-value unit to contract, estimate, resume, or abandon explicitly.

Any model call, tool call, private Source access by an Agent runtime, sandbox execution, or customer-chargeable provider call used for clarification belongs to a separately admitted Intake Run attached to the Thread and, when applicable, draft/prospective Work. The Intake Run has a narrow budget, minimal context, no broad Source/Capability-Provider access, and an Effect ceiling excluding consequential mutation, disclosure, financial, administrative, and external Effects unless a new Admission is created.

Identity lookup, entitlement checks, duplicate detection, signature verification, rate limiting, and minimum ingress-security processing may occur before customer Work under a platform or Channel system principal; those facts remain content-minimized and are not silently charged to customer Work.

The same Work may move between channels:

```text
WhatsApp intake
→ secure Source connection in the Boring app
→ approval in the attention inbox
→ final PDF by email
```

Input, progress, approval, and delivery channels may differ. The platform must preserve one Work identity across them.

Channel policy may intentionally restrict what can happen. A messaging channel may accept a brief, show status, ask questions, and deliver secure links while refusing to expose confidential Source content, credentials, or high-risk approval controls.

### 3.4.3 External and headless machine consumption

#### Business statement

> **I want an authorized external Agent, MCP client, service, or existing application to submit structured Work to a Boring product and receive a durable result without receiving direct authority over private customer data.**

Representative shapes:

- a foreign Agent calls a research or analysis capability;
- an existing CRM requests a governed Agent result;
- an MCP client submits a job and receives an Artifact or resource;
- an external client raises a human approval in Boring only when needed;
- a headless expert Agent returns a report, draft, decision support result, or attestation.

### 3.4.4 Required channel-neutral business capabilities

- external identity binding and entitlement resolution;
- conversation-to-Work linking without making the conversation the Work identity;
- message and request idempotency;
- secure attachment import and content-origin labeling;
- purpose-scoped input Projection;
- immutable Job Contract Revision proposal/acceptance and staged Admission;
- progress, blockers, questions, and terminal status;
- approval choices tied to the exact Work, Operation, input, and Artifact revision;
- durable Artifact output and delivery receipt;
- cross-channel continuity;
- channel-specific data and effect policy;
- metering and provenance by consumer, channel, Work, and Artifact;
- no assumption that a Page, chat transcript, or workbench is required to invoke the domain behavior.

The full SaaS Experience may be the persistent control plane, while chat, WhatsApp, MCP, email, or another channel is the first point of value delivery.

## 3.5 Cross-cutting internal mode — Boring as its own operator, code factory, and improvement customer

Boring itself should be a valid customer of the platform.

Boring already uses a factory pattern in which an orchestrator coordinates worker Agents, automated review gates check their output, and items requiring human judgment are posted into an inbox. This pattern should be treated as a first-party reference use case for the platform—not as a privileged subsystem with separate semantics.

### Existing and intended factory loop

```text
backlog item / product request / defect
→ orchestrator admits and decomposes Work
→ worker Agents receive bounded child Work, Sources, budgets, and isolated execution
→ workers produce code patches, tests, reports, or Package/Experience revisions as Artifacts
→ automated gates run type checks, tests, security checks, evaluation packs, and policy checks
→ unresolved risks, diffs, and review questions become Attention Items
→ human reviews in the inbox
→ approve, request revision, reject, merge, release, or deploy
→ production and commercial evidence returns to the next cycle
```

The internal code factory may use the same capabilities to:

- inspect commercial, product, support, and repository signals;
- create product, architecture, Agent, Package, and Experience candidates;
- decompose Work across orchestrator and worker Agents;
- isolate workers by branch, worktree, sandbox, Source Projection, authority, and budget;
- generate code or declarative revisions;
- run deterministic tests, CI, benchmarks, and evaluations;
- compare candidate and incumbent behavior;
- post review-gated diffs and evidence to the same human attention inbox used by customer products;
- allocate bounded research, development, or marketing budgets;
- promote, merge, release, deploy, or reject revisions only through authorized gates;
- retain cost, latency, failure, review, deployment, and outcome evidence.

### Factory invariants

- the orchestrator may allocate and narrow Work but may not bypass policy;
- worker Agents may propose changes but may not merge, publish, deploy, or widen their own authority;
- automated review gates are versioned evaluators, not unquestioned truth;
- a worker’s self-report is not sufficient evidence that a test or gate passed;
- platform-recorded test, check, and effect receipts are authoritative;
- gates must be load-bearing: negative controls, deliberate violations, or mutation tests must demonstrate that a gate changes an admission, promotion, or review decision when its protected invariant is broken;
- a gate whose removal changes no relevant decision is an integrity defect, not evidence of safety;
- suspiciously large wins, weakened assertions, disabled instrumentation, or fabricated evidence are routed to audit rather than celebrated;
- rejected candidate patches and their reasons remain queryable so worker Agents do not repeatedly rediscover the same failed approach;
- human approval is attached to the exact diff, Artifact, platform-bound argument and policy snapshot, test state, and release candidate; any material change invalidates it;
- a failed worker or gate does not corrupt the parent Work or replace the last-known-good release;
- the same Work, Execution, Artifact, Attention, Evidence, and promotion semantics apply to internal and customer-facing products.

This is not a fourth architecture or a special self-modification bypass.

The internal operator is simply another Instance owner using the same Work, Operation, Artifact, Evidence, evaluation, and revision pathways.

## 3.6 Cross-cutting developer distribution mode — build locally, host on Boring

This is not a fourth business job. It is a distribution and platform-consumption path for developers who want to build Agent products with Boring’s framework and optionally run them on Boring’s hosted infrastructure.

### Business statement

> **I want to create an Agent or agent-native application with a normal developer workflow, run and evaluate it locally, then deploy it to Boring without rebuilding authentication, Agent runtime, Sources, governance, observability, hosting, or commercial infrastructure.**

A canonical developer journey may look like:

```bash
npx boring create my-agent
cd my-agent
npx boring dev
npx boring test
npx boring deploy
```

Possible templates may include:

- bounded job-delivery Agent;
- chat-first expert Agent;
- route-first domain SaaS;
- headless MCP/API Agent;
- background worker or automation;
- data-rich Agent with semantic queries;
- package or extension for an existing Boring application.

The developer can potentially:

- define Agents, Operations, Sources, Experience, and evaluation fixtures in versioned manifests;
- use local and hosted environments through the same durable contracts;
- bind local test Sources without embedding production secrets;
- preview requested capabilities and trust boundaries;
- deploy an immutable release;
- configure hosted Sources, secrets, domains, regions, budgets, and entitlements;
- inspect Work, traces, costs, failures, and Artifacts;
- roll back or promote a previous release;
- choose Boring-hosted, dedicated, or later self-hosted deployment paths;
- publish or sell the resulting Agent/product later without changing its runtime identity.

The deployed application should become an ordinary Package/Instance/Agent product, not a special “developer mode” runtime.

Possible commercial forms include:

- free or open-source local framework usage;
- hosted developer subscription;
- platform fee plus usage;
- per-Instance or per-environment hosting;
- enterprise dedicated deployment;
- later publisher revenue sharing or marketplace distribution.

The developer path is strategically important because it distributes the platform through builders, not only through Boring-authored verticals or creator audiences.

## 3.7 How the jobs combine

| Example | Operate | Distribute | Improve | External/headless |
|---|---:|---:|---:|---:|
| Creator Studio | High | Possible later | Outcome-aware | Optional |
| Creator’s Personal Agent | Medium | High | Personalized / package-level | Common |
| Creator-Published SaaS | High | High | Optional to high | Optional |
| Macro Research Terminal | High | Possible | High | Common |
| Investment Workbench | High | Possible | High | Optional |
| Industrial Formulation | High | Possible | High | Optional |
| SME Pipeline Tool | High | Possible | Medium to high | Common |
| Channel-First Agent Job Service | Medium | High | Optional to high | Essential |
| Developer-Hosted Agent/App | High | High | Optional to high | Common |
| Boring Internal Code Factory | High | Internal package reuse | High | High |

---

# 4. Independent evolution dimensions

The jobs above can evolve independently. These dimensions are not separate platforms.

## 4.1 Distribution

```text
private application
→ local developer project
→ Boring-hosted deployment
→ reusable internal Package
→ installed product
→ expert subscription
→ public product
→ Agent/API service
```

Capabilities may include:

- developer scaffolding, local development, testing, and deployment;
- immutable Package and release versions;
- hosted Instance creation, environment configuration, logs, and rollback;
- publisher/developer identity and lineage;
- isolated Instances;
- local overlays;
- upgrade and rollback;
- entitlements;
- private, unlisted, and public offerings;
- publisher economics;
- machine-facing access.

## 4.2 Adaptivity

```text
human-only
→ Agent-assisted
→ personalized
→ evidence-aware
→ outcome-driven
→ evaluated and recursively improved
```

The application’s domain identity does not change as it moves right.

## 4.3 Locus of initiative

```text
human-initiated
→ Agent-proposed
→ event-initiated
→ scheduled
→ queue/factory-pulled
```

Examples:

- a user asks from a Page;
- the Agent proposes a stale-opportunity follow-up;
- a new mail message creates Work;
- a data release reopens a forecast comparison;
- a lab result queues the next formulation candidate;
- a factory puller claims the next ready Work item.

Every non-human initiation must carry authority, budget, provenance, and a destination in the attention plane.

## 4.4 Per-operation autonomy

Autonomy is not a global Agent setting.

It is a policy for an Operation, Actor, and context:

```text
observe
→ suggest
→ draft
→ act with approval
→ act within policy
→ act with post-hoc review
```

A product may gradually increase autonomy for one operation while keeping another permanently human-gated.

Changing the autonomy level is itself a governed Revision supported by Evidence and revocation. The maximum autonomy allowed by the complete Effect-dimension and impact declaration in §5.5 always takes precedence over this policy.

## 4.5 Agent cardinality

```text
one Agent
→ specialized Agents
→ delegated Agent team
→ authorized external Agents
```

Capabilities may include:

- stable identity;
- roles and bindings;
- routing;
- bounded delegation;
- different authority ceilings;
- budgets;
- parent/child Work and execution provenance;
- optional debug visibility.

The user should normally see Work and results, not a swarm of chat windows.

## 4.6 Human collaboration

```text
one user
→ team
→ organization
→ controlled external collaborator
```

Capabilities may include:

- membership;
- roles;
- shared Work and Artifacts;
- comments and assignments;
- approvals;
- activity;
- personal presentation state;
- audit;
- controlled sharing.

## 4.7 Application composition

```text
one application
→ several modules
→ several installed products
→ composed personal or team environment
```

The business option requires:

- namespaced contributions;
- stable Resource references;
- package and entitlement boundaries;
- cross-application links;
- possible shared search and attention;
- optional navigation composition.

It does **not** require Part 2 to assume that one Work object must span several commercial products. Cross-application references and a shared attention plane may be sufficient. Unified cross-app Work remains an open product decision.

## 4.8 Time and causality

```text
immediate preference
→ delayed Outcome
→ vintage-sensitive Outcome
→ noisy or contested Outcome
→ never-observed Outcome
```

Capabilities may include:

- accept/edit/reject now;
- link later measurements to the originating execution and Artifact;
- freeze data vintage;
- record observation windows;
- preserve confounders and attribution confidence;
- record missing outcomes honestly;
- prevent missing data from being interpreted as success.

## 4.9 Deployment and sovereignty

```text
local
→ Swiss-hosted
→ EU-hosted
→ dedicated environment
→ customer-controlled deployment
```

The application, Agent, Work, Artifact, and Package identities should survive changes in:

- model provider;
- sandbox or compute provider;
- host process;
- storage implementation;
- region;
- deployment topology.

## 4.10 Output, liability, impact, and assurance

Not every result carries the same business or legal meaning.

| Class | Meaning | Product rule |
|---|---|---|
| **Advice** | Interpretation, recommendation, or draft. A human or professional remains responsible. | Clearly labeled; must not silently become an Action. |
| **Action** | A change to owned or external state. | Requires Authority, Effect handling, idempotency or reconciliation, and proof. |
| **Attestation** | A released or signed claim that an authorized Party or professional is willing to stand behind. | Targets an exact claim or Artifact version and records signer Actor, represented Party/role, scope, validity period, evidence, limitations, and revocation or supersession path. |

Advice, Action, and Attestation describe product and liability meaning. They do **not** by themselves describe risk.

An Operation, Package, or Release may declare a default impact floor, but the **effective impact profile is evaluated for the exact Invocation, Effect intent, Delivery, exposure, or Release change**. The same Operation may be low-impact for one record and high-impact for a large population or regulated decision.

The word **Attestation** is used in three different business contexts and must not collapse into one schema or authority:

- **business/professional Attestation** — a claim an authorized Party or professional is willing to stand behind;
- **human Attestation Decision** — an append-only Human Decision about an exact target and scope;
- **supply-chain/build Attestation** — evidence about how a Release or component was built, tested, signed, or verified.

They may share verification primitives, but their signers, liability, validity, revocation, disclosure, and intended audience differ.

A useful guidance scale is:

| Tier | Guidance |
|---|---|
| **I0** | No consequential effect; informational or local-only. |
| **I1** | Limited, bounded, and readily reversible. |
| **I2** | Consequential but bounded; meaningful financial, privacy, operational, or reputational effect. |
| **I3** | High impact, broad blast radius, sensitive population, or regulated professional consequence. |
| **I4** | Safety-critical, specially regulated, or potentially catastrophic. |

The effective profile should consider:

- blast radius and affected population;
- cumulative or repeated Effects, not only one Invocation;
- financial, physical, legal, privacy, and reputational impact;
- sensitivity and regulated-data class;
- reversibility, compensability, and detectability;
- uncertainty, novelty, and dependence on untrusted content;
- professional duties, jurisdiction, quorum, and segregation-of-duties obligations;
- available deterministic, test, receipt, and human assurance evidence.

Some products or jurisdictions may impose non-configurable impact floors or prohibited autonomy combinations. Review depth, Approval, dual control, testing, rollout, monitoring, incident response, and Attestation requirements derive from:

```text
complete Effect dimensions and reversibility
+
effective impact profile
+
available assurance evidence
```

This lets the same platform support a creator tool and a regulated research or operations product without applying identical ceremony to both.

## 4.11 Commercial and billing model

```text
free / internal
→ subscription
→ seat or Instance
→ per job or deliverable
→ usage / credits
→ retainer or managed service
→ Publisher subscription / revenue share
→ Outcome-linked or shared-value contract where attribution permits
```

Commercial structure is an independent product dimension. The platform should not assume that every vertical is billed per token, per seat, or through one marketplace model.

The business model may vary by:

- **payer/funder:** subscriber, Instance-owner Party, Publisher, enterprise contract, external consumer, or platform subsidy;
- **unit sold:** access, seat, Instance, Work/job, Artifact/Delivery, usage, compute, service level, or measured Outcome;
- **cost bearer:** platform, Publisher, subscriber through bring-your-own-provider credentials, or a negotiated combination;
- **commercial relationship:** self-service subscription, prepaid credits, monthly retainer, paid pilot, annual enterprise contract, developer hosting, revenue share, or value-based agreement;
- **settlement:** direct invoice, payment-provider collection, Publisher payout, internal cost center, or no external payment.

The stable premise is that Payer Binding and Usage Facts are attributable at Admission and execution time. Entitlement, pricing, billing, tax, collection, and settlement remain configurable commercial policy.

Section 5.16 defines the full commercial-layer separation. This section only establishes that commercial models are independent from product shape and adaptivity.

Outcome-linked pricing is appropriate only when the Outcome Definition and attribution are sufficiently credible. The system must never invent certainty merely to support a billing model.

# 5. Required business capabilities

This section describes the capability space. It does not decide implementation order.

## 5.1 Purpose-built Experience capabilities

The same platform must support:

```text
normal route-first SaaS
minimal expert-Agent product
research workbench
chat-first product
headless product
```

Required capabilities may include:

- domain-owned navigation;
- routed Pages;
- reusable Views;
- tables, records, forms, charts, documents, editors, timelines, maps, and dashboards;
- optional workbench hosting with tabs and panes;
- chat as an optional View over Work;
- ambient Agent presence;
- Agent drawer or dedicated Agent page;
- semantic deep links into exact records, Artifacts, or Work;
- responsive presentation and localization: interface language, Agent working language, and multilingual Sources, configurable per user and per Instance;
- branding and themes;
- personal View state separate from shared Work;
- deterministic rendering without a model call;
- an explicit, testable continuity surface and honest fail-closed behavior.

### Agent presence modes

Products may choose:

```text
hidden
ambient
drawer
page
roster
```

`ambient` is often the natural SaaS mode:

- suggestions;
- background completions;
- attention items;
- inline actions;
- small composer;
- approval cards.

No presence mode changes the domain operation model.

### Navigation and presentation rules

- stable product destinations belong in navigation;
- active Work objects may appear as tabs where useful;
- tabs and panes are presentation state, not business identity;
- a file tree is a navigator into a Source, not the document View itself;
- an Agent opens a semantic target or View intent, not a concrete React component or Dockview panel ID.

## 5.2 Attention plane and human-control channels

The human’s universal control surface for asynchronous Agent work is not necessarily chat. It is the bounded queue of things requiring judgment.

An **Attention Item is the request** for human attention. A **Human Decision is the append-only response**. They have independent lifecycles: an Attention Item can be reassigned, superseded, cancelled, or expired without fabricating a Decision. Reassigning an item does not delegate Authority.

The attention plane may contain:

- approvals;
- questions;
- reviews;
- exceptions;
- production, Delivery, failure, and blocker notices for background Work;
- unknown external Effects;
- Outcome confirmations;
- budget-extension decisions;
- escalations;
- reminders.

Required capabilities:

- one Attention Item links to the exact Work, Artifact, record, Operation Invocation, Effect, or Revision;
- every item states in one line **why it exists**: the policy, uncertainty, conflict, budget condition, or failed reconciliation that triggered it;
- accept, edit, reject, defer, delegate, reassign, or request more evidence;
- batch review for repetitive low-risk items;
- safe batch review only when targets, Operation contracts, effect classes, recipients, preconditions, and risk are homogeneous or when an exact Effect Group declares the membership and cumulative impact;
- batch Approval binds the full membership/order or declared set semantics, cumulative amount/blast radius, group Approval digest, and all-or-nothing versus best-effort policy; a changed member invalidates the group Approval;
- propose a policy/autonomy change instead of endlessly repeating approvals;
- deadlines, escalation, and ownership;
- ranked attention by urgency, value, risk, assurance, and human budget;
- deterministic ranking inputs and policy version: priority is computed from platform-recorded deadlines, impact, uncertainty, service class, cumulative exposure, and declared human budget—not from how alarming or persuasive an Agent writes its prose;
- model-generated summaries may explain an item but may not raise their own authoritative priority without a separately recorded platform fact or Human Decision;
- personal channel preferences;
- answer from in-app UI, email, chat, mobile notification, or another approved channel;
- audit who responded, where, under which Actor identity, assurance level, and Party;
- preserve the same Approval and Human Decision semantics across products and Channels;
- use distinct decision kinds and schemas for Approval, acceptance, attestation, promotion, override, rejection, and deferment;
- target an exact Work, Operation Invocation, planned Effect digest, Artifact version, Delivery, record version, or Revision;
- reject stale targets across in-app, email, chat, mobile, and API Channels;
- treat editing as creation of a new target version that requires a new Decision.

Every Attention Item must declare an **unanswered policy**:

```text
block
escalate
auto-decline
proceed-with-declared-default
```

`proceed-with-declared-default` is permitted only for observe, compute/simulate, or propose behavior whose default is explicit and safe. Timeout must never auto-approve a mutate, external-effect, administrative, or high-impact Operation.

### Approval integrity, Authentication Context, step-up, and quorum

An Approval is authority over one exact rendered proposal—not a reusable “yes.”

Required capabilities include:

- bind the Approval to an immutable, canonically encoded intent digest covering the Operation and contract version, exact target and record/Vintage preconditions, resolved business input, accepted Job Contract Revision, Artifact/proposal revision, complete Effect set or Effect Group, recipient/destination, policy decision/revision, decision-relevant obligation digest, payer/quote reference where material, cost/quantity ceiling, and expiry;
- bind the deciding Actor to an exact Authentication Context and represented Party/role; a Channel Binding is not sufficient evidence of transaction assurance;
- invalidate the Approval when any material input, target, recipient, Effect membership/order, authority basis, obligation, state precondition, Artifact revision, Job Contract Revision, displayed estimate beyond tolerance, or cost/quantity ceiling changes;
- consume a single-use Approval atomically with authorization of the exact Effect intent or Effect Group so concurrent dispatchers cannot spend it twice;
- make reusable Approval possible only through a separate, explicit policy defining scope, maximum uses, cumulative impact, expiry, revocation, and monitoring;
- record grant, denial, abstention, expiry, revocation, replay attempt, supersession, and failed consumption as durable Human Decisions;
- bind edit-and-approve to the exact edited target that will execute; editing creates a new target and digest;
- revalidate Actor, represented Party, Authentication Context, mandate, quorum, separation of duties, current policy, obligations, target version, budget, and authority immediately before consequential commit.

Every Approval surface uses a versioned **Approval Display Spec** rendered from typed platform facts. Where applicable it declares:

- action and Operation identity;
- target, recipient/destination, selector, quantity, amount, currency, tax treatment, unit, rounding, locale, and time zone;
- Artifact/diff or Effect Group membership, ordering, cumulative blast radius, reversibility, and known uncertainty;
- Source/Vintage and state preconditions;
- quote basis, estimate range/tolerance, expiry, and maximum cost;
- policy/obligation reason, required approver roles, quorum, and separation-of-duties rule;
- truncation, redaction, pagination, attachment, and “view full details” behavior.

Model-authored or untrusted prose is escaped, visibly attributed, and secondary. It cannot define the primary action label, amount, recipient, target, risk tier, diff, quorum, or confirmation control.

Quorum is a lifecycle, not a count field. The Approval target declares eligible roles/Actors, required combinations, ordering, independence, substitutions, recusals, abstentions, expiry, membership-change behavior, revocation, and what happens if one Decision becomes invalid after others were recorded. Quorum satisfaction is a platform-derived fact over still-valid Decisions.

Policy obligations also have independent lifecycle: required, pending, fulfilled, failed, waived by authorized override, expired, invalidated, or post-condition-breached. Each obligation names its enforcement point, due time/freshness, evidence producer, failure and compensation/escalation behavior, authorized waiver, and any post-condition monitoring window. “Allow with obligations” is not an allow until all commit-time obligations are satisfied; a later monitored breach creates a durable finding and governed response rather than rewriting the original decision.

Step-up creates a new Authentication Context bound to the Actor, transaction purpose, target digest, factor/device/session evidence, issue/expiry, and anti-replay state. Break-glass and support access use the same explicit pattern: request, reason, eligibility, step-up, narrow grant, active session, actions, expiry/revocation, post-review, and incident link. Neither may be hidden as ordinary impersonation.

A low-friction Channel may collect a brief, answer questions, or approve low-risk Work while routing consequential Decisions to a stronger approved Authentication Context.

### Attention budget

A useful product promise may be:

> **This system will consume no more than N human decisions or M human minutes per day unless a declared incident occurs.**

Human attention should be measured alongside model, compute, and external-provider cost.

The platform should be able to report:

- decisions and Attention Items per delivered Artifact;
- human minutes per accepted or contract-closed Work;
- approval rework and escalation rate;
- how these measures change as autonomy increases.

A falling attention ratio at stable Outcome quality is evidence that autonomy is saving work. A rising ratio means the system may be relocating work into review.

## 5.3 Durable Work, causal continuity, recoverability, and service quality

Work must survive:

- browser closure;
- device change;
- model-provider outage;
- Agent process death;
- sandbox or compute expiration;
- network interruption;
- duplicate submission;
- partial Operation success;
- uncertain external Effects;
- budget exhaustion;
- retry, delegation, and runtime replacement.

The durable model is a **typed causal relation graph**, not a linear pipeline:

```text
Party --Binding/role--> Actor
Party --owns or controls--> Instance
Instance --contains--> Work
Thread --may have--> constrained Intake Run
Work --may have--> child Work
Work --has--> full Execution Run
Run --has--> Attempt
Attempt --may hold--> worker claim / Lease / fence
Attempt --contains--> Model Invocation
Run --causes--> Operation Invocation
Invocation --may produce--> Artifact version
Invocation --may create or observe--> Effect
Attention Item --requests--> Human Decision on an exact target
Delivery --hands off--> exact Artifact version
Outcome --may observe--> Work, Artifact, Effect/group, domain state, Release, or exposure
```

This graph does not imply that every Artifact is Agent-produced, every Outcome follows a Delivery, or every child Work is merely a retry. It does not require universal event sourcing. It does require that independent lifecycles are not overwritten into one row or reconstructed from logs.

### Independent lifecycle families and orthogonal Work facets

Part 2 may represent these as related records rather than separate root aggregates, but it must not compress them into one mega-state.

**Work does not have one universal linear status.** It has orthogonal business facets whose combinations must be validated:

- **contract facet:** exploratory / no Work yet, draft, requested, contracted, declined, or withdrawn;
- **control facet:** inactive, active, waiting-for-human, blocked, paused, cancelled, or closed;
- **fulfillment facet:** not-started, partial, produced, unable-to-fulfill, or superseded;
- **budget/service facet:** within-budget, near-ceiling, paused-over-budget, service-at-risk, or service-breached;
- **Delivery facet:** represented by the separate Delivery lifecycle;
- **Decision facet:** pending, accepted, revision-requested, rejected, or superseded through Human Decisions;
- **Outcome facet:** represented by the separate Outcome-observation lifecycle.

A failed Attempt or Run does not automatically fail the Work. The Work may admit another Run, narrow scope, deliver partial Artifacts, request revision, or close as unable-to-fulfill according to its Job Contract and policy.

Other lifecycle families remain distinct:

- **Job Contract Revision:** proposal/control, fulfillment/supersession, and dispute are orthogonal. A revision may be proposed, accepted/rejected/withdrawn, fulfilled/terminated/superseded, and independently disputed/resolved/reopened. Existing Runs remain bound to the revision they admitted.
- **Work control:** draft, requested, contracted/ready, active, waiting-for-human, paused, cancelled, terminally failed, archived, or closed. A failed Run does not by itself make Work terminally failed.
- **Work fulfillment:** none, partial, produced, contract-satisfied, superseded, or invalidated for each deliverable contract.
- **Work budget/service:** within limits, near limit, paused-over-budget, deadline-at-risk, service-breached, or dispute-held.
- **Acceptance/rejection/revision request:** append-only Human Decisions targeting exact deliverables or Artifact versions under an exact Job Contract Revision.
- **Thread / External Conversation / Message:** independent histories; a provider edit/delete creates a new Message version or tombstone and never mutates admitted Run input.
- **Channel Binding and Authentication Context:** bindings are active/suspended/revoked/recovered; Authentication Contexts are issued/stepped-up/expired/revoked/compromised and transaction-bound where needed.
- **Execution / Run:** pending admission, admitted, queued, provisioning, running, paused, blocked, succeeded, failed, or cancelled. Intake Runs may be Thread-linked without full Work; full Runs attach to Work and an accepted Job Contract Revision.
- **Attempt:** one worker/runtime generation with immutable runtime identity and checkpoint lineage.
- **Lease / fence:** offered, active, renewed, expired, revoked, transferred, or fenced. The authoritative scheduler/store advances a monotonically increasing fence epoch whenever publishing authority is newly issued, replaced, transferred, or forcibly revoked; renewal of the same still-valid ownership may retain the epoch. Every authoritative commit proves the current epoch transactionally, and recovery can explain which issuance superseded a stale worker.
- **Model Invocation:** prepared, dispatched, streaming, succeeded, failed, cancelled, or provider-unknown. One Attempt may contain several calls, cache hits, and fallbacks; those routing choices do not by themselves create new Attempts.
- **Operation Invocation:** proposed, validated, authorized, running, succeeded, partially succeeded, failed, cancelled, or indeterminate according to contract.
- **Effect / Effect Group:** independent intent, dispatch, observation, resolution, and compensation dimensions defined in §5.5.
- **Delivery intent:** proposed, prepared, authorized, cancelled, expired, or superseded per destination and exact Artifact/result version.
- **Delivery dispatch attempt / Effect:** not-dispatched, dispatching, provider-accepted/declined/failed, partial, or Effect-unknown, with reconciliation beneath the exact intent.
- **Handoff/access:** not-available, access-granted, available, access-expired/revoked, or unavailable; **recipient acknowledgement** is separate and provider-qualified; **acceptance** is a separate Human Decision; **withdrawal** is an attempt/notice with no implied recall.
- **Outcome observation:** pending, observed, missing, corrected, contested, adjudicated, or withdrawn.

User-facing labels such as “Produced,” “Delivered,” “Accepted,” or “Successful” are projections over these facts and must not overwrite their histories. Work split/merge/fork/reopen/archive and duplicate consolidation retain explicit lineage and economics-allocation rules.

Required capabilities include stable identities, exact causation, append-only transitions/corrections, optimistic concurrency, current-state projections, and preservation of partial Artifacts, Usage Facts, Decisions, Effects, and Delivery facts across failure. A delegated customer-value unit may be child Work; a retry or replacement worker is an Attempt beneath the same admitted Run.

### Performance, context efficiency, and progressive results

Performance is part of the product contract, but it must not be achieved by weakening Authority, privacy, deterministic checks, provenance, or declared quality floors.

Capabilities may include:

- stage budgets for intake, context construction, model/tool/kernel execution, persistence, rendering, Attention, and Delivery;
- progressive Operation and catalog discovery instead of injecting the complete catalog into every model context;
- purpose-scoped retrieval with row, token, byte, time, and freshness limits;
- query pushdown, incremental synchronization, deterministic precomputation, and permission-aware materialization;
- cache reuse only when Authority, information-flow constraints, Source/Vintage, contract versions, locale, units, limits, and every result-changing semantic match;
- policy-safe, versioned model/tool routing that does not silently change quality, region, provider eligibility, or privacy;
- bounded parallel exploration for observe, compute/simulate, and propose paths, with shared budgets and no duplicate external Effects;
- provisional streaming or partial results clearly labeled as non-contractual until a valid Artifact version or Delivery exists;
- degradation that reduces enrichment, breadth, or freshness honestly rather than returning stale, unauthorized, truncated, or semantically incompatible data as a performance success.

### Admission-first invariant

Every model call, tool or Capability Provider call, Agent-runtime Source retrieval, sandbox execution, domain Effect, and customer-chargeable provider call must belong to an admitted Run. Agent-assisted clarification uses a constrained Intake Run; it is not an exception.

Minimum deterministic ingress may precede a Run only under an attributable platform or Channel principal and only for transport integrity, signature/webhook verification, size/schema checks, identity/entitlement lookup, anti-abuse, malware/archive safety, and routing. It may not read unrelated private Sources, create domain Effects, or produce unattributed customer charges.

A constrained **Intake Run** must capture:

- Thread, Message, External Conversation, Channel Binding, Actor, represented Party, and available Authentication Context;
- optional prospective/draft Work, but no automatic conversion of every conversation into Work;
- purpose, allowed clarification outputs, retention/deletion policy, and expiry;
- Agent revision, model/fallback/cache/data-use policy, tool/Capability Provider allowlist, Source allowlist, and information-flow ceiling;
- no consequential Effect authority and no unrestricted private Source access by default;
- payer, subsidy, or platform-ingress funding basis; budget, rate, and attention ceiling;
- exact outputs retained as Message, proposed Job Contract Revision, estimate, or discarded scratch;
- ordinary audit, Usage Facts, taint, and incident handling.

A full Execution Run must additionally bind Work, exact accepted Job Contract Revision, canonical Run identity, Agent binding/revision, controlling and represented Parties, Party Relationship/mandate where applicable, authority ceiling, policy decision/obligations, Context Manifest, Payer Binding, budget/reservation, provider/credential policy, service and Quality Claims, Delivery policy, impact ceiling, and originating causality.

The Admission snapshot is immutable historical context and a maximum ceiling. Effective authority at each sensitive step is the intersection of that ceiling with current Binding/Grant, mandate, current policy and fulfilled obligations, current Authentication Context and credential scope, delegation caveats, exact Approval, target/Vintage preconditions, remaining budget, and impact ceiling. Revocation or stricter policy narrows immediately; relaxation never widens the Run.

An append-only amendment may narrow scope, extend time, or add reservation within the same payer, purpose, Source classes, authority, impact, and accepted Job Contract Revision ceiling. A new payer, purpose, Source class, represented Party, material Job Contract Revision, authority widening, or higher Effect/impact ceiling requires a new linked Run.

### Idempotency layers and identity semantics

Duplicate control is layered; no single identifier silently serves every purpose:

1. **Message/event ingestion** — provider, account/Channel Binding, provider event/message ID, version/edit/delete marker, webhook signature, and retention window.
2. **Attachment/import/upload** — Instance, uploader, content digest, import purpose, Source Connection/Resource target, malware/classification result, and conflict policy.
3. **Work-intent consolidation** — a product-specific similarity/exact key that may link duplicate requests to existing Work without erasing either intake record.
4. **Admission decision** — caller/Actor, Instance, purpose/endpoint, request key, canonical request digest and canonicalization version mapped to one accepted/refused Admission Decision and, if accepted, one canonical Run.
5. **Operation Invocation** — Run, Operation contract version, Invocation key/digest, target preconditions, and declared retry semantics. Queries or failed validation may have no Effect identity.
6. **Effect / Effect Group** — stable intent or group identity, immutable membership/digest, provider idempotency scope/window, and reconciliation semantics.
7. **Delivery** — exact Artifact/result version, destination, delivery purpose, intent ID, provider attempt, and handoff/access receipt.
8. **Asynchronous callback/webhook** — provider, external operation/effect/delivery identity, callback event ID/version, signature, ordering, and reconciliation state.

For every layer, the contract declares issuer, scope, canonicalization, same-key/same-digest result, same-key/different-digest conflict, retention, expiry, privacy treatment, replay behavior, and recovery after deduplication state loss.

`RunId := RequestKey` remains permissible only when the ratified `RequestKey` is itself the permanent, host-resolved, deployment-independent canonical Run identity. Otherwise the idempotency binding and `RunId` remain separate. Admission idempotency maps to one precise Admission Decision and canonical Run—not an ambiguous “Work/Run result.”

One Operation Invocation may create zero, one, or many Effects. Retrying an Invocation does not invent or reuse Effect identity except according to the Operation’s declared semantics.

Before any Work exists, the platform may perform only the unavoidable ingress functions needed to receive a request safely: transport termination, identity or callback verification, duplicate and abuse detection, entitlement lookup, attachment scanning, archive/path/macro/formula safety checks, and storage of the Channel message as untrusted content. These steps are not domain execution and must not call a model or broad domain tool.

When model-assisted clarification is required before full Work is contracted, it uses a separately admitted Intake Run. The Intake Run has its own Run identity and Usage Facts, remains attached to the Thread and optional prospective Work, and cannot inherit the payer, Authority, Source classes, impact ceiling, or Effect rights of a later full Run by implication.

### Admission amendments and material change

An Admission snapshot is immutable. A linked amendment may only:

- narrow scope or Authority;
- reduce the Effect or impact ceiling;
- extend time within the same service and policy ceiling;
- add budget or capacity reservation from the same Payer Binding and entitlement;
- clarify non-material Delivery preferences.

A new payer or funding source, purpose, Source class, credential policy, Authority ceiling, impact ceiling, recipient class, materially changed Job Contract, or widened data-use purpose requires a new linked Run and a new Admission decision. Amendments cannot retroactively rewrite Usage Facts, prior Effects, or the context under which an earlier Attempt ran.

### Admission, scheduling, budget reservation, and backpressure

Long-running, delegated, and externally initiated Agent work needs an operational contract:

```text
resolve Channel/message deduplication and caller-scoped Admission idempotency
→ keep the interaction Thread-only or create/recover draft Work as appropriate
→ perform attributable deterministic ingress validation
→ admit a constrained Intake Run on the Thread, linked to draft Work when present, when clarification needs a model, tool, private Source, or sandbox
→ agree and validate the proposed Job Contract Revision
→ estimate cost, time, attention, capabilities, and impact
→ quote or obtain consent where required
→ reserve budget, concurrency, service, and attention capacity
→ admit, defer, or reject the Execution Run
→ create Attempt 1 and offer a fenced worker claim
→ lease, heartbeat, checkpoint, renew, fence, or replace with a new Attempt
→ release unused reservation
→ append estimated, accrued, corrected, and reconciled Usage Facts
```

Required capabilities may include:

- pre-Admission estimates based on the proposed Job Contract Revision, declared service class/Quality Claims, and comparable prior Work;
- incremental reservations and explicit overrun choices rather than one unbounded reservation;
- quotas, priority, deadlines, fairness, anti-starvation, and noisy-neighbor protection;
- bounded Agent fan-out, recursion depth, and delegated budget;
- capacity-aware handling of human Attention so automation cannot create an unbounded review queue;
- residency-, policy-, data-, and provider-aware placement;
- durable worker claims with heartbeat, orphan detection, transfer, and fencing so stale workers cannot publish;
- cooperative cancellation and checkpointing with explicit too-late/partial/Effect-unknown semantics;
- retry budgets, provider circuit breakers, API backpressure, and load shedding;
- separate admission, start, production, Delivery, and Outcome service indicators;
- idempotent Admission scoped to caller, Instance, purpose/endpoint, Work intent, canonical request digest, request-key lifetime, and conflict behavior;
- explicit refusal rather than an unsupported claim of universal exactly-once execution.

Hard overruns pause, reduce scope, switch provider only within the admitted policy, partially deliver, or fail safely. A quote is a usage and service estimate, not a price or invoice; its basis, uncertainty/tolerance, expiry, and material-change threshold should be visible where consent or Approval depends on it.

### Atomic commit, event delivery, and consistency contract

Part 2 must define a local atomic commit boundary—or a documented, tested equivalent when one transaction is impossible—covering every authoritative transition that must not diverge. Depending on the command, that set may include:

```text
business state / lifecycle transition
durable audit fact
outbox notification
Artifact metadata or version pointer
Usage Fact / reservation adjustment
Attention Item or Human Decision relation
Delivery intent or state
Effect or Effect Group intent/state
```

An “equivalent” must name the consistency owner, invariant, failure detector, repair/reconciliation procedure, maximum inconsistency window, user-visible state, and conformance evidence.

Distributed delivery assumes at-least-once, duplicate, delayed, reordered, replayed, and occasionally missing notification. Each consumer identity/version owns durable inbox state keyed by producer/event identity plus semantic deduplication key, with declared retention, retry horizon, compaction, and behavior after expiry or state loss. Outbox publication has backlog/freshness objectives, bounded retries, poison/dead-letter quarantine with named owner and response deadline, replay authorization/tooling, compaction rules, and recovery that cannot overtake required per-subject order or silently skip an invariant-bearing event.

Events support correction, supersession, and retraction; they do not delete prior facts. Poison events cannot block unrelated subjects. A consumer that cannot safely understand a schema/version quarantines it and does not guess.

Every authoritative worker commit carries Run, Attempt, and current monotonic fence epoch; stale epochs are rejected transactionally. Effect dispatch additionally relies on stable intent, provider idempotency, receipts, and reconciliation—not the Lease alone.

Each Operation contract declares the read consistency it needs: exact Snapshot/Vintage, read-your-writes, monotonic, bounded-stale, current/linearizable where available, or explicitly best-effort. If the requested level is unavailable, the Invocation fails, blocks, or returns an explicitly typed degraded/stale result according to that contract; it never silently substitutes weaker semantics. Derived Projections expose source watermark, freshness, coverage, rebuild/quarantine transition, policy-filtering stage, read-your-writes support, and actual consistency to clients. Per-subject sequence and causation define local order; wall-clock time never claims a global total order.

### Durable orchestration, code upgrades, cancellation, and deadlines

Long-lived Runs may outlive processes, workers, checkpoints, model deployments, and Boring Releases. Required semantics include:

- a Run records the orchestration definition/revision and history schema; each Attempt records worker build, runtime/Execution Profile, environment digest, model/tool adapters, and fence epoch;
- orchestration code is replay-deterministic: time, randomness, network, model, Source, kernel, and external calls occur only through recorded Invocations/activities or explicit version markers;
- a checkpoint manifest records producer Run/Attempt and fence epoch; orchestration/history and checkpoint schema versions; runtime/Execution Profile/environment digest; state and pending-activity schema; Artifact/Effect/Delivery/Usage watermarks; exact Source/Projection/Vintage and dependency references; information-flow, retention, residency, and secret-reference policy; content digest; portability/compatibility range; created/expiry time; and validation result;
- checkpoint retention, cleanup, export, and restore are policy-controlled. A checkpoint may resume only its authorized Run unless a separately admitted fork/replay explicitly treats it as an input, remaps identity, strips or rebinds secrets, revalidates Sources/Vintages and policy, and records that it is not continuation of the original Attempt;
- same-generation reconnect or Lease renewal may continue one Attempt; process loss, replacement worker, incompatible checkpoint, changed execution policy, or history migration creates a new Attempt;
- before deployment, orchestration revisions pass replay-determinism and active-history compatibility tests against representative and adversarial retained histories; the test/gate result is a Release fact;
- deploying new code never silently reinterprets old history: active Runs continue under a stable continuation/orchestration identity on compatible old logic, pass an explicit version marker, or undergo a tested history/checkpoint migration;
- history growth has versioned compaction/checkpoint rules whose producer, input range, digest, retained invariants, deletion authority, and verification are auditable; compaction preserves the declared replay grade, pending Effects, causality, continuation identity, and terminal digest;
- cancellation and deadline propagation distinguish requested, acknowledged, too-late, partially completed, Effect-unknown, compensation-required, and abandoned-with-notice outcomes;
- retry policy distinguishes transient, throttling, permanent, validation, policy, budget, cancellation, deadline, data-quality, and Effect-unknown failures;
- corrupted or nondeterministic history enters a governed repair path with operator authority, before/after digest, audit, and no silent fabrication;
- rolling deployments, worker termination, checkpoint restore, Lease loss, delayed activities, and version skew are exercised with active Runs.

A model fallback or one provider call does not by itself create a new Attempt; actual calls are Model Invocations within the current Attempt unless worker/runtime generation changes.

### Budget exhaustion

Budget exhaustion is a first-class Work condition. It drives a visible `paused-over-budget` control state where continuation is still possible, while preserving independent fulfillment, Delivery, acceptance, Effect, and Outcome histories.

When an Execution reaches its authorized ceiling, the platform should:

1. checkpoint the Attempt where possible;
2. preserve incurred Usage Facts and produced Artifacts;
3. stop new model/tool/external usage;
4. create an Attention Item offering bounded choices such as extend budget, narrow scope, deliver partial results, or cancel;
5. never silently continue and never discard produced work.

### Bounded Agent Job Delivery

A bounded job should support:

- structured or conversational intake;
- required-input validation;
- Thread-only conversation where no plausible Work exists, or draft Work plus a constrained Intake Run when Agent-assisted clarification is needed before the Execution Run;
- an explicit deliverable contract;
- budget, deadline, and service-level constraints;
- progress and blocker states;
- questions and approvals that pause and resume the same Work;
- partial Delivery where the contract allows it;
- versioned Artifact Delivery;
- acceptance, revision request, rejection, cancellation, and closure;
- verifiable Delivery receipt and notification;
- last-known-good fallback for refreshable or recurring jobs when the exact accepted Job Contract Revision allows it, with explicit stale state, freshness, Source/Vintage provenance, and the failed latest attempt;
- optional later Outcome association.

A job may be initiated and delivered through different Channels. External message and conversation IDs link to Work rather than replacing its identity.

### Work economics

Every significant Work item and Artifact should be able to carry:

- model/provider usage;
- tool or deterministic-kernel cost;
- sandbox or compute time;
- external API cost;
- human attention time where known;
- success, failure, partial, or unknown status;
- Actor and Agent revision;
- originating Channel and consumer;
- value or Outcome references.

These are Usage Facts, not invoices.

They enable later pricing, margins, budgets, service quotes, and optimization of result per euro and human minute.

### Last-known-good continuity

When a refresh, evaluator, candidate revision, Package upgrade, semantic query, deterministic kernel, compiled composition, or recurring job fails, the product should preserve the last validated result or incumbent where policy permits.

Required capabilities include:

- retain the last-known-good Artifact, View data, Package/Release, Agent revision, compiled composition, or calculation result;
- label it clearly with freshness, Vintage, provenance, and the failed refresh or upgrade state;
- never replace an incumbent merely because a challenger started running;
- preserve a valid Delivery when a later enrichment step fails;
- let products fail closed instead of serving stale data where time-critical, regulated, or safety-sensitive policy requires it;
- make recovery, refresh, reconciliation, and rollback explicit rather than showing a blank or silently degraded result.

Last-known-good is a trust feature, not permission to hide failure.

## 5.4 Actor, Agent, memory, and identity capabilities

Required capabilities:

- stable human, Agent, automation, service, and external-client identity;
- immutable Agent behavior revisions;
- explicit binding of an Agent into an Instance or product context;
- role, capability ceiling, budget, and model policy per binding;
- current semantic context projection;
- structured outputs;
- human approval requests;
- parent/child execution provenance for delegation;
- per-Agent and per-Work budgets;
- revocation;
- cost attribution;
- optional subscriber-local personalization;
- optional multi-Agent routing;
- exact Agent revision and binding revision on every consequential Run.

### Agent identity invariant

An Agent’s stable identity is issued in a collision-resistant namespace controlled by an identified Party or trusted issuer and uses a stable subject identifier. Identity, issuer/owner, behavior Revision, Package membership, Instance Binding, model policy, Memory, runtime process, and commercial entitlement remain separate.

Applications and subscribers may constrain or personalize an Agent through Bindings and scoped overlays. They do not silently mutate the Agent identity or approved definition lineage.

Identity lifecycle is explicit:

- **revision** changes behavior under the same Agent identity and always creates an immutable Agent revision;
- **fork/derive** creates a new Agent identity and lineage edge, retaining permitted provenance without inheriting Authority;
- **transfer of control** changes the controlling Party/issuer only through an authorized transfer record, acceptance, effective time, policy review, and continuity or re-consent rules;
- **revocation or suspension** stops new Bindings/Runs according to policy without deleting historical attribution;
- **compromise recovery** rotates credentials and signing keys, quarantines affected revisions/releases, identifies the exposure window, and records whether the stable identity is retained or replaced;
- **namespace migration** uses an explicit old-to-new mapping, collision check, signature/trust proof, replay protection, and deprecation window rather than reusing an unqualified display name.

Changing instructions, Operation/tool requirements, schemas, examples, model-routing constraints, or other behaviorally relevant configuration without creating a new Agent revision is prohibited. No transfer, fork, namespace migration, or revision silently carries Instance Authority, subscriber Memory, credentials, or entitlements.

### Memory scope

Every Memory item should declare:

- subject, claim type, and whether it was asserted, inferred, extracted, or summarized;
- controlling Party and owner;
- user, Instance, organization, Publisher/Package, platform, or separately controlled cross-product user scope;
- purpose, permitted consumers, and retrieval conditions;
- provenance and producing Work/Decision;
- sensitivity and information-flow constraints;
- retention or expiry;
- confidence, contradiction links, correction history, and supersession.

```text
user-local
Instance-local
organization-local
cross-product user context under an explicit controlling Party
Publisher/Package-level content authored or lawfully curated at that scope
platform-level content authored or lawfully curated at that scope
```

A Memory write is a governed proposal, not an unrestricted model side effect. Summarization creates a new derived item with lineage rather than overwriting its inputs, and correction/deletion propagates according to policy.

A subscriber-derived item never becomes Publisher/Package- or platform-level mutable Memory merely through use, opt-in wording, or summarization. Cross-boundary learning follows the explicit path already required elsewhere:

```text
permissioned Evidence export
→ declassification / aggregation / review
→ curated Knowledge, evaluation fixture, or immutable Package/Agent Revision
```

Cross-product personal continuity, if offered, remains controlled by the user or another explicit Party and requires separate consent, purpose, revocation, export, and deletion semantics; it is not Publisher ownership or platform training data.

Publisher/Package- and platform-level Memory may also be authored directly or lawfully curated from non-subscriber Sources. Subscriber-derived mutable shared Memory must not become a shortcut around governed Evidence export, declassification/aggregation, Knowledge curation, or an immutable Package/Agent Revision.

A user may explicitly attach controlled cross-product context to selected Work or Instances. That attachment is revocable, purpose-scoped, and visible; it does not create ambient global Memory across every product.

Memory is not Evidence. Evidence is not automatically retrieval Knowledge.

## 5.5 Domain Contract, Operation parity, Effects, and deterministic kernels

### Domain Contract

The Domain Contract makes the application’s nouns, verbs, schemas, errors, Effects, and compatibility semantics discoverable to humans, Agents, automations, Packages, external clients, and developer tooling.

Every Operation has a stable contract identity and explicit version. Compatibility is semantic, not merely syntactic: a change can be breaking even when the JSON still validates.

A contract may need to declare:

- input, output, warning, partial-result, and stable error schemas/codes;
- units, locale, time semantics, ordering, pagination, streaming, and truncation;
- Operation kind; complete possible Effect dimensions; default impact floor; reversibility, reconciliation, and idempotency scope/window;
- preconditions, concurrency/Vintage requirements, cancellation, timeout, and limits;
- Authority and information-flow obligations;
- unknown-field behavior and supported client/contract ranges;
- cost, freshness, and quality characteristics;
- deprecation, migration, and removal policy;
- current-context Projection and lower-level governed escape hatches where necessary.

Typed clients, mocks, SDKs, and Agent-tool schemas may be generated from this authoritative definition, but generators remain extensions rather than a second contract source.

### Canonical identity, references, record versions, and commitments

Part 2 must distinguish:

- stable internal identity from external-provider IDs and import mappings;
- mutable **record version** / ETag from immutable business Revision, Package Version, Artifact version, Source Vintage, and content digest;
- caller idempotency keys from canonical Work, Run, Invocation, Effect, Artifact, and Delivery identities;
- a typed Resource reference from Authority—the reference names a target but never grants access.

Durable internal IDs should be opaque and deployment-independent unless content addressing is intentionally part of the identity, as for a verified Release or immutable content object. Copy, move, fork, restore, and import must declare whether IDs are preserved, remapped, or linked; external IDs remain mappings rather than hidden canonical identities.

Every signed or hashed intent, Artifact, Release, receipt, or portable manifest needs a declared canonical encoding, schema version, algorithm identifier, signer/key identity, and rotation/revocation semantics. Predictable or sensitive content must not rely on a publicly enumerable raw digest as its only privacy boundary. Where external verification is required, the product should use policy-appropriate disclosure: public digest for content already disclosed to the verifier, a keyed commitment within one trust domain, or a selectively disclosed signed receipt.

Consequential writes use exact record/Vintage preconditions or `if-match` semantics. Durable facts distinguish occurred/effective/observed time from recorded time and preserve causation plus per-subject sequence; wall-clock order alone is not authoritative.

### Operation parity

An Operation is the semantic contract for a domain act. Every meaningful **delegable** act must be addressable by every Actor class that the product claims may perform it, through the same business semantics.

Shared semantics include validation, concurrency, Operation kind, complete Effect dimensions, idempotency, reconciliation, information flow, audit, cost, and Outcome linkage. Actor classes may legitimately receive different schemas/projections, hidden platform-bound fields, limits, assurance requirements, and subsets. Authorization is evaluated independently for each Invocation.

The Domain Contract explicitly identifies non-delegable human acts and why: secret/credential entry, biometric or physical presence, professional signature/Attestation, break-glass activation, legally reserved discretion, or another policy-defined reason. The platform may let an Agent prepare context or a draft, but it must not manufacture an Agent authority path for the final human-only act.

Not every UI gesture is an Operation, not every Agent exploration needs a button, and no Actor receives the full catalog merely for convenience.

### Operation kind and multidimensional Effect declaration

Every Operation declares one **Operation kind** describing its semantic shape:

```text
query / observe
calculate / simulate
propose / draft
command
coordination / delegation
```

Separately, it declares every possible **Effect dimension** for the exact Invocation, including:

- application-owned state mutation;
- disclosure, egress, or audience expansion;
- external provider action;
- Artifact handoff or Delivery;
- administrative, policy, entitlement, credential, Release, or Deployment change;
- coordination/delegation or child-Work creation;
- financial commitment or charge trigger;
- reversibility: reversible, compensable, irreversible, or unknown;
- detectability/reconciliation and effective impact profile.

One “primary effect class” is insufficient: a command may both mutate local state, disclose data, send externally, charge a payer, and create a Delivery. Approval, autonomy, retry, sandboxing, policy, observability, and assurance derive from the full Effect set and cumulative impact.

The Operation contract declares the maximum autonomy ceiling for each Effect dimension and context. Raising either a ceiling or the possible Effect set is a versioned contract change. Delegation remains a governed coordination Operation with narrowed Authority and budget, not an untyped model-to-model message.

### Reversibility and dry-run

Operations may declare:

```text
reversible
compensable
irreversible
```

Where applicable, they should support:

- dry-run or plan-preview;
- intended-Effects display;
- compensating Operation;
- optimistic concurrency or exact record/Vintage precondition;
- explicit conflict when a human and Agent change the same state;
- completion receipt.

### Effect intent, protocol, and reconciliation

A mutating, disclosing, administrative, Delivery-producing, financial, coordination, or external Operation Invocation must create durable Effect intent before uncontrolled dispatch.

An Invocation may create an **Effect Group** with stable identity, immutable membership/digest, per-member identities, ordering/dependency graph, all-or-nothing versus best-effort semantics, cumulative impact, Approval target, and compensation/reconciliation plan. Membership change creates a new group and invalidates Approval. Group status is a deterministic projection of member states under the declared mode; it preserves per-item dispatch, observation, reconciliation, and compensation and can never report success while a required member is partial, unknown, failed, or uncompensated.

Effect state is multidimensional:

```text
intent: proposed → authorized → ready | cancelled | expired
dispatch: not-dispatched → dispatching → dispatched (with attempts)
observation: performed | not-performed | declined | partial | Effect-unknown
resolution: performed | not-performed | accepted-risk | abandoned-with-notice | still-unknown
compensation: separate admitted compensating Effect(s)
```

The intent/group and dispatch attempts preserve exact Operation/contract, Job Contract Revision, target/selectors/recipients/amounts, business-input digest, state/Vintage preconditions, Actor/Party/Authentication Context, Work/Run/Attempt/Invocation, policy/obligations/Approval, idempotency scope/window, cost and cumulative impact, expiry, provider request/response receipts, partial-success detail, and reconciliation evidence.

Rules:

- retries of the same intent reuse the same provider idempotency identity only when the provider contract permits it;
- a materially changed intent or group gets new identity and new Approval;
- provider receipt is Evidence of provider response, not automatically proof that the real-world consequence occurred;
- compensation is new governed Work/Invocation/Effect and never deletion of history;
- each Effect declares reconciliation capability or explicit unreconcilability;
- `Effect-unknown` names an owner, next reconciliation time, deadline, escalation path, safe customer message, and permitted terminal dispositions; it cannot remain an ownerless permanent limbo;
- accepted-risk or abandoned-with-notice requires an authorized Decision and does not rewrite uncertainty into success;
- no universal distributed transaction or exactly-once claim is made across foreign providers.

### Platform-bound context and model-proposed business input

An Operation call contains trusted platform-bound context and business input.

**Platform-bound context** is resolved by the trusted host and cannot be supplied or overridden by the model, Source content, Package, external Message, or ordinary client payload. It includes, as applicable, Party/Instance, Actor and Agent Binding/revision, Authentication Context, Party Relationship/mandate, payer/entitlement/reservation, credential and Source Connection binding, policy/obligations, residency/service/impact rules, Approval, destination-account binding, and causality identities.

An authenticated **Instruction Envelope** distinguishes an Actor directive from narrative data. It binds the instruction to Actor, represented Party, Authentication Context, purpose, scope and intended audience, Channel/Message or first-party origin, nonce/replay state, issued/not-before/expiry time, supersession/revocation relation, and trusted-host or signature evidence. Authentication proves origin; Authority/policy still decide whether it may be followed.

Every model or materially autonomous worker step records an ordered **Context Manifest** containing the exact instruction layers, policies, Agent/Package prompt assets, Knowledge, Memory, Source/Projection items and Vintages, prior Message/Artifact excerpts, Operation/tool and response schemas, each segment's origin/selector/retrieval rank/transformation, truncation/summarization/redaction, information-flow and taint labels, actual inclusion/order/precedence, token/byte limits, and digest. A transformation of mixed trusted and untrusted inputs conservatively retains all contributing provenance unless an authorized deterministic validation/declassification step creates a narrower typed value; free-form model synthesis never clears origin.

**Business input** may be proposed by a human or Agent, but remains schema-validated, provenance-labeled, constrained by Authority/information flow, and bound to exact Approval where consequential. A model may propose a recipient; it may not choose the tenant, Authentication Context, credential, payer, unrestricted destination policy, or authoritative target version under which the recipient is used.

### Deterministic domain kernel

Where the buyer is purchasing a number, feasibility decision, or regulated calculation, the LLM must not be the calculator of record.

Calculation-heavy products need a non-LLM kernel with:

- versioned functions, rules, solvers, or simulations;
- pinned dependencies;
- explicit units and schemas;
- fixtures and golden tests;
- reproducible outputs;
- explanation of calculation provenance;
- shared use by UI, Agent, evaluator, and Outcome comparison.

Examples:

- portfolio weights, risk, concentration, and liquidity;
- nutrition, cost, and formulation constraints;
- time-series transformations and Vintage alignment;
- pricing, tax, and scheduling feasibility;
- clinic or operational rules.

The Agent may search, propose, and interpret.

The deterministic kernel computes and rejects infeasible candidates.

### Model policy and actual Model Invocation facts

Every model-using Run admits a versioned routing/fallback/cache policy, and every actual call creates a **Model Invocation** fact.

The admitted policy declares required modalities, context/tool/structured-output capabilities, minimum quality/safety envelope, eligible providers/models/regions, data-use and retention terms, cache policy, price/latency ceilings, and a versioned ordered fallback ladder with stop conditions, circuit-breaker inputs/state, decision owner, consent/notice basis, labeling, and charging treatment. Fallback cannot silently change residency, training/data use, confidentiality, Effect authority, or a promised quality floor. A materially degraded result is visibly qualified and cannot be charged or accepted as though the original service claim was met unless the contract permits it. A change outside the admitted envelope requires a new Decision or fails safely.

Each actual Model Invocation records:

- provider, account/project, region, requested model/deployment/snapshot or alias and alias mutability;
- provider-reported actual model/deployment where available;
- provider request/response IDs, start/end, stream sequence and termination, retry/fallback/cache hit/miss/bypass, normalized finish/error reason, and provider-native status;
- tokenizer/context limits, input/output token counts, sampling/decoding parameters, seed where meaningful, response/tool schema and protocol versions, and safety configuration;
- Context Manifest, prompt/template, Agent revision, tool catalog, Knowledge/Memory, and retrieval revisions/digests permitted for audit;
- provider usage/cost, latency, content-filter or refusal state, truncation, finish reason, and response digest/reference;
- policy conformance result and any drift finding.

Cache keys and entries are isolated by Party/Instance, purpose, Authority/information-flow policy, model/deployment, Context Manifest and dependency digest, tool/response-schema revisions, locale/units/limits, and all result-changing parameters. Every cache class declares TTL, freshness basis, invalidation/revocation/delete propagation, write/read eligibility, negative-cache behavior, and whether cached output is excluded, matched, or explicitly modeled in evaluation. Cache reuse across trust boundaries is prohibited unless an explicit public/shared policy proves equivalence. Cache entries inherit retention, residency, legal-hold, and deletion obligations.

Mutable aliases, provider nondeterminism, cache behavior, fallback, and stochastic sampling lower replay grade and affect evaluation design. Candidate/incumbent comparison records actual per-call routing and uses a predeclared repeated-sample/seed policy, blocking or matched randomization, variance/instability estimation, and alias-drift controls. A mutable alias change during one long-lived Run or evaluation creates a visible cohort/version boundary or blocks comparability; it is never averaged away as the same model.

## 5.6 Sources, authority, information flow, trust, and safety

### Heterogeneous Sources

The plan distinguishes data lineage from executable capability:

```text
Source Connection
→ Source Resource
→ Source Item/version or queryable state
→ purpose-scoped Projection

Capability Provider
→ governed Invocation / Operation / receipt
```

A Source Connection binds authorized access to a provider/account, local root, public endpoint, or collection; records credentials and consent when required; and carries scopes, controlling Party, Instance, region, license, health, and reauthorization semantics. A Resource is a provider collection/container such as mailbox, repository, database, bucket, CRM organization, or dataset. An Item is an addressable record/object/message/file/row set with stable external identity and deletion/tombstone semantics. A Projection is the authorized derived representation actually supplied to a user, model, View, cache, or export.

Models, deterministic kernels, remote APIs, MCP servers, and tool runtimes are Capability Providers unless they also expose separately governed data Resources. Treating a remote capability as a Source must not bypass Operation, credential, Effect, usage, or receipt rules.

Not every Source becomes a filesystem mount. Files may be projected as files; databases normally remain governed queries; mail and CRM retain domain Operations. Read, write, execute, disclose, and administer are independent permissions.

### Source-driver lifecycle, data fitness, and governed derived Projections

A Source Connection/driver declares provider and driver identity/version; consent/authentication/scopes; credential rotation and reauthorization; stable Resource/Item identity mapping; rename, move, merge, split, delete/tombstone, and read/write conflict behavior; schema/units/drift; pagination/cursor/backfill/CDC/webhook rules; quota/cost/error semantics; license/residency/model/support/learning policy; and user-visible health.

The lifecycles remain distinct:

- **Source Connection:** proposed, authorizing, active, degraded, reauthorization-required, suspended, revoked, or deleted;
- **Source Resource:** discovered, active, inaccessible, moved/renamed, merged/split, tombstoned, or removed;
- **Source Item/version:** observed, current, superseded, moved/merged, deleted/tombstoned, restored, or disputed;
- **Capability Provider binding:** configured, verified, active, degraded, quarantined, revoked, or retired.

State changes preserve external-ID mappings, controlling Party, consent/license basis, last successful Vintage/receipt, dependent Projections/Runs, and user-visible recovery or deletion behavior. A provider account and one dataset/item are never assumed to share one lifecycle merely because one connector exposes both.

- provider and driver identity/version;
- consent, authentication, scopes, credential rotation, and reauthorization;
- stable external-record identity, rename, merge, split, deletion/tombstone, and conflict mapping;
- writeback concurrency and conflict semantics when the backing provider changes between read and mutation;
- pagination, cursors, backfill, change-data capture, and webhook verification/replay protection;
- schema discovery, schema drift, units, deletion/tombstones, and conflict behavior;
- snapshot/Vintage, freshness, consistency, replication lag, completeness, and quality indicators;
- partial synchronization, poison-record handling, archive bombs, path traversal, active content, formulas/macros, truncation, quota, cost, timeout, and error semantics;
- license, residency, model-provider eligibility, Publisher-learning, and support-use policy;
- revocation, degraded mode, deletion, and reconciliation behavior;
- user-visible health such as last success, backlog, freshness objective, coverage, and reconciliation status.

Every observed state carries a **Vintage assurance descriptor**:

```text
exact immutable digest or commit
provider transaction/snapshot ID
monotonic cursor with declared coverage
bounded-staleness as-of with maximum lag
best-effort observed timestamp
explicitly unversioned
```

The descriptor records issuer, scope, coverage, consistency, capture method, time, confidence/limitations, and comparability rules. “As of” is not represented as an exact snapshot when it is not one.

Agent quality cannot exceed Source fitness. Freshness, completeness, truncation, schema compatibility, license, and reconciliation are product-quality facts.

Each derived Projection carries a dependency manifest containing exact Source Connection/Resource/Item and Vintage references, transformation chain and versions, policy-composition result, purpose/audience, model/tool use, freshness/coverage/truncation, permission-filtering stage, quality, retention, and revocation/erasure dependencies. Search/vector permission filtering occurs before candidate generation/ranking whenever intermediate membership, counts, similarity, snippets, or timing could leak data. If the chosen store cannot enforce pre-ranking filtering without leakage, the product must use a separately authorized per-boundary index/coarse candidate set, return a typed unsupported result, or disable that search path; post-filtering an overbroad candidate set is not an acceptable fallback.

A change to an input label, license, consent, mandate, deletion, or transformation defect triggers a propagation job with durable receipts for invalidate, rebuild, quarantine, reclassify, or erase. Failed propagation remains visible and blocks incompatible reuse.

Permission and information-flow filtering must occur **before** search, vector ranking, similarity scoring, aggregation, and timing-visible retrieval wherever post-filtering could reveal membership, existence, count, or latency information. A post-ranked deny filter alone is not sufficient isolation.

### Authority capabilities

Authority is a business umbrella whose enforceable facts remain separate:

- Binding/Grant ceiling;
- Party Relationship/mandate and represented Party;
- Authentication Context;
- versioned policy and exact policy decision;
- obligation instances and fulfillment Evidence;
- Human Decision/Approval or override;
- narrowed Delegation;
- short-lived credential use;
- enforcement and revalidation facts.

Effective authority is the intersection of the immutable admitted maximum with current Binding/Grant, mandate, Actor and Authentication Context, purpose/record scope, current policy and fulfilled obligations, credential scope, delegation caveats, exact Approval, target/Vintage preconditions, remaining budget, and impact ceiling. Possessing an old token, Message, ID, or Approval is never sufficient after relevant change.

An obligation has identity, type/schema, exact target, required evidence producer, deadline/freshness, enforcement point, lifecycle, failure behavior, and authorized waiver/override path. An allow-with-obligations decision remains non-executable until commit-time obligations are fulfilled.

Delegation proves transitive narrowing across capabilities, Sources, audiences, Effects, budgets, time, purpose, and further-delegation depth. Revocation, Work cancellation, membership loss, mandate termination, or parent budget exhaustion cascades according to explicit rules.

Policy-decision caches/offline leases declare maximum staleness, operations permitted, revocation feed, outage behavior, and fail-closed impact threshold. No stale policy lease creates new high-impact authority.

Break-glass and support access have explicit request, eligibility, reason, step-up Authentication Context, narrow grant, session, actions, expiry/revocation, content-access boundaries, post-review, incident linkage, and customer-notification policy. Support is dual-identity action, not invisible impersonation.

Workers and adapters receive short-lived audience-, purpose-, Run-, Operation-, Source-, Effect-, and destination-bound credentials. Credential vending attenuates durable Authority and never exposes ambient secrets to model or Package context.

### Hard limits on Agents, automations, and Packages

These limits are not configurable away. No Agent, automation, or Package may:

- grant itself access or widen a delegated permission;
- raise its own autonomy level, add an Effect dimension, or raise an Effect/impact ceiling;
- read, reveal, or forward credentials or secrets, including into Artifacts, Channels, or child Work;
- bypass an Approval policy or resolve its own Attention Item;
- silently repeat an external Effect whose Outcome is unknown;
- activate, merge, publish, deploy, or promote its own unvalidated Revision, or change the Evaluator/Outcome Definition that judges it in the same promotion;
- treat content read from a Source, document, message, web page, or subscriber record as instruction or Authority from an authorized Actor;
- move data across a Source, Instance, Publisher/Subscriber, Party, or platform boundary merely because content requested it.

The factory invariants in §3.5, promotion rules in §5.9, and customization rules in §5.11 are applications of this same block—not separate exceptions.

### Untrusted content, taint, and prompt injection

Once a Run consumes mail, web pages, documents, uploads, CRM notes, child-Agent output, tool output, or public data, third parties may influence its context.

The platform must support:

- authenticated Instruction Envelopes distinct from narrative Source/Message content;
- origin labels on Source Items, Messages, extracted values, Context Manifest segments, Operation arguments, Artifact components, and child-Work inputs;
- a conservative **Run-level taint summary** that, once set, remains for the entire Run and all later Attempts; restarting a worker never clears it;
- value-level provenance and validation status for decision-critical sink fields, without pretending that free-form model transformations propagate labels perfectly;
- taint propagation to Artifacts, child Work/Runs, Evidence claims, and proposed Effects;
- default human Approval for tainted external, irreversible, administrative, disclosure, financial, or high-impact Effects unless an explicit narrow per-Operation exception has deterministic validation and sink constraints;
- deterministic extraction, authorized review, or versioned declassification for specific values while preserving Run-level taint history;
- minimum necessary, escaped, access-controlled display of relevant untrusted evidence in Approval;
- context separation, reduced privileges, sandboxing, content disarm/reconstruction, archive/macro/formula controls, DLP/output validation, and destination allowlists where appropriate.

Narrative content never grants Authority. An authenticated sender may issue an Instruction Envelope, but policy still decides whether that Actor may direct the requested action. A model or Agent self-report is a claim; platform instrumentation, deterministic kernels, provider receipts, or authorized Human Attestation establish consequential facts.

### Multidimensional information-flow policy and egress control

Causal provenance answers where information came from. Information-flow policy answers where it may go, for which purpose, under which conditions, and for how long. Both are required.

Policy dimensions include controlling Party/Instance, sensitivity and regulated class, audience/Actors/purpose, license/redistribution, residency, retention/hold/deletion/export, eligible models/tools/runtimes, support/evaluation/Package-improvement/platform-learning use, and onward-transfer constraints.

Each dimension declares its composition operator: intersection; union only under explicit authority; threshold; override with recorded obligation; or incompatible/fail closed. “Most restrictive” is not an adequate algorithm for multidimensional policy, and provenance alone is never permission.

Every actual boundary crossing creates a durable Transfer record with exact subject/version or selective proof, sender/receiver boundary, purpose, policy decision/obligations, Actor/Authentication Context, destination, time, receipt/failure, downstream obligations, and withdrawal limitations. Cross-Instance shared search, support export, Publisher Evidence export, Package build input, telemetry export, Artifact Delivery, and portable export all use the same explicit transfer principle.

Revocation, consent withdrawal, mandate termination, label/license change, erasure, or defective transformation creates a propagation plan over controlled Projections, caches, embeddings, prompt stores, sandboxes, support copies, evaluation sets, Artifacts where policy permits, and transfer records. The plan records target inventory, dependency watermark, owner, start/deadline, progress, retries, exceptions, completed/failed/unavailable/outside-control state, and completion/qualification receipt. Failed or unreachable targets remain visible and block incompatible reuse. The system never claims to recall data from an external recipient it cannot control.

Declassification, redaction, anonymization, aggregation, or other policy-reducing transformation requires an authorized Decision, versioned validator and qualification, input/transformation lineage, versioned threshold basis, representative tests and sampling/audit plan, residual-risk owner, new output policy, expiry/review, and quarantine/rollback path. A later defective-validator finding identifies and requalifies or withdraws affected outputs and Transfers.

### Execution profiles, credential brokering, rendering safety, and governed egress

Every sandbox, browser-automation runtime, Package-code runtime, connector/Source adapter, worker class, and privileged deterministic-kernel host should use a versioned Execution Profile appropriate to its trust zone. The profile may be implemented by different providers or topology, but it must declare and enforce:

- no ambient production credentials; short-lived credentials are vended for exact admitted purpose and scope;
- allowed Source reads and deny-by-default or explicitly bounded network egress by connector/destination, protocol, region, and data class;
- all external writes pass through the governed Operation/Effect protocol and trusted receipt path, whether implemented by a central gateway or a local in-process adapter;
- filesystem, package/import, syscall/runtime, child-process, CPU, memory, storage, wall-time, concurrency, and output-size limits;
- immutable or attestable runtime/environment identity, vulnerability/quarantine status, checkpoint compatibility, and secure cleanup;
- isolation among Parties/Instances and among untrusted Package code, browser content, renderers, deterministic kernels, and privileged host services;
- sandboxed Artifact preview/rendering, content-security controls, active-content stripping or isolation, archive/path-traversal/decompression-bomb defenses, formula/macro handling, and malware checks appropriate to the media type;
- telemetry, data-loss-prevention, and receipt requirements that exclude secrets and Work content by default.

The Run records the admitted profile requirement; each Attempt or privileged Invocation records the actual profile/runtime attestation used. Profile drift is behaviorally relevant to replay, evaluation, incident response, and Release verification.

### Package and extension trust

Distributed Packages may contain instructions, Knowledge, Experience definitions, semantic definitions, deterministic kernels, migrations, or executable code.

Required capabilities:

- Publisher Party identity and signing;
- immutable content and Release digests;
- capability passport before installation;
- declared Sources, Operations, authority, models, dependencies, and estimated cost;
- declarative content validation;
- sandboxed treatment of untrusted executable content;
- explicit promotion to operator-trusted code;
- no self-widening by Package or Agent;
- auditable migration authority;
- rate limiting and abuse controls for public products;
- quarantine and revocation of compromised Releases.

### Compliance, retention, liability, and portable exit

Selected domains may require:

- compliance documentation and controls for regimes such as the EU AI Act and sector-specific financial, medical, food, employment, or public-sector regulation;
- mandated human oversight that configuration cannot disable;
- distinction between Advice, Action, and Attestation plus independent impact/assurance tier;
- retention clocks by data class;
- explicit legal, regulatory, and incident holds;
- data-subject erasure across Instances, Work, Artifacts, Memory, and Evidence, with redact-versus-tombstone behavior defined per Artifact/data class, plus purpose revocation;
- deletion propagation to derived Projections, caches, indexes, sandboxes, support copies, and backups under declared recovery windows;
- non-identifying tombstones and erasure receipts where legally and operationally appropriate;
- correction, withdrawal, or purpose revocation for Evidence and Outcomes;
- revalidation or qualification of evaluations whose Evidence set changes materially;
- separation of identifying content from structural audit/provenance;
- documented model, Operation, and oversight capabilities;
- incident response for model hallucination or unsafe action;
- non-delegation of regulated professional acts;
- jurisdiction-aware disclaimers;
- SSO/OIDC and directory integration;
- export of audit and compliance records;
- explicit allocation of liability among Instance owner, Publisher, platform operator, provider, and payer.

Portable exit should provide a signed manifest of documented formats covering Work graph, Artifact versions, Source/Projection references, provenance, policy metadata, Package/Release lineage, and local overlays—excluding secrets and provider credentials.

## 5.7 Domain semantics and analytical semantic capabilities

Two different semantic needs must not be collapsed.

### 5.7.1 Domain Contract — universal for meaningful Agent parity

The Domain Contract describes the application’s nouns, identifiers, typed actions, events, compatibility, and context.

This is essential even for products that never use analytical measures.

Examples:

```text
Mail Thread
Account
Opportunity
Document
Campaign
Formulation
Draft reply
Move stage
Publish content
```

### 5.7.2 Analytical semantic engine — optional for calculation-rich products

Some products need measures, dimensions, units, time, Vintages, and lineage:

```text
revenue
gross margin
engagement
inflation
portfolio weight
forecast error
supplier cost
conversion
```

Required capabilities may include:

- semantic model discovery;
- entities, measures, dimensions, and relationships;
- query validation;
- query explanation;
- units and time transformations;
- model versioning;
- Source and Vintage lineage;
- binding to Views;
- binding to Evaluators, Objective Bases, and Outcome Definitions;
- governed SQL or lower-level escape hatch.

### Current analytical semantic implementation

The universal business capability is the **analytical semantic engine** behind stable Operations such as:

```text
semantic.describe
semantic.query
semantic.explain
```

The current project and implementation are referred to in this plan by the repository label `BSL` / `boring_semantic_layer`. Part 2 should not infer that every application must use this engine, nor invent a second semantic-query contract merely to avoid Python.

The analytical semantic engine should not become the universal application model.

Mail is not a cube. A document editor is not a cube.

The stable business contract is semantic discovery, query, explanation, units, Vintages, and provenance—not a specific implementation language or worker topology.

### Semantic provenance

Every semantic result used as Evidence should retain:

- semantic model identity and digest;
- query or expression;
- generated plan or SQL where available;
- underlying Source identities;
- Source and result Vintage/snapshot references;
- explicit `unversioned` status where a Source cannot supply a stable Vintage;
- row/column or equivalent lineage where available;
- result digest;
- limits and truncation;
- executing Run, Attempt, and authority digest;
- linkage to Work, Artifact, Evaluator, Objective Basis, and Outcome Definition.

Fair replay and comparison require the incumbent and candidate to use declared, comparable Vintages or to disclose why they do not.

## 5.8 Artifacts, Evidence, Outcomes, and the causal join

### Artifact capabilities

Artifacts may include reports, drafts, messages promoted to deliverables, spreadsheets, charts, datasets, formulations, forecasts, presentations, Experience/View definitions, Agent or Package candidates, and code patches.

The platform distinguishes a **logical Artifact identity** from immutable content versions. Every Artifact type has a versioned contract defining:

- media/content schema, required components, valid partial states, validation, and compatibility;
- controlling Party/owner, allowed creators, information-flow/license/retention/export policy;
- lifecycle such as draft, proposed, validated, released, superseded, withdrawn, archived, or quarantined;
- whether branching, merge, collaborative editing, external authoritative storage, or signatures are permitted;
- completion and deliverable-contract rules; a generic blob is not automatically a valid deliverable.

Each immutable Artifact version carries a **component manifest**. Components may be inline content, governed external references, embedded data, charts, attachments, code, citations, signatures, or renditions. For every component the manifest records stable component ID and path/name, order/dependency relation, digest/integrity semantics, media/schema, provenance, Source/Projection/Vintage and transformation lineage, information-flow policy, completeness/truncation, validation, active-content/executable policy, and relationship to other components. The Artifact contract declares how component commitments compose into the aggregate version commitment and how absent, optional, replaced, or externally unavailable components affect validity.

The platform distinguishes:

```text
logical Artifact
immutable content version
rendering/rendition
exported copy
foreign authoritative reference
Delivery-specific wrapper or redaction
```

A change in content creates a new Artifact version. A re-render using the same content records rendition identity and renderer/version. An exported or externally stored copy records its own integrity, destination, and control boundary rather than being mistaken for the authoritative internal version.

Citation is a typed relation, not a decorative URL. It declares cited claim/component, target Source Resource/Item or Artifact version, exact selector/locator, excerpt/result digest, retrieval/observation time, Vintage assurance, extraction/transformation and its version, quote versus paraphrase, access policy and verifier audience, integrity/freshness, resolution status, supersession/withdrawal relation, and whether the citation actually supports the claim. Citation validators may check existence, permission, locator stability, excerpt integrity, entailment/consistency, stale-source status, and graceful failure according to the Artifact contract.

Artifact lineage supports derivation, redaction, correction, reformatting, branch, merge, comparison, supersession, and withdrawal without overwriting prior versions. Merge records component ancestry and conflicts. Approval, acceptance, business Attestation, release, promotion, and override are append-only typed Decisions targeting exact versions.

An external proof is audience- and purpose-bound. It uses a versioned claim/proof schema and selectively discloses only required claims—such as Artifact commitment, issuer or producing Release/Agent where permitted, validation/Attestation, Delivery time, and receipt references. The proof preserves issuer/trust chain, key discovery, key and algorithm identifiers, signature or commitment, audience/nonce, issued/not-before/expiry time, trusted timestamp where required, revocation/status-check method and freshness, and verifier failure behavior for unknown key, stale metadata, unavailable status service, or unsupported schema. It must not leak undisclosed Instance, tenant, Source, internal Run, infrastructure, or globally correlatable predictable-content metadata. Raw public hashes of sensitive/predictable content are avoided in favor of keyed commitments, signatures, or selective disclosure where needed.

Not every Message is an Artifact, not every Artifact is a candidate, and provider acceptance of bytes is not Delivery or acceptance.

### Delivery intent, dispatch, handoff, acknowledgement, and withdrawal limits

Delivery is evaluated per destination, recipient/consumer, purpose, and exact Artifact/result version. It keeps these facts separate:

1. **Delivery intent** — what exact version, audience, format/redaction, destination, access policy, expiry, and Job Contract Revision should be handed off.
2. **Dispatch Effect** — send/upload/publish/callback action and provider attempts.
3. **Effect observation** — what the provider or reconciliation established.
4. **Handoff/access fact** — access grant, secure-link creation, resource availability, or physical/foreign handoff.
5. **Recipient acknowledgement** — opened, downloaded, acknowledged, callback accepted, or equivalent signal, when available and lawful.
6. **Business acceptance** — a separate Human Decision under the exact accepted Job Contract Revision.
7. **Expiry/revocation/withdrawal attempt** — removal of controlled access or a request to a foreign recipient; never a false claim that external copies were recalled.

One Delivery intent may have several provider attempts; one Artifact version may have several independent Delivery intents. Every destination/recipient has independent authorization and information-flow decision, destination identity/provenance, idempotency identity, retry window, dispatch/observation/access/acknowledgement status, disclosure/redaction policy, expiry, and receipt. The exact accepted Job Contract Revision states whether all destinations, a quorum/subset, or best-effort partial success satisfies handoff. Mixed success remains representable and never collapses into one misleading delivered flag.

A platform Delivery receipt is derived from authoritative facts and links—rather than collapses—Delivery intent, provider request/receipt, Effect observation/reconciliation, handoff/access, acknowledgement, notification, and acceptance. Bounce, provider “delivered/read” semantics, expired link, destination change, re-delivery, supersession, and partial-recipient success remain typed and provider-qualified.

Changing destination, recipient, Artifact version, redaction, format, purpose, or access policy creates a new Delivery intent and may invalidate Approval. Access revocation, link expiry, supersession, and withdrawal notice are distinct. Revocation can stop future access under platform control; a withdrawal request to a foreign recipient may fail, and no record may claim that a valid external copy was recalled or erased without authoritative evidence.

### Two-level evidence join, with Attempts beneath the Run

The plan needs two durable joins and one subordinate execution level. Part 2 must not collapse them.

#### Work-level join — the customer-value unit

Work joins across all Runs and retries:

- immutable Job Contract Revision history and customer intent;
- all produced Artifacts;
- Attention, Decisions, edits, and acceptance;
- Deliveries;
- delayed Outcomes and ROI;
- evaluations and promotion decisions;
- rolled-up cost, human attention, and service performance.

#### Run/Execution-level join — one admitted logical execution

Each admitted Run joins:

- request, Message/event/import causality, Context Manifest, accepted Job Contract Revision where applicable, and Admission decision;
- Party, Actor, Agent binding, and immutable Agent revision;
- Authentication Context, Party Relationship/mandate, authority, policy decision/obligations, Approval, and Payer Binding;
- platform-bound argument digest;
- Source, Projection, Vintage, deterministic-kernel, semantic-model, Package, Release, and Deployment versions;
- Attempts, Operation Invocations, Effects, gates, receipts, reconciliation, and platform facts;
- cost, latency, failures, produced Artifacts, and integrity findings.

#### Attempt-level record — one concrete worker execution

Each Attempt records:

- worker software/runtime generation, Execution Profile/runtime attestation, and Lease/fence history;
- start/end/checkpoint state and checkpoint compatibility/digest;
- concrete Model Invocations plus tool/kernel calls;
- retry, process-loss resume, cancellation, or replacement causality;
- Attempt-local failures and resource usage.

#### Model Invocation facts — the actual model call

Each actual model call beneath an Attempt records, where available and policy permits:

- resolved provider, deployment/model ID or alias, region, and endpoint class;
- effective parameters, system/prompt/template and tool-contract revisions;
- cache hit/miss, speculative or parallel call, fallback/routing chain, and why it was selected;
- safety, residency, retention, and provider data-use policy in force;
- input/output usage, cost, latency, truncation, errors, and refusal/safety outcomes;
- observed provider/model drift or version ambiguity.

One Attempt may contain several Model Invocations. A provider fallback does not by itself create another Attempt. Candidate-versus-incumbent evaluation must disclose materially different model, runtime, cache, fallback, or routing conditions rather than attributing their effect to the candidate Revision.

Every Artifact, Attention Item, Delivery, and Evidence item references its Work and, where it was produced by execution, its Run. Attempt identity is retained when necessary for forensic or cost attribution. Costs roll up from Attempts to Run to Work.

Outcomes attach to Work or a particular Artifact under an Outcome Definition and retain attribution links back to the producing Run, Agent revision, and relevant Vintages.

Evidence that cannot be joined back to the Work and producing revision is decoration.

### Facts plane versus content plane

The platform should permit metering, reliability, audit, reconciliation, and ordinary support to operate on content-minimized operational facts.

The **facts plane** may contain:

- opaque Party, Instance, Work, Run, Attempt, Actor, Package, Release, payer, and policy references;
- status, timestamps, Operation kind, Effect dimensions, retry/unknown state, budgets, and service class;
- usage, cost, latency, provider, Model Invocation, cache/fallback, model, and sandbox/runtime facts;
- content digests, Source/model/Vintage versions, redaction state, receipts, gate results, and integrity findings.

Operational Fact and Usage Fact schemas are versioned integration contracts. Corrections, late provider adjustments, retractions, and supersession append new facts rather than silently rewriting prior metering or audit evidence, and consumers declare compatible schema ranges.

The **content plane** contains prompts, message bodies, Source payloads, documents, code, datasets, and Artifact bodies.

Capabilities that need only facts must not receive content by default. Support access to content requires explicit purpose, bounded authorization, redaction, and audit. Where erasure or retention policy removes content, the platform may retain non-identifying structural facts and tombstones only to the extent policy and law permit.

Durable business audit is authoritative. Traces, metrics, logs, and profiles are operational signals that may be sampled, redacted, or retained differently; they never replace the Work/Run/Effect graph or platform receipts.

Operational Fact and Usage Fact contracts require explicit schema versions, stable identifiers, correction/supersession semantics, and compatibility policy. A telemetry schema change must not silently reinterpret historical billing, reliability, or support facts.

### Evidence and Outcome measurement semantics

Evidence is not one undifferentiated signal. Each Evidence item has a typed kind:

```text
claim
measurement
provider/platform receipt
Human Decision
observed event
expert assessment
evaluation result
integrity finding
```

It records producer and represented Party, collection method/instrument, target and causal link, Source/Artifact/Vintage, units/schema, timestamp/window, assurance and signature/receipt status, uncertainty, sampling/coverage, information-flow purpose, correction/withdrawal, deduplication key, adjudication status, and permitted uses. A self-authored Agent claim cannot silently substitute for a platform measurement or provider receipt.

An Outcome is an observation under an Outcome Definition, not merely acceptance. It may attach to several causal contributors: Work, Artifact versions, Effects/Effect Groups, human interventions, domain-state changes, Releases/Deployments, exposures, and external conditions. The attribution record identifies candidate contributors, method/design, weights or qualitative responsibility, counterfactual/comparator, confounders, confidence, and limitations; it does not force one producing Run when reality is multi-causal.

Every observation has stable identity, producer/source identity, entity-resolution key, and provisional/final/withdrawn status under the Outcome Definition. Repeated provider events or Source observations require deduplication and identity matching. Conflicting observations remain visible and enter adjudication rather than last-write-wins. Adjudication records owner/authority, method, decision, Evidence considered, dissent, finality or re-open conditions, and appeal/correction path.

Correction, withdrawal, Source remapping, deduplication change, or Outcome Definition revision can trigger deterministic recomputation or qualification of downstream evaluations, Objective Bases, promotions, billing claims, and Quality Claims. The recomputation record preserves old and new results and the reason. Missing Evidence remains missing; absence is never converted to success.

### Preference versus Outcome

The platform must distinguish:

```text
human accepted it
human edited it
human rejected it
```

from:

```text
it received a reply
it improved conversion
it reduced formulation cost
it predicted the data accurately
it produced a production incident
```

Both matter. They are not interchangeable.

### Versioned Outcome Definitions

The meaning of an Outcome is itself versioned. An Outcome Definition identifies:

- target Work/Artifact/Effect/domain-state/exposure types and signal;
- Source Connection/Resource/Item, measurement method/instrument, semantic measure, units, and Vintage assurance;
- observation window, population/cohort, eligibility, censoring, and missing-data behavior;
- deduplication/entity-resolution and conflicting-observation rules;
- attribution/comparison design, candidate causal contributors, confounders, and confidence threshold;
- correction, dispute, adjudication, withdrawal, and recomputation rules;
- permitted use in evaluation, promotion, billing, Publisher analytics, or shared learning.

Changing it is a Revision. Results under materially different definitions are non-comparable unless a declared versioned reconciliation maps them with disclosed uncertainty.

### Delayed, noisy, corrected, and missing Outcomes

Required capabilities include delayed observation, exact Outcome Definition and window, Source/Vintage assurance, contributor and confounder lineage, attribution confidence, controlled/holdout/observational designs, partial/corrected/contested/adjudicated/withdrawn states, deduplication, and recomputation.

An Outcome record never overwrites prior observations. Corrections and adjudications append lineage. Evidence withdrawal or Source deletion identifies every affected evaluation, incumbent, Promotion Plan, Quality Claim, or billing decision and routes it to revalidation, qualification, forward fix, rollback, dispute, or no-action with recorded rationale.

“Not observed” and “not attributable” are honest states. Missing or low-confidence Outcomes cannot be treated as success merely because a commercial or improvement process prefers a number.

## 5.9 Evaluation, incumbent comparison, and controlled promotion

The architecture-preserving capability is an **evaluation substrate**.

Automatic self-improvement is one possible use of it.

An explicit improvement process also needs a durable **Objective Basis** that may span many Work items. It defines the target, scoped incumbent, population, metrics, guardrails, observation window, Outcome Definition, comparison design, budget basis, evaluator, rollout scope, and promotion authority. It is versioned and referenced by candidate/evaluation Work rather than hidden in one prompt. Ordinary applications do not need an Objective Basis until they begin explicit comparison or improvement.

The sellable concept is often simpler:

- compare two drafts;
- compare two formulations;
- compare two forecasts;
- compare two Agent revisions;
- keep the loser;
- know why the winner won;
- revert when later Outcomes disagree.

A product supports controlled improvement when it can:

1. identify the exact target and scoped incumbent;
2. record the complete candidate dependency delta: Agent, Package Version, Release, model policy and actual Model Invocation distributions, Execution Profile/runtime, cache/fallback policy, Operation contracts, kernels, Semantic Models, Evaluators, configuration, policy, and other changed inputs;
3. define “better,” Outcome Definition, criteria, guardrails, and ethical/consent constraints;
4. define the comparison design, population, Source Vintages, assignment, and budget basis;
5. gather sufficient, comparable Evidence;
6. propose an immutable Revision;
7. validate it;
8. evaluate it using a versioned Evaluator;
9. retain rejected candidates, evaluations, gaming findings, and rejection reasons in a queryable improvement archive;
10. keep candidate generation, evaluation, fixture custody, promotion, and production execution under distinct authorities;
11. require authorized promotion;
12. create a durable exposure/assignment record and activate through version selection for a declared scope;
13. monitor, halt, roll back, restore, or apply a migration-aware forward fix.

### Evaluation validity

A comparison must predeclare or explicitly label exploratory status for:

- target, scoped incumbent, candidate dependency delta, and eligibility population;
- assignment unit, eligibility/exclusion rules, randomization or matching method, allocation concealment where applicable, stratification, exposure identity, sample-ratio-mismatch checks, noncompliance, crossover/contamination, cohort interference/spillover, and exclusions;
- comparable Domain Contract, Semantic Model, Source/Vintage, policy, data-use, runtime/Execution Profile, model-routing, cache/fallback, cost, latency, compute, and human-attention conditions—or disclosed normalization;
- Outcome Definition, metrics, guardrails, slices, minimum Evidence/sample, uncertainty method, and attribution-confidence threshold;
- sequential looks, optional stopping, repeated peeking, multiple candidates/metrics/slices, the selected sequential/multiplicity or false-discovery method and version, analysis owner/authority, thresholds, stopping/decision rule, and platform-recorded analysis receipt;
- held-out fixture exposure budget and rotation;
- missing data, failures, dropouts, provider changes, alias drift, and protocol deviations;
- cost, attention, safety, fairness, and operational regressions, not quality alone.

Actual Model Invocation distributions, cache hits, fallback rates, runtime versions, Source health, truncation, and policy differences are comparison covariates—not vaguely attributed to “the Agent revision.” Stochastic systems use repeated samples/seeds, blocking or matched randomization, and variance/instability reporting appropriate to the decision.

Human expert panels are versioned Evaluator protocols. They declare panel composition and eligibility, conflicts/recusal, blinding, training/calibration, rubric and examples, independence, quorum, adjudication, inter-rater agreement, compensation, fatigue/order effects, privacy, dissent, and panel drift monitoring. A persuasive model-generated explanation is not permitted to reveal candidate identity when the protocol claims blinding.

An Evaluator and Outcome Definition cannot be silently changed in the same promotion as the object they judge. Exploratory wins are not promoted as confirmatory Evidence without an independent or prospective confirmation rule. Implausibly large gains, selective reporting, weak promotion rates, and variance spikes trigger audit.

### What this capability must prevent

- silent live self-rewriting of an active Agent, Experience, Evaluator, Semantic Model, policy, or Package;
- an Actor widening its own Authority, autonomy policy, Effect dimensions, or Effect/impact ceiling through a Revision it proposes;
- changing the Evaluator or Outcome Definition that judges a Revision in the same promotion, or without explicit disclosure and independent authority;
- promotion on insufficient, non-comparable, leaked, or low-confidence Evidence;
- optimizing an Evaluator proxy at the expense of the real Outcome or guardrails;
- human-authored changes bypassing validation, comparison, promotion, monitoring, and rollback;
- uncontrolled mutation of production code, declarative definitions, gates, or evaluation instrumentation.

### Evaluation integrity against optimizing Actors

A repeatedly measured Actor or Revision is assumed to search for weaknesses in the measurement system, intentionally or not.

Required capabilities include protected held-out Evidence that the judged Actor cannot read, select, modify, schedule, infer through feedback, or influence; distinct authorities for candidate generation, assignment, fixture custody, Evaluator execution, analysis, promotion, and production; platform-originated gate/test/Effect/cost/assignment facts; and durable findings for leakage, weakened assertions, disabled instrumentation, fabricated logs, selective exclusions, or metric-satisfying-but-intent-violating changes.

The system records fixture exposure, feedback granularity, analysis iterations, researcher/Agent access, outlier audits, repeated-measure degradation, rotation/refresh, and prospective validation. Rejected candidates, failed evaluations, dissent, gaming findings, and reasons remain queryable without exposing protected fixtures to the optimizing Actor.

Evaluator performance itself is monitored for calibration, agreement, drift, variance, slice behavior, decision impact, and suspiciously permissive promotion. A load-bearing gate must fail negative controls or mutations and change a protected decision when its invariant is violated.

### Promotion scope, exposure, staged rollout, and forward fix

An incumbent is scoped by Package default, Release channel, Instance, environment, cohort/region/percentage, Actor group, Operation, experiment, or Objective Basis.

Promotion is governed by an immutable **Promotion Plan** with lifecycle:

```text
draft → proposed → approved → scheduled → active
active → paused | halted | expanded | completed
any nonterminal → cancelled | expired
completed/active → rolled-back | forward-fixed | qualified
```

A new plan revision is required for material candidate, scope, assignment, metric, threshold, authority, consent, charging, or rollback change. The Plan records:

- target, incumbent, candidate, dependency/capability/data-use delta, and compatibility;
- evaluation Evidence, criteria, guardrails, population, Vintages, assignment design, and uncertainty;
- candidate/evaluation/promotion/production authorities and required Authentication Context/Approvals;
- entry criteria, maximum exposure, budget/attention/charge policy, observation window, and impact ceiling;
- monitoring owner, data source, freshness, thresholds, alert destination, decision deadline, and exact stop/halt rules;
- missing, delayed, contradictory, or compromised telemetry behavior—high-impact rollout does not continue merely because monitoring is blind;
- notice, consent, subscriber/data-subject opt-out or appeal, cross-Party ethical/professional oversight authority, cohort interference limits, and whether shadow/canary use may consume customer data or incur charges;
- state/schema and mixed-version compatibility, rollback target, data written under the candidate, irreversible external Effects, reverse-migration feasibility, restore point, customer communication, charge/refund/credit treatment, forward-fix plan, and last-known-good;
- completion, qualification, post-promotion Outcome monitoring, and Evidence-withdrawal response.

A valid Promotion Plan may use offline validation, historical replay, no-effect shadow, dogfood, named canary, bounded cohort/region/percentage, and wider activation. Shadow creates no customer-visible Effect, write, duplicate Delivery, or charge unless a separately disclosed and admitted experiment explicitly authorizes it.

Rollback is never promised abstractly. The plan proves whether old code can read new state, whether writes must be fenced, whether compensation or reverse migration is required, and when forward fix or restore is safer than binary rollback. A late Outcome may qualify or reverse a winner without deleting the original Decision.

### Load-bearing gates

A review or promotion gate must demonstrate that it can change a decision.

Useful verification capabilities include:

- negative controls and deliberately failing fixtures;
- mutation tests that remove or violate the protected constraint;
- periodic checks that bypassing or deleting the gate causes a refusal, escalation, or different promotion result;
- recorded gate version, inputs, outputs, and decision impact;
- an integrity incident when a claimed safety gate has no observable effect on protected decisions.

A gate whose removal changes nothing relevant is decorative, not protective.

## 5.10 Automation, events, schedules, contract compatibility, and Channels

Meaningful Work may begin without a user typing. An Automation is a stable governed software Actor plus a versioned trigger/rule definition; it never inherits ambient authority from a scheduler or event bus.

Automation requirements include owning and represented Party, Party Relationship/mandate where applicable, purpose, exact rule revision, authority and Effect dimensions, budget/reservation/rate/concurrency/fan-out, Attention destination, dry-run/pause/revoke/kill switch, causality/loop detection, and cancellation propagation.

A schedule is a versioned recurrence rule with time zone and calendar version, explicit daylight-saving ambiguity/nonexistent-time policy, stable **occurrence identity**, missed-run/catch-up/backfill/coalescing policy, provider/control-plane outage behavior, maximum lateness, and deduplication. A time-zone, calendar, or rule change has an effective boundary and operator-visible preview of skipped, duplicated, or catch-up occurrences. Recomputing the calendar never silently creates a second occurrence for the same intended business time.

An event-trigger rule declares producer/schema versions, subscription/filter, subject scope, starting watermark, late/reordered/replayed event policy, authorization recheck at trigger and Admission, replay/backfill budget, loop/cycle breaker, and behavior after rule or permission change. Replaying an old event does not replay old Authority; new Work is admitted under current policy and exact replay purpose.

Automation chains must detect causal cycles, amplification, financial/Attention runaway, repeated Effect-unknown, and mutual waiting. Circuit breakers and kill switches are scoped and auditable.

### Contract versioning and compatibility

Every Operation, event, View/action binding, Source/Capability Provider contract, external API, Message/callback envelope, and Package contribution has an explicit schema/semantic version and compatibility policy.

The contract declares input/output/partial/error schemas, Operation kind and Effect dimensions, reversibility/reconciliation, platform-bound context, Authentication Context requirements, concurrency/Vintage, limits, cost/freshness/quality, idempotency, pagination/streaming, unknown-field behavior, deprecation, and removal.

Compatibility is semantic, not merely schema-valid. Package installation, Release build, composition, client generation, and Deployment promotion negotiate required/supported `CAP` and contract versions. Unsupported required behavior fails explicitly; no ambient load order, “best effort” field dropping, or silent downgrade changes meaning.

### Domain events as integration notifications

A domain event is a versioned integration notification about a durable fact. It is neither the authoritative audit record nor Authority.

Its envelope includes event ID/schema version, producer/contract, Party/Instance/public scope, subject and subject version/sequence, Work/Run/Effect/Artifact correlation, causation, acting Actor/system principal, occurred/recorded/published/not-after times, information-flow audience, payload digest/reference, signature/integrity metadata where required, and correction/supersession/retraction links.

Publication authorization is checked independently from the underlying business action; payload minimization, audience, expiry, compatibility range, and replay policy apply at publication. Consumers authenticate producer/transport where required, negotiate or validate compatible schema/semantic versions, tolerate duplicates/reordering/delay/replay, keep inbox/checkpoint state, process corrections/retractions, and quarantine unsupported or unsafe messages. Replay/loop amplification has explicit event and budget ceilings.

Replay and backfill identify the replay operator/Automation, purpose, original event, new Admission authority, range, rate/budget, and side-effect policy. An old event cannot carry forward old credentials or Approval. Corrections and retractions produce new events; publication loss never rewrites the source fact.

### Durable fact publication, messaging atomicity, and read consistency

When one business action changes durable state, audit, and an outbound integration notification, the platform needs local atomic commit **or a tested equivalent**. Part 1 does not require one database transaction or one broker topology.

Capabilities may include:

- atomic local state/audit/outbox commit where co-location permits it;
- an equivalent recoverable protocol when stores or regions differ;
- inbox deduplication and idempotent consumers;
- poison-event quarantine and bounded retry;
- outbox backlog visibility, repair, and replay;
- correction, supersession, and retraction rather than mutation of published history;
- declared read-after-write, monotonic-read, or eventual-consistency behavior for each product surface and integration;
- no assumption that successful publication makes an event the business source of truth.

A missing, duplicated, delayed, or reordered notification must be recoverable without fabricating a second domain action.

### Channel-first intake and Delivery

Channels include first-party chat/composer, messaging, email/SMS, voice, embedded widgets, MCP/Agent protocols, HTTP API, webhook, and callback. Channel transport does not define Actor, Authentication Context, Thread, Work, or Delivery identity.

Adapters must support:

- Channel Binding lifecycle: link, verify, active, suspended, reassigned/recovered, unlinked, revoked, and compromised;
- External Conversation and Message identities, versions, edits/deletes/reactions/replies, attachments, sender Authentication Context, provider ordering, duplicate, and retention semantics;
- provider/webhook signatures, callback authentication, key rotation, anti-replay, forwarded-link and confused-deputy protection;
- mapping one conversation to several Work items, several conversations to one Thread, and audited reassignment after account/number/address recovery;
- secure import against malware, archive bombs/path traversal, formulas/macros/active content, oversized media, hidden content, and unsupported formats;
- immutable record of which Message version influenced Intake/Admission; later edit/delete cannot rewrite the Run but may invalidate pending Approval, create correction Work, qualify Artifact/Evidence, or alter transcript visibility under policy;
- channel-specific information-flow, destination, Approval, and Effect policy;
- voice-specific speaker/consent/recording/transcription confidence, disclosure and retention, interruption, correction, high-impact read-back/confirmation, and fallback to a stronger Channel;
- API/MCP-specific client identity, audience, scopes, nonce/signature, schema negotiation, asynchronous job ID/status/polling, cancellation, partial/provisional results, callback correlation and authorization, pagination/streaming, callback destination, and rate/abuse controls;
- destination safety: verified account/domain ownership or allow/deny list, alias/contact resolution, lookalike/homograph/Unicode normalization, reply-to versus body address distinction, recently changed destination step-up, audience-bound one-time links, forwarding/redirect detection where available, bulk/cumulative limits, destination provenance, and provider-qualified delivered/read semantics;
- cross-Channel continuation without changing Work/Run/Artifact/Approval/Delivery identity.

Unavoidable pre-Admission Channel cost is attributed to the Channel/platform principal and later allocated to Work only by an explicit rule. Approvals use transaction Authentication Context, not merely the assurance label of the Channel Binding.

## 5.11 Agent-built and Agent-customizable applications

A user may ask:

```text
“Add a supplier-risk page.”
“Show sponsor revenue beside each campaign.”
“Create a forecast comparison dashboard.”
“Add an approval step.”
“Make LinkedIn the primary channel.”
```

The Agent needs three reflective catalogs.

### Operation Catalog — what can happen

- domain actions and queries;
- schemas;
- effects and reversibility;
- approval and autonomy policy;
- constraints;
- result shapes.

### Semantic Catalog — what structured data means

- entities;
- measures;
- dimensions;
- relationships;
- units;
- filters;
- vintages and lineage.

### Experience Catalog — how humans can see and control it

The Experience Catalog is versioned and permission-aware. It declares:

- catalog/schema version; View/Page/layout component identities and compatibility ranges; deprecation and migration rules for stored Experiences/overlays;
- data-binding contracts, permitted Source/Projection classes, field-level policy, empty/error/stale/loading states, and query limits;
- action-binding contracts to exact Operation versions, Authentication Context/Approval requirements, Effect dimensions, and optimistic-concurrency behavior;
- composition, navigation, deep-link, responsive, localization, bidirectional-text, time/number/unit, and accessibility rules;
- trusted versus declarative rendering lanes, active-content policy, and extension trust;
- preview fixtures that are synthetic, generated, or explicitly redacted and never silently copy production customer content;
- validation evidence for accessibility, localization, information flow, security, performance, and compatibility.

Catalog discovery is filtered by the proposing Actor’s authority and intended target, but final activation revalidates against the Instance owner’s policy and exact proposed diff.

### Three mutation lanes

1. **Instance parameters and overlays**  
   Filters, defaults, local branding, arrangement, and scoped preferences.

2. **Catalog-constrained declarative changes**  
   Pages, Views, navigation, calculations, semantic bindings, action bindings, and workflow configuration represented as validated data.

3. **Trusted code Package revisions**  
   Built in isolation, checked, tested, reviewed or policy-approved, versioned, and rollbackable.

The Agent may propose declarative changes.

The Instance owner may approve local overlays.

Only a trusted promotion path may add executable code.

No Actor may approve a change that widens its own authority or swaps in an evaluator that judges the same change.

### Customization flow

```text
User intent
→ inspect catalogs and current Experience
→ propose revision
→ validate schemas, references, effects, and accessibility
→ dry-run / preview
→ show diff and capability changes
→ human or policy approval
→ activate versioned overlay or Package revision
→ monitor and roll back
```

A preview is an isolated no-effect environment bound to versioned synthetic/redacted fixtures, exact Experience/Package revision, capability/data-use diff, accessibility/localization target matrix, and declared limitations. It cannot call production external Effects, receive broader Sources than the proposed activation, or imply that a preview validates production scale or residency. Deterministic screenshots/interaction fixtures and binding-test receipts support review; activation/rollback compatibility is proven separately rather than inferred from appearance.

Generated changes include localization/accessibility diffs, affected routes and bindings, required migrations, added/removed CAP capabilities, Authority/data-use/region/model/cost changes, test evidence, and rollback/forward-fix limits. Permission-aware binding prevents a generated View from exposing fields or Operations merely because they exist in a catalog.

If the request cannot be built from approved catalogs, the correct product behavior is a refusal plus a human package-engineering path—not arbitrary production code injection.

## 5.12 Packaging, Release, Deployment, installation, distribution, and upgrade safety

A reusable Agent or application moves through distinct lifecycle stages:

```text
Package lineage
→ immutable Package Version
→ verified Release build
→ Deployment into an Instance environment
→ staged activation or rollback
```

These concepts must not be collapsed.

- **Package** is the durable Publisher-owned lineage.
- **Package Version** expresses one immutable authored product definition and requested capability set.
- **Release** is an immutable deployable artifact verified against a policy, built from a Package Version plus pinned dependencies, kernels, migrations, policies, and provenance. Verification may require signatures and attestations but is not equivalent to “someone signed these bytes.”
- **Deployment** binds one Release to an Instance environment, region, configuration, Source/secret bindings, and rollout state.
- **Instance** is the durable Party-owned application context that survives Deployments and Release changes.

A reusable Agent or application may need:

- stable Package lineage and immutable version/digest;
- Publisher Party identity and signature;
- exact Package Version and dependency inputs;
- builder identity, build definition, environment, parameters, network access, and output digests;
- reproducibility grade and dependency/configuration locks for Packages, deterministic kernels, Semantic Models, Evaluators, Execution Profiles, orchestration definitions, feature flags, runtime configuration, migrations, and trusted code;
- separate Publisher, builder, and deployment-operator attestations;
- software bill of materials for executable dependencies and a component/license manifest for prompts, models, Knowledge, fixtures, generated assets, and other non-code behavior;
- test, security, accessibility, migration, evaluation, runtime, model, region, egress, key, vulnerability, and revocation evidence;
- trust-root distribution and rotation; Release signing, verification, quarantine, revocation, metadata freshness/expiry, key rotation, rollback/freeze-attack prevention, mix-and-match protection, and optional transparency reference for high-impact/public Releases;
- methodology, Knowledge, skills, and Agent definitions;
- Experience definition;
- Semantic Models;
- deterministic kernels and fixtures;
- Source requirements;
- Operation and Authority requirements;
- capability passport;
- cost and attention estimate;
- migrations and compatibility metadata;
- secret and credential **references** bound only at Deployment; secret values are never Package Version or Release content;
- installation;
- isolated Instance creation;
- local overlays;
- staged Deployment, upgrade, rollback, and Release-channel selection;
- export/import;
- share versus install distinction;
- fork/derive lineage;
- human and Agent-facing access;
- Usage Facts and entitlement;
- publisher analytics within the permitted boundary.

A Release is reproducible only if the behaviorally relevant dependency closure is pinned. A floating dependency, Semantic Model, Evaluator, kernel, model-routing rule, Execution Profile, feature flag, or policy revision silently changes the product and invalidates comparison unless the Release explicitly declares it as an external mutable dependency with bounded compatibility and monitoring.

Part 2 should prefer interoperable artifact, registry, provenance, SBOM, signing, and attestation standards where they satisfy the required semantics, but Part 1 does not mandate one transport. Whatever implementation is selected must additionally protect the update channel itself against rollback, freeze, mix-and-match, stale-metadata, and trust-root/key-rotation failures; a content digest or one signature alone is not a complete secure-update system.

The Release dependency graph must have deterministic resolution, cycle/diamond/conflict rules, lock evidence, unavailable-dependency behavior, and an offline or escrowed verification path where the product claims sovereign continuation. Runtime configuration and feature flags that can change behavior, Authority, data use, evaluator selection, or output must be versioned, reviewable, and included in the effective Deployment/Run lineage.

### Effective capability, data-use, dependency, and update-trust closure

A Package’s declared requests are only the starting point. Installation and every Release/Deployment computes the **effective transitive closure** across Package dependencies, optional features actually enabled, model/tool/runtime dependencies, Source/Capability Provider requirements, migrations, overlays, behavior-changing configuration, feature flags, support/evaluation/telemetry purposes, and delegated Operations.

Before installation, consent, upgrade, or activation, the system produces a machine-readable and human-readable effective-capability/information-flow diff against the active Release/Deployment, subscriber policy, entitlements, previously granted consent, and local overlays. The diff classifies unchanged, narrowed, expanded, incompatible, newly recurring, newly executable, newly chargeable, and re-consent-required behavior.

The capability passport and upgrade diff show both direct and transitive additions/removals for:

- `CAP` capabilities and contract versions;
- Sources/Resources/fields and credentials;
- Operation/Effect dimensions and autonomy/Approval;
- audiences, purposes, retention, support/evaluation/learning use, and onward transfer;
- models/providers/regions/runtimes/network egress;
- executable code, migrations, dependencies, trust roots, recurring/background activity, cost, and Attention.

Dependency resolution is deterministic and records resolver identity/version, repository/registry namespace and precedence, version/range semantics, optional/peer dependency semantics, cycle/diamond/conflict policy, platform/architecture compatibility, lock digest and lock-update authorization, unavailable/yanked/revoked dependency behavior, substitution prohibition or explicit equivalence rule, and reproducible/offline resolution evidence. No hidden network resolution or ambient registry fallback occurs during activation.

The update trust system protects more than artifact signatures. It has trusted root and delegated roles, metadata/version/freshness/expiry rules, threshold signatures where needed, key rotation/recovery, revocation/quarantine, rollback and freeze resistance, mix-and-match protection, repository compromise handling, equivocation detection and transparency/audit references where required, and offline/sovereign verification. It defines verifier clock source/skew/failure behavior, stale-root/bootstrap recovery, and safe operation when status or transparency services are unavailable. Trust metadata failure never silently selects a different Release.

Dependency resolution must be deterministic under cycles, diamond dependencies, conflicting version constraints, unavailable dependencies, revoked inputs, and optional components. The resolved graph and collision decisions are part of the Release digest; ambient registry state or load order is not.

Offline verification and sovereign continuation require cached trust metadata with explicit freshness and expiry. A Release that expands capability, information-flow purpose, model-provider eligibility, residency, Publisher analytics, or external Effect scope requires renewed Instance-owner consent rather than being treated as an ordinary patch.

### Capability passport

Before installation or subscription, the user should be able to understand:

```text
who published and built the Release
what Sources the Package requests
what Operations it can call
which actions require Approval
whether executable code is present
which models, kernels, dependencies, regions, and licenses it expects
estimated usage, attention, and cost
what Evidence or operational facts can leave the Instance
what migration and rollback behavior exists
what update trust roots, freshness/expiry, revocation, and rollback/freeze protections apply
```

### Deterministic contribution composition

Packages and installed applications may contribute Operations, Views, navigation, Agents, Semantic Models, Evaluators, triggers, kernels, and other named capabilities. Their composition must be deterministic and reviewable.

Required capabilities include:

- namespace every contribution by Package and stable contribution identity;
- detect collisions before Release activation;
- resolve each collision through an explicit policy such as **reject**, **disable**, **alias**, **wrap**, or **replace**;
- require stronger trust and authority for wrap/replace than for alias/disable;
- compile the resolved composition into an immutable manifest/digest used by the Instance and recorded on relevant Runs;
- produce a human-readable conflict and resolution report;
- never use import order, registration order, first-registration-wins, or ambient plugin precedence as semantic policy;
- preserve the prior compiled composition as last-known-good until the new one passes validation and activation checks.

### Upgrade, migration, restore, forward-fix, and end-of-life safety

A Publisher upgrade combines incumbent Release/Deployment, new verified Release and effective closure, local overlays, private data/schema, Source/secret bindings, Instance policy/entitlement/region, active Runs and clients, and a rollback/restore/forward-fix plan.

Required capabilities include:

- preflight of contracts, effective capability/data-use diff, policy, region, impact, dependencies, entitlement, update trust, runtime/configuration, active-Run compatibility, and customer consent;
- three-way merge of incumbent defaults, new defaults, and local overlays with explicit compatible/mergeable/conflict/capability-expansion/migration/manual classifications;
- no silent discard of private data, Work, overlays, decisions, or provenance;
- versioned signed migration plans with exact source/target schema, preconditions, checkpoints, idempotency, receipts, validation, pause/resume, and bounded Authority;
- **expand/contract** mixed-version migrations: backward/forward compatibility window, read-old/write-new and dual-read/write or translation policy, backfill, cutover barrier, old-client behavior, and contract/removal conditions;
- schema/data ownership for every Package contribution, deterministic migration dependency ordering, cycle/conflict detection, lock/lease and concurrent-upgrade policy, and an explicit decision path when two Packages claim incompatible ownership or transforms;
- dry-run fidelity declaration: copy/snapshot provenance and authority over private data; data scale/shape/constraints/indexes/triggers/external dependencies; masking/synthetic substitutions; zero or explicitly simulated foreign Effects; isolated credentials/network; cost attribution; cleanup/erasure and hold behavior; performance limits; evidence produced; and what cannot be predicted or proven about production safety;
- active-Run and checkpoint behavior across upgrade, including pinning, compatible continuation, drain, migration, or cancellation—not silent reinterpretation;
- staged activation, health/Quality Claim checks, monitoring owner, and last-known-good preservation;
- rollback feasibility based on new-state compatibility; reverse migration, compensation, restore, or forward fix when binary rollback is unsafe;
- destructive migration RPO/RTO and verified restore point;
- emergency security update policy: threat severity/evidence, Release revocation/quarantine, online and offline Instance behavior, allowed defer period, containment or forced suspension, operator versus Instance-owner authority, false-positive/appeal/reinstatement path, notification, export/continuity, and no silent forced feature expansion;
- explicit re-consent for Authority, data use, region, executable code, provider, support/evaluation, recurring work, or cost expansion;
- uninstallation/EOL/export behavior that never deletes subscriber Work merely because Package code is removed.

A failed build, composition, migration, or Deployment never mutates the active Instance. A forced security response may quarantine or suspend unsafe capability while preserving lawful data access, export, evidence, and a clear recovery path.
- adversarial tests for stolen Publisher/build keys, stale or rollback/freeze metadata, dependency substitution, mix-and-match components, malicious capability expansion, active-Run incompatibility, and compromised emergency-update paths;
- subscriber-visible compatibility/evaluation report covering capability, information-flow, Quality Claim, known improvement, regression, and unresolved migration risk.

## 5.13 Multi-Agent, multi-user, and multi-application composition

### Multi-Agent

Multi-Agent capability uses governed child Work/Runs and typed return contracts, not an opaque shared-prompt swarm.

A delegation envelope carries goal/output contract, selected context and Source Projections, candidate role/capability, allowed Operations and Effect dimensions, Authority/budget/deadline/service/Attention ceiling, further-delegation policy, validation/Evidence requirements, parent causality, and exact return schema. The host resolves the actual Agent identity/binding and proves transitive narrowing.

Required graph semantics include:

- acyclic delegation by default, or explicit cycle policy with maximum depth/visits;
- wait-for graph, deadline, cancellation, and deadlock detection for Agents/Work/Attention;
- shared-resource concurrency and lock/lease rules; reservation/budget partitioning, borrowing, release, and double-spend prevention; no two Agents silently overwrite one record or spend one Approval/reservation;
- conflicting proposals/Artifacts/Decisions remain distinct and enter deterministic merge, arbitration, or Human Attention rather than last-writer-wins;
- required-child completion, partial-result, unresolved Attention, and child Effect-unknown rules in the parent accepted Job Contract Revision; partial or uncertain child output is provenance-labeled and cannot satisfy a required parent precondition without the declared validation/override;
- separate child Usage Facts, Artifacts, Evidence, taint, Effects, and failures; parent rollup never hides them;
- cancellation, revocation, mandate/membership loss, budget, and deadline propagation;
- child output is untrusted until validated in the parent context, especially across Parties/Instances;
- measurable value over one well-configured Agent before added cardinality is treated as success.

### Multi-user

Collaboration has explicit membership and external-collaborator lifecycles.

Membership records controlling organization/Instance, Actor/Party, role/Binding, Authentication requirements, effective/expiry time, inviter/authority, status (invited, active, suspended, revoked, left, expired), and historical role changes. Revocation cascades to sessions/Authentication Contexts, Channel Bindings, delegated Grants, Source/Artifact access, pending Approvals/quorum eligibility, assignments, subscriptions, shared links, and future search visibility according to policy; historical audit remains.

External collaborators require sponsor/represented Party, purpose, allowed Work/Artifacts/fields/Operations, onward-sharing prohibition, residency/retention, expiry/renewal, Delivery/access method, watermarking/export policy, and offboarding. Guest links are not anonymous Authority.

Shared Work supports assignments, comments, presence/activity, redacted/role-specific Views, concurrent edits, typed Decisions, quorum/recusal, personal versus shared presentation state, and explicit record/component merge or conflict resolution. Comments, pasted content, and collaborator attachments are untrusted content unless carried in an authenticated Instruction Envelope and authorized for the purpose. Forwarding/export/share-link behavior, watermarking where appropriate, and downstream disclosure limits are explicit. Removing a collaborator does not delete valid historical actions, but it blocks new access, invalidates pending Decisions when eligibility changed, revokes controlled links/caches, and records what external copies cannot be recalled.

### Multi-application

Capabilities may include:

- several installed Packages;
- namespaced contributions;
- deterministic collision detection and explicit disable/alias/wrap/replace policy;
- an immutable compiled composition and conflict report rather than load-order behavior;
- preserved entitlements and lineage;
- cross-application Source or Artifact references that do not themselves confer access;
- policy-filtered shared search or Attention without implicit Source, entitlement, or Authority widening;
- optional navigation composition;
- optional global composer.

Business principle:

> Adding an Agent, collaborator, or Package should add a binding or contribution rather than require another authority, Work, or operation architecture.

The exact UX of a universal multi-app shell and unified cross-app Work remains intentionally unresolved.

## 5.14 Cloud, sovereignty, compliance, data lifecycle, and degraded operation

The platform may need to support:

- local execution;
- Swiss or EU hosting;
- dedicated tenancy;
- customer-controlled deployment;
- replaceable model providers;
- replaceable compute and sandbox providers;
- customer-held credentials;
- encrypted secrets;
- private networking;
- regional storage, model, Source, and execution policy;
- backup, restore, export, deletion, and legal hold;
- isolation across every applicable shared or dedicated boundary—including databases, object stores/buckets, queues, caches, search/vector stores, sandboxes, telemetry, support systems, backups/restores, and encryption keys—rather than assuming one `instance_id` column is sufficient;
- audit and diagnostics;
- provider outage degradation;
- read-only access to prior Work and Artifacts when the model is down.

Sovereignty means more than data location.

Instance/Party isolation must be enforced at every applicable security boundary: database row or dedicated database, object namespace or dedicated bucket, queue/stream subject, cache, search/vector partition, sandbox/workspace, temporary storage, backup/restore domain, Usage Fact, support session, and observability correlation. Dedicated infrastructure is a valid implementation; the invariant is that no shared substrate can bypass the Instance/Party boundary. Cross-Instance access requires an explicit transfer/shared-Source relation and fresh egress/ingress authorization.

Residency claims cover not only primary content storage but also derived Projections, model/tool processing, connector transit, logs/telemetry, support copies, backups, keys, and disaster-recovery locations. Key ownership, scope, rotation, revocation, and truthful cryptographic-erasure limits are part of the declared sovereignty profile.

Every Deployment should declare control-plane, identity-provider, policy-service, region, and provider outage behavior per operation class. A signed expiring entitlement/policy lease may be one implementation for bounded disconnected operation, but it is not universal: maximum staleness, revocation exposure, allowed reads/writes/Effects, split-brain prevention, and fail-closed conditions must be explicit. Portability does not imply transparent active-active or multi-master synchronization; copy, move, fork, restore, import, and any local-first conflict resolution remain declared operations.

It also means the owning Party retains:

- identity and membership;
- application data;
- Source configuration and credential references;
- Work history;
- Artifacts and Deliveries;
- human Decisions;
- Evidence and Outcomes;
- Package, Release, Deployment, and Revision lineage;
- the ability to export, correct, erase, migrate, or continue operating in degraded mode.

### Sovereign continuity and disaster-recovery scenario contract

Every advertised sovereignty/recovery posture declares scenario-specific behavior rather than one generic RPO/RTO. The matrix covers at least:

- process/worker/queue failure;
- Availability Zone or regional loss;
- control-plane, identity, policy, entitlement, key-broker, model, Source, or Channel outage;
- data corruption, bad migration, compromised Release/update metadata, and operator-account compromise;
- backup loss or restore into a new region/account/provider;
- customer-controlled disconnection and provider/Boring disappearance.

For each scenario it declares detection, decision authority, continuity surface, fail-closed operations, RPO/RTO, backup and key location/ownership, restore dependencies, split-brain prevention, DNS/endpoint and identity continuity, policy/entitlement lease limits, data-residency consequences, external-Effect reconciliation, deletion/hold restore ledger, test frequency, last evidence, and customer communication.

A restore is not successful until Instance isolation, policy, keys, Source bindings, Package/Release trust, Work/Run/Effect/Delivery integrity, projections, and deletion/hold obligations are verified. Sovereign export/import identifies which identities are preserved, remapped, or forked and how foreign references are reconciled.

Offline verification and key semantics remain explicit: cached Release/policy/entitlement/trust verification has a declared freshness window; operation- and impact-specific fail-closed rules apply when revocation cannot be checked; split-brain is prevented by fencing/single-writer policy; and key owner, scope, region, rotation, recovery, revocation, destruction, replica, backup, and cryptographic-erasure limits are declared honestly.

### Data lifecycle, holds, erasure, Evidence withdrawal, and portable exit

Required capabilities may include:

- retention clocks by data class and purpose;
- explicit legal, regulatory, contractual, and incident holds with scope, authority, expiry/review, and a conflict-resolution process when holds and erasure requests collide;
- deletion propagation to controlled derived Projections, indexes, caches, embeddings, sandboxes, support copies, and backups under declared recovery windows;
- a restore ledger so content scheduled for deletion is not silently resurrected after backup recovery;
- truthful claims about cryptographic erasure, including key scope, shared media, replicas, and recovery-window limits;
- non-identifying tombstones and erasure receipts where lawful;
- correction, withdrawal, dispute, and purpose revocation for Evidence and Outcomes;
- marking evaluations, Objective Bases, incumbents, and promotion records whose Evidence set changed materially;
- revalidation, qualification, forward fix, or rollback when changed Evidence invalidates a Decision;
- explicit limits on model or method “untraining” after customer Evidence has influenced a shared Revision;
- acknowledgement that the platform cannot recall a valid export or Delivery from an external recipient it no longer controls;
- preservation of structural audit without retaining identifying content beyond policy;
- a signed or integrity-protected portable export manifest containing documented formats for Work graph, Artifact versions, Human Decisions, Outcome Definitions, provenance, information-flow policy, Instance overlays, and Package/Release lineage;
- clear **copy, move, fork, restore, and import** semantics, including whether identities are preserved or remapped;
- exclusion of secrets, provider credentials, and other non-exportable or non-redistributable third-party material;
- clear treatment of licensed third-party data that may be referenced but not redistributed.

A customer’s right to exit must not require trusting the original model provider, runtime vendor, or Boring UI shell. Sovereignty claims must stop where third-party recipients, licenses, backups, or model-training systems are outside the platform’s actual control.

## 5.15 Developer, Publisher, and operator capabilities

The people building and operating applications—including Boring’s own team—need to understand and repair Agent behavior in minutes, not days.

### Admission snapshot, append-only execution record, replay grades, audit, and observability

A non-trivial Run needs two complementary records rather than one impossible “immutable manifest” containing facts that do not yet exist.

#### Admission snapshot

Created before execution and immutable except through an explicitly linked amendment/refusal path. It captures the intended and trusted context:

- Party, represented role, Instance, Run, Actor, Agent binding, and Agent revision, plus Work for a full Execution Run or Thread and optional draft/prospective Work for an Intake Run;
- Package Version, Release, Deployment, compiled composition, and local-overlay versions;
- admitted input and Job Contract Revision references/digests;
- model/provider and model-policy selection;
- Operation contract, deterministic-kernel, Semantic Model, Source/Projection/Vintage, Knowledge, and prompt/template references where policy permits;
- Authority ceiling, policy decision, obligations, Approval, delegation, Payer Binding, budget, service class, impact ceiling, idempotency, and Delivery policy;
- runtime/provider placement constraints, required Execution Profile, orchestration revision, and environment-attestation requirements.

#### Append-only execution record

Accumulates what actually happened:

- worker claims, Attempts, checkpoints, transfers, and terminal state;
- concrete Model Invocations, tool/kernel calls, and Operation Invocations;
- platform facts, claims, Human Decisions, Usage Facts, costs, latency, and failures;
- Artifact versions, Effects, dispatch attempts, receipts, reconciliation, compensation, Deliveries, gates, and integrity findings;
- corrections, supersession, and externally observed facts.

A terminal digest may seal the completed record while leaving subsequent corrections or Outcomes as linked append-only facts.

#### Replay grades and safety

Replay must state its grade:

1. **exact** — all relevant inputs, dependencies, deterministic seeds, and runtime behavior can be reproduced;
2. **equivalent but nondeterministic** — the same contracts and inputs are used but model/provider nondeterminism remains;
3. **counterfactual** — selected revisions, models, policies, budgets, or data are deliberately changed for comparison;
4. **forensic only** — enough facts exist to reconstruct causality, but not to rerun faithfully;
5. **not reproducible** — material inputs, licensed content, Vintages, dependencies, or policy-permitted content are unavailable.

Replay, shadow execution, and counterfactual evaluation default to **no external Effects, no customer writes, no duplicate Delivery, and no duplicate charge**. Enabling any of them requires a separately admitted and authorized path.

#### Durable audit versus observability and support

Business audit is durable, attributable, access-controlled, exportable, and tamper-evident in proportion to impact. It is the authoritative record of Admission, Human Decisions, Effects, Deliveries, Outcomes, and promotion.

Traces, metrics, logs, profiles, and correlation identifiers are operational signals. They may be sampled, redacted, aggregated, retained differently, or unavailable. By default they exclude raw prompts, Source content, secrets, personal data, provider payloads, and Artifact bodies, and correlation identifiers must not themselves leak sensitive data.

Support access is purpose-bound, time-limited, minimum-necessary, separately authorized, and audited. It records the acting support Actor, represented platform/customer Party, accessed facts or content, reason, duration, and any export. Telemetry loss may worsen diagnosis; it must never corrupt business truth.

Audit records support append-only correction/supersession, not mutation. Tamper evidence declares canonical encoding, chain/tree/ledger scheme, signing/MAC keys and custodians, rotation/revocation and verification schedule, timestamp source, anchoring/checkpoint policy, verification after export/restore, gap detection, and behavior when integrity evidence is unavailable. Incidents preserve an evidence timeline linking detection, access, Decisions, changes, containment, recovery, verification, and customer/regulator notifications. “Tamper-evident” is a Quality Claim with test evidence, not a label.

A support session is a first-class governed lifecycle: requested, approved, stepped-up, active, paused, expired/revoked, closed, and post-reviewed. It binds support Actor, represented platform/customer Parties, customer sponsor or approved policy, purpose/ticket/incident, exact facts/content scope, tools/Effects, recording/redaction, start/expiry, exports, customer visibility/notification, and emergency path. Screen-sharing, impersonation, database access, and exported diagnostics are distinct capabilities.

The developer contract includes a versioned manifest and lockfile for Package/contract/CAP dependencies, environment/configuration, model/tool/runtime requirements, fixture identities/versions, and Release inputs. CLI/API commands have stable machine-readable output schemas, exit codes, noninteractive/CI mode, Authentication Context, offline behavior, dry-run/plan semantics, environment promotion and configuration-diff semantics, and local/hosted parity assertions against declared provider stubs or conformance endpoints. `npx boring` remains a supported user journey over this stable contract.

Required developer/operator capabilities may include:

- fact-level Run and Attempt inspection without requiring content by default;
- separately authorized, redacted content inspection when operational facts are insufficient;
- replay against a new Agent, Release, model policy, Evaluator, Outcome Definition, kernel, or semantic revision;
- local development with the same Work, Operation, Artifact, Effect, and policy contracts as hosted execution;
- evaluation fixtures runnable locally, in CI, and during Release publication;
- diagnostics by Instance, Agent, Source, Package, Release, and Deployment;
- Package/contract compatibility and migration tests;
- cost, error, attention, and latency dashboards;
- incident response, Effect reconciliation, and Evidence-withdrawal tools;
- kill switches, budget freezes, Release quarantine, staged rollout, and rollback tools;
- a stable language-neutral `boring` command contract, with supported wrappers such as `npx boring`, `uvx`, package-manager binaries, or containers; the documented journey may continue to use `npx boring create`, `dev`, `test`, and `deploy` while the underlying contract remains language-neutral;
- commands or equivalent APIs for create, dev, plan/preview, doctor, test, eval, replay, diff, deploy, promote, rollback, export, and conformance inspection;
- a local emulator for Work/Run/Policy/Effect/Delivery contracts, deterministic clocks, provider/model stubs, fake connectors, and fault injection;
- generated and hand-authored conformance/consumer-contract suites covering semantic compatibility rather than schema shape alone;
- scoped kill switches and budget freezes for Party, Instance, Agent/revision, Automation, Operation, Source, Capability Provider, model/provider, Channel, Release, Deployment, payer/budget, and Effect dimension, with deterministic precedence, active-Run/queued-Work/Effect/Delivery behavior, issuer/reason/expiry, recovery prerequisites, reactivation Decision, and audit;
- templates for job Agents, expert Agents, SaaS applications, headless Agents, and workers;
- local/hosted contract parity, deploy previews, capability passports, Source/secret binding, region selection, logs, health, and promotion;
- orchestrator and worker-Agent APIs using bounded child Work, isolated execution, budgets, and provenance;
- automated review gates with platform-originated receipts, negative controls, mutation tests, anti-tampering checks, and human inbox review;
- active-Run upgrade tests, fence/lease-loss tests, duplicate/reordered event tests, Effect-unknown and reconciliation tests, policy/identity/control-plane outage tests, model-alias/fallback drift tests, Source revocation/drift tests, migration/restore tests, and deletion-after-restore tests;
- scoped kill switches for Agent binding, Operation, Source, connector, model/provider, Release, Deployment, Instance, Channel, and payer/budget, with precedence, audit, recovery, and no hidden history rewrite;
- audit-integrity verification, key rotation, support-session revocation, and facts-plane schema/version diagnostics.

## 5.16 Flexible commercial, billing, and unit-economics capabilities

The platform must support different commercial models by vertical and distribution path. It must not assume that the universal unit of value is a token, seat, or subscription.

Potential pricing and commercial models include:

- free or internal use;
- paid pilot or implementation fee;
- monthly or annual subscription;
- per-user, per-team, per-Instance, or per-environment pricing;
- per Work/job pricing;
- per delivered Artifact or service-level tier;
- usage credits for model, tool, compute, or external-provider consumption;
- retainer or managed service;
- developer hosting fee plus usage;
- expert-Agent subscription;
- publisher revenue share;
- enterprise committed-spend contract;
- bring-your-own-model/provider credentials with platform fees;
- outcome-linked or shared-savings pricing where attribution is credible;
- hybrid combinations of the above.

Commercial capabilities may require:

- accounts and organizations;
- Instances and developer projects;
- offers, plans, and entitlements;
- payer/funding Party identity separate from the user, acting Agent, Publisher, and Instance owner;
- Usage Facts attributed by Party, Work, Run, Attempt, Model Invocation, Operation Invocation, Effect/Delivery attempt, Artifact, Agent, Package/Release, Instance, Source, Channel, external consumer, and payer/funding context;
- duplicate-safe Usage Fact lifecycle for estimate, reservation, accrual, provider actual, allocation, correction, reversal, and write-off, with stable identity, schema version, quantity/unit/currency basis, producer/source receipt, observed/recorded time, deduplication key, and append-only supersession;
- prevention and reconciliation of double counting across retries, cache hits, reconciliations, child Work, partial Effect Groups, and late provider corrections;
- budget reservations and hard limits;
- credits, quotas, included allowances, and overage policy;
- trials and promotional access;
- subscriptions and contract terms;
- per-job quotes, acceptance, and delivery-based charging;
- quote confidence/range, assumptions, included scope, usage/service basis, validity/expiry, material-change tolerance, and explicit re-consent when a new estimate exceeds that tolerance;
- publisher/developer revenue share;
- cost attribution to subscriber, publisher, developer, platform, model provider, or customer contract;
- gross-margin analysis by Work, Artifact, Agent, Package, Instance, Source, and channel;
- attention cost, support cost, and external-provider cost as well as token cost;
- suspension without data destruction;
- entitlement downgrade, expiry, suspension, and reactivation policy: new Admissions and queued-but-unadmitted Work are blocked or reduced immediately; active Runs continue, pause, or cancel according to captured entitlement, impact, and contract policy; Level-0 reads, export, and safe Attention remain available unless a legal/security hold requires stronger restriction; reactivation preserves identity and history rather than provisioning a new customer;
- export and cancellation rights;
- private, unlisted, public, and developer-hosted offerings;
- tax, currency, invoice, payment, and settlement provider integration;
- abuse and rate controls.

### Usage Fact, quote, entitlement, and Quality Claim lifecycles

Every Usage Fact has stable ID, schema version, fact kind (`estimate`, `reservation`, `accrual`, `provider actual`, `allocation`, `correction`, `reversal`, or `write-off`), measured quantity/unit/currency basis, producer and source receipt, observed/recorded time, Run/Attempt/Invocation/Effect/Delivery causality, payer/entitlement/pricing reference, deduplication key, and supersession/correction relation. Facts are immutable; corrections and reversals append. Reconciliation detects missing provider actuals, duplicates, retry/cache allocation errors, and reservation leakage.

A quote-to-bill chain keeps separate:

```text
usage/service estimate
quote offer and assumptions/tolerance/expiry
authorized acceptance/Job Contract Revision
reservation and actual Usage Facts
pricing calculation/version
chargeable event such as accepted Delivery
invoice/credit/refund
dispute, evidence, adjudication, and settlement
```

A provider estimate is not a customer price; a Delivery provider receipt is not automatic charge proof; a corrected or late Usage Fact does not silently rewrite an issued invoice. Quote and invoice presentation bind currency, tax jurisdiction/treatment, unit, rounding, locale, and pricing-policy version. Credits, refunds, write-offs, chargebacks, fraud/risk holds, late provider costs, and settlement corrections append causal records. Disputes preserve the exact contract, quote, meter facts, calculation, Decisions, fraud controls where relevant, and resolution.

Entitlement has typed states and transitions: proposed, trial, active, grace, restricted, suspended, expired, cancelled, and terminated. The transition cause is also typed—quota/budget exhaustion, nonpayment, contract expiry/termination, security revocation, legal/regulatory hold or prohibition, provider ban, abuse response, operator outage, or customer choice—because each cause has different effective time, notice, appeal/cure, active-Run and Effect behavior, queued Work, scheduled Automations, new Admissions, continuity surface, Artifact/export access, retained data, credentials, and reactivation. Downgrade cannot silently widen another payer or destroy customer data.

Every advertised service, continuity, recovery, latency, freshness, Delivery, accuracy, cost, or assurance promise is a versioned Quality Claim. It declares scope/cohort, applicability and exclusions, measurement source/method, numeric target or explicit qualitative bound, observation window, error budget/tolerance, owner, evidence/freshness, breach/remedy, lifecycle, and withdrawal/supersession. A waiver or temporary exception has approver, rationale, compensating control, affected scope, expiry, customer-disclosure rule, and revalidation. Internal metrics do not become contractual promises accidentally.

### Admission-time payer and credential binding

For billable, budgeted, or externally funded Work:

- the host resolves payer, funding source, entitlement, budget reservation, and commercial-policy revision before execution;
- the Actor, Agent, Source content, external channel, and model cannot override the payer or select ambient platform credentials;
- model/provider credentials are selected per Execution according to the captured payer/Instance policy, including bring-your-own-provider arrangements;
- usage, cost, and provider facts attach only to the admitted Execution and its payer/funding binding;
- a retry or child Execution retains explicit cost causality, allocation rule, and reservation lineage rather than silently switching payer or double charging;
- support can explain who paid, which credentials/policy were used, and why without needing to inspect Work content;
- missing or ambiguous payer binding blocks billable execution rather than producing unattributed usage.

Payer binding is structural. Pricing formulas, invoices, and payment providers remain commercial policy.

### Commercial-layer separation

The platform should keep one admission relation and five commercial layers conceptually separate:

0. **Payer Binding:** who funds the admitted Execution, under which entitlement, budget, provider-credential policy, and settlement scope.
1. **Usage facts:** measured consumption, cost, attention, and provider facts for that admitted Execution.
2. **Entitlement and budget:** what is allowed and within which ceilings.
3. **Pricing policy:** how an offer maps access, Work, delivery, usage, service level, or Outcome to money.
4. **Billing and collection:** invoices, payment, tax, credits, and contract administration.
5. **Settlement and payout:** allocation among platform, publisher, developer, customer, and provider.

The structural premise is accurate, durable usage and cost attribution. Those facts are not invoices.

Estimates, reservations, provider actuals, corrections, and reversals must be duplicate-safe and independently attributable. A correction never rewrites the original Usage Fact; billing and settlement consume the corrected fact set under a versioned commercial policy.

Billing, pricing, payout, and payment-provider implementations should remain flexible commercial systems selected by the vertical and offer.

Outcome-based charging must be used only when the versioned Outcome Definition and attribution are defensible; missing, noisy, or contested Outcomes must not be converted into fabricated billing certainty.

---

# 6. Capability matrix and preservation class

Business-context annotations in this matrix are **informative**, not conformance gates. Applicability is determined only by the trigger and the exact product/Package/Deployment/Work/Operation/data/commercial/impact facts. The compact context summary uses `intrinsic`, `typical`, `conditional`, or a qualified trigger; absence of a context never prohibits the capability.

`CAP` matrix schema version is **1**. For each applicable row, the machine-readable manifest must record `capabilityId`, `capabilityVersion`, parent `BR` family or families, applicability decision and facts, accountable owner, conformance/negative/fault/exit test IDs, evidence and freshness, dependencies, compatibility result, omissions, waiver/expiry/compensating control, and unresolved `DEC` dependencies.

Legend for preservation class:

- **STRUCTURAL** — Part 2 must preserve the identity, boundary, or historical relation.
- **EXTENSIBLE** — Part 2 needs an extension point, not necessarily a root object.
- **PRODUCT** — primarily a product or presentation decision.

The matrix is a traceability and applicability map, not a build list. Every row has a stable `CAP-xxx` ID. Applicability is evaluated from the exact product, Package, Deployment, Work type, Operation/Effect dimensions, data classes, commercial promise, and impact profile.

Rules:

- **When used / claimed** means the product may omit the capability, but once used or advertised its structural relations and evidence become mandatory.
- **When consequential or external** is triggered by the exact Invocation/Effect/Delivery/Attestation, not by a global product label.
- **When Improve is claimed** is triggered by comparison, shared learning, promotion, or outcome-driven claims—not ordinary feedback collection.
- **When metered, budgeted, or sold** is triggered before attributable usage or commercial promises occur.
- Omission, waiver, version, dependency, evidence freshness, and compatibility are declared in the capability/conformance manifest; “not applicable” requires a reason, owner, and review condition.

| ID | Capability | Applicability trigger | Frequent business contexts (informative) | Parent BR family | Preservation |
|---|---|---|---|---|---|
| CAP-001 | Purpose-built Experience | When a human Experience is provided | Operate: intrinsic; Distribute: typical; Improve: intrinsic; Internal factory: typical | BR-038 | STRUCTURAL for Experience↔Operation bindings; PRODUCT for exact shell |
| CAP-002 | Declared continuity surface and fail-closed matrix | Every product, Work type, and Deployment declares its continuity/fail-closed behavior | Operate: intrinsic; Distribute: typical; Improve: typical; Internal factory: typical | BR-003, BR-053 | STRUCTURAL continuity/Quality Claim facts; PRODUCT for UI |
| CAP-003 | Stable Actor and Agent identity | Whenever a human, Agent, automation, service, or external client participates | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-005, BR-006 | STRUCTURAL |
| CAP-004 | Agent binding and scoped personalization | When an Agent participates in an Instance or scoped personalization is offered | Operate: typical; Distribute: intrinsic; Improve: typical; External/headless: typical; Internal factory: typical | BR-006 | STRUCTURAL relation |
| CAP-005 | Delegable semantic Operation parity and explicit human-only acts | When more than one Actor class may perform a delegable semantic act | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-004, BR-014 | STRUCTURAL |
| CAP-006 | Operation kind and multidimensional Effect declaration | Every Operation contract and exact Invocation | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-015 | STRUCTURAL |
| CAP-007 | Per-operation autonomy policy | When an Agent or Automation may observe, propose, act, or trigger review under policy | Operate: typical; Distribute: typical; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-015, BR-018 | STRUCTURAL policy facts; EXTENSIBLE UX |
| CAP-008 | Dry-run, compensation, concurrency | When a command can conflict, mutate, disclose, deliver, or require recovery | Operate: typical; Distribute: typical; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-015, BR-016 | STRUCTURAL Operation contract |
| CAP-009 | Deterministic domain kernel | When a purchased numerical, feasibility, rule, or constraint claim is made | Improve: triggered; Internal factory: typical | BR-014 | EXTENSIBLE driver; STRUCTURAL version reference when used |
| CAP-010 | Heterogeneous Sources | When connected or external data is read, queried, synchronized, or projected | Operate: typical; Distribute: typical; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-021 | STRUCTURAL Source identity; EXTENSIBLE connectors |
| CAP-011 | File projections and shell access | When a file or shell-like Projection is exposed | Operate: typical; Distribute: typical; Improve: typical; Internal factory: intrinsic | BR-021, BR-023 | EXTENSIBLE projection over STRUCTURAL grants |
| CAP-012 | Domain Contract | Every application exposing meaningful domain behavior | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-014 | STRUCTURAL |
| CAP-013 | Analytical semantic engine (current `BSL` implementation) | When analytical semantic discovery/query/explanation is used | Operate: typical; Distribute: conditional; Improve: triggered; Internal factory: typical | BR-014, BR-022 | EXTENSIBLE engine; STRUCTURAL model/version provenance when used |
| CAP-014 | Durable Work | When customer value must be named, durable, resumable, costed, delivered, or outcome-linked | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-008 | STRUCTURAL |
| CAP-015 | Versioned Job Contract Revision and bounded delivery | When bounded deliverables, acceptance, service, or delivery-based charging are promised | Operate: typical; Distribute: intrinsic; Improve: typical; External/headless: intrinsic; Internal factory: intrinsic | BR-007, BR-028 | STRUCTURAL Work↔Artifact↔delivery linkage; PRODUCT intake UX |
| CAP-016 | Channel-first intake and cross-channel continuity | When intake, steering, Approval, status, or Delivery crosses a Channel | Operate: typical; Distribute: intrinsic; Improve: conditional; External/headless: intrinsic; Internal factory: typical | BR-009, BR-037 | STRUCTURAL Actor/Work linkage; EXTENSIBLE channel adapters |
| CAP-017 | Admission-first Execution and platform-bound context | Before any model, tool, Capability Provider, Agent-runtime Source read, sandbox, Effect, or customer-chargeable call | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-011 | STRUCTURAL |
| CAP-018 | Thread-only conversation, draft Work, and constrained Intake Run without unadmitted Agent use | When pre-contract conversation may need Agent/tool/Source-assisted clarification | Operate: typical; Distribute: intrinsic; Improve: typical; External/headless: intrinsic; Internal factory: intrinsic | BR-009, BR-011 | STRUCTURAL links and Admission facts; PRODUCT intake UX |
| CAP-019 | Layered Channel / Admission / Operation-Effect / Delivery idempotency | Whenever ingestion, Admission, Invocation, Effect, Delivery, or callback can be duplicated or retried | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-010 | STRUCTURAL identity, digest, conflict, and lifetime semantics |
| CAP-020 | Payer/funding and per-Execution credential binding | When execution is metered, budgeted, subsidized, or sold | Operate: typical; Distribute: intrinsic; Improve: typical; External/headless: intrinsic; Internal factory: intrinsic | BR-052 | STRUCTURAL attribution; EXTENSIBLE commercial policy |
| CAP-021 | Stable execution/evidence join | When Evidence, cost, Artifact, Effect, Delivery, or Outcome must join to execution | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-008, BR-011, BR-029–BR-031 | STRUCTURAL |
| CAP-022 | Content-free operational facts plane | When metering, reliability, audit, reconciliation, or support is operated | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-029 | STRUCTURAL separation; EXTENSIBLE telemetry/support consumers |
| CAP-023 | Independent Work/Run/Attempt/claim/Invocation lifecycles | Whenever the corresponding Work/Run/Attempt/Invocation/Effect/Delivery records exist | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-008, BR-012, BR-013, BR-015, BR-016, BR-028 | STRUCTURAL |
| CAP-024 | Separate Attempt history, Lease/fencing authority, and Model Invocation facts | When Agent/model execution uses workers, retries, checkpoints, leases, or fallbacks | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-012, BR-020 | STRUCTURAL |
| CAP-025 | Atomic commit boundary, outbox/inbox, duplicate-safe events, and declared read consistency | When one authoritative transition also emits asynchronous work or spans stores/components | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-013 | STRUCTURAL semantics; EXTENSIBLE storage/transport |
| CAP-026 | Durable orchestration revisioning, active-Run upgrades, cancellation, and deadlines | When Runs may outlive a process, worker, deployment, checkpoint, or deadline | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-012 | STRUCTURAL history/version semantics; EXTENSIBLE engines |
| CAP-027 | Effect intent, Effect-group, dispatch, observation, resolution, and compensation | Whenever an Invocation may cause mutation, disclosure, Delivery, administration, finance, coordination, or a foreign action | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-016 | STRUCTURAL |
| CAP-028 | Last-known-good continuity | When a refreshable result, incumbent, compiled composition, Release, or upgrade needs fallback | Operate: typical; Distribute: typical; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-003, BR-034, BR-041, BR-042 | STRUCTURAL incumbent pointer; PRODUCT stale policy |
| CAP-029 | Logical Artifact identity and immutable versions | When a durable output, candidate, deliverable, or proof is created | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-026 | STRUCTURAL |
| CAP-030 | Delivery lifecycle and acceptance Decision | When an exact result is handed to one or more consumers | Operate: typical; Distribute: intrinsic; Improve: typical; External/headless: intrinsic; Internal factory: intrinsic | BR-028 | STRUCTURAL exact-version/recipient/receipt relation; EXTENSIBLE channels |
| CAP-031 | Attention request plane | When asynchronous Work can require human judgment, review, or notice | Operate: asynchronous agent work; Distribute: intrinsic; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-017 | STRUCTURAL exact target/lifecycle; EXTENSIBLE presentation/channels |
| CAP-032 | Typed Human Decisions | Whenever a human response changes Authority, acceptance, promotion, attestation, override, or disposition | Operate: typical; Distribute: intrinsic; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-017, BR-018 | STRUCTURAL append-only target/version relation; PRODUCT decision UX |
| CAP-033 | Exact approval binding, invalidation, step-up, and quorum | When a Human Decision can authorize a consequential exact target | Operate: typical; Distribute: typical; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-018 | STRUCTURAL approval intent; EXTENSIBLE identity/channel policy |
| CAP-034 | Automation Actor plus versioned trigger/rule | When non-human schedules, events, rules, or queues may initiate Work | Operate: typical; Distribute: typical; Improve: typical; External/headless: typical; Internal factory: intrinsic | BR-036 | STRUCTURAL Actor/rule/provenance; EXTENSIBLE trigger engines |
| CAP-035 | Schedule, watermark, backfill, late-event, and loop-control policy | When schedules, event streams, watermarks, backfills, or automation chains are used | Distribute: typical; Improve: typical; External/headless: typical; Internal factory: intrinsic | BR-036, BR-037 | EXTENSIBLE policy/engines over STRUCTURAL causality/budget |
| CAP-036 | Untrusted-content handling | When Agent/model context can contain third-party, user-supplied, tool, or child-Agent content | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-019, BR-025 | STRUCTURAL |
| CAP-037 | Conservative Run taint plus value-level provenance, typed validation, and trusted Approval rendering | When tainted or mixed-provenance execution may reach a consequential sink | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-018, BR-019 | STRUCTURAL provenance/Decision/egress links; EXTENSIBLE detectors |
| CAP-038 | Versioned Execution Profiles, credential brokering, rendering isolation, and governed egress | When untrusted code/content, privileged connectors, browsers, renderers, kernels, or sandboxes execute | Operate: typical; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-025 | STRUCTURAL profile/runtime facts; EXTENSIBLE providers |
| CAP-039 | Taint-aware Approval | When an Approval depends on content consumed by an Agent/model Run | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-018, BR-019 | STRUCTURAL taint on Run/Attempt and exact Approval link |
| CAP-040 | Explicit cross-boundary transfer control | Whenever data crosses an audience, purpose, Party, Instance, Publisher, provider, support, evaluation, or export boundary | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-024 | STRUCTURAL transfer form, information-flow labels, and egress check |
| CAP-041 | Identity federation (SSO/OIDC; directory sync) | When enterprise federation or directory-managed identity is claimed | Improve: typical | BR-005, BR-018, BR-045 | EXTENSIBLE identity provider over STRUCTURAL Party/Actor relation |
| CAP-042 | Retention, legal hold, and data-subject erasure | When retained data is subject to deletion, hold, correction, purpose limitation, or exit | Operate: typical; Distribute: intrinsic; Improve: intrinsic; External/headless: typical; Internal factory: typical | BR-024, BR-048 | STRUCTURAL identifying-content/audit separation; EXTENSIBLE policies |
| CAP-043 | Rate limiting and abuse control for public products/Agents | When public, shared, abusive, multi-tenant, or externally callable surfaces exist | Distribute: typical; External/headless: intrinsic | BR-036, BR-037 | EXTENSIBLE enforcement over STRUCTURAL Actor/Channel/Operation attribution |
| CAP-044 | Package trust and capability passport | When a Package or Release is installed, subscribed to, distributed, or upgraded | Distribute: intrinsic; Improve: typical; External/headless: typical; Internal factory: typical | BR-039, BR-040, BR-043 | STRUCTURAL Package lineage/trust |
| CAP-045 | Advice / Action / Attestation class | When output carries advice, action, or business/professional attestation meaning | Operate: typical; Distribute: typical; Improve: regulated products; External/headless: typical; Internal factory: typical | BR-015, BR-018 | STRUCTURAL metadata when used |
| CAP-046 | Invocation/exposure-specific impact profile and Attestation lifecycle | When an Invocation, Delivery, exposure, Release, or Attestation can be consequential | Operate: typical; Distribute: typical; Improve: regulated products; External/headless: typical; Internal factory: intrinsic | BR-015, BR-018, BR-034 | STRUCTURAL when consequential; EXTENSIBLE policy/assurance providers |
| CAP-047 | Preference evidence | When preference, correction, acceptance, or rejection is retained for later use | Operate: typical; Distribute: typical; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-030 | STRUCTURAL linkage |
| CAP-048 | Permissioned Evidence observations and claims | Whenever a claim, measurement, receipt, decision, observation, or evaluation result is used as Evidence | Operate: typical; Distribute: typical; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-030 | STRUCTURAL provenance/purpose; EXTENSIBLE capture |
| CAP-049 | Versioned delayed real-world Outcomes and measurement semantics | When real-world Outcome or outcome-driven claims are made | Operate: typical; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-031 | STRUCTURAL definition/cohort/attribution/linkage; EXTENSIBLE capture |
| CAP-050 | Versioned Objective Basis across Work | When explicit candidate/incumbent comparison spans Work | Distribute: typical; Improve: intrinsic; Internal factory: intrinsic | BR-032 | STRUCTURAL when improvement exists; absent from ordinary Work |
| CAP-051 | Evaluation and incumbent comparison | When a candidate is compared with an incumbent | Operate: conditional; Distribute: typical; Improve: intrinsic; Internal factory: intrinsic | BR-032, BR-033 | STRUCTURAL revision/incumbent relation; EXTENSIBLE evaluators |
| CAP-052 | Evaluation integrity and anti-gaming defenses | When evaluation can influence promotion, publication, policy, or commercial claims | Distribute: typical; Improve: intrinsic; Internal factory: intrinsic | BR-033, BR-035 | STRUCTURAL held-out/authorship/instrumentation separation; EXTENSIBLE detectors |
| CAP-053 | Load-bearing gate verification | When a review/evaluation gate is claimed to protect a decision | Improve: intrinsic; Internal factory: intrinsic | BR-035 | STRUCTURAL gate receipts; EXTENSIBLE mutation/negative-control methods |
| CAP-054 | Controlled promotion and rollback | When a candidate may be exposed, activated, expanded, halted, or rolled back | Operate: typical; Distribute: typical; Improve: intrinsic; Internal factory: intrinsic | BR-034 | STRUCTURAL |
| CAP-055 | Agent-generated declarative Experience | When an Agent may propose Experience or workflow changes | Operate: typical; Distribute: typical; Improve: typical; Internal factory: intrinsic | BR-038 | EXTENSIBLE runtime; STRUCTURAL revision lineage |
| CAP-056 | Package and Instance boundary | When an Instance exists, whether private or installed from a Package | Operate: typical; Distribute: intrinsic; Improve: typical; External/headless: typical; Internal factory: intrinsic | BR-005, BR-039, BR-047 | STRUCTURAL |
| CAP-057 | Upgrade safety and local overlays | When an installed Package/Release or local overlay can change | Distribute: intrinsic; Improve: typical; Internal factory: typical | BR-042, BR-043 | STRUCTURAL lineage and migration receipts |
| CAP-058 | Deterministic composition and collision semantics | When two or more Packages/modules contribute named capabilities | Distribute: intrinsic; Improve: typical; Internal factory: intrinsic | BR-041 | STRUCTURAL namespacing/resolution digest; EXTENSIBLE composition UX |
| CAP-059 | Multi-Agent delegation envelope and child-work isolation | When child Work/Runs or specialist/external Agents are delegated | Improve: typical; Internal factory: typical | BR-044 | STRUCTURAL parent/child/Grant/budget/output relations; EXTENSIBLE routing |
| CAP-060 | Multi-user collaboration | When more than one human or cross-Party collaborator participates | Operate: typical; Distribute: conditional; Improve: typical; Internal factory: typical | BR-045 | STRUCTURAL Actor on Work; EXTENSIBLE UX |
| CAP-061 | Multi-application composition | When more than one Package/application is composed or shares search/Attention/navigation | Distribute: typical; Internal factory: typical | BR-046 | STRUCTURAL namespacing; EXTENSIBLE shell |
| CAP-062 | Local-to-cloud portability | When local/hosted/dedicated/customer-controlled portability is claimed | Operate: typical; Distribute: typical; Improve: sovereign domains; External/headless: typical; Internal factory: typical | BR-047, BR-048 | STRUCTURAL identity independence |
| CAP-063 | Residency and export | When residency, sovereign operation, export, or provider substitution is claimed | Operate: typical; Distribute: typical; Improve: intrinsic; External/headless: typical; Internal factory: typical | BR-024, BR-047, BR-048 | STRUCTURAL policy metadata; EXTENSIBLE regions |
| CAP-064 | Localization | When a human Experience supports more than one locale/language/region | Operate: typical; Distribute: typical; Improve: typical; External/headless: typical; Internal factory: typical | BR-038 | PRODUCT / EXTENSIBLE |
| CAP-065 | Admission snapshot and append-only execution record | For every non-trivial admitted Run | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-011, BR-029 | STRUCTURAL |
| CAP-066 | Durable audit and support-access governance | Whenever consequential audit, support access, or compliance evidence is required | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-029, BR-050 | STRUCTURAL audit/identity/purpose; EXTENSIBLE tooling |
| CAP-067 | Privacy-safe observability and tracing | When traces, logs, metrics, profiles, or operational diagnostics are collected | Operate: typical; Distribute: typical; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-029, BR-050 | EXTENSIBLE signals correlated to STRUCTURAL identities |
| CAP-068 | Performance and context-efficiency contract | When performance, cost, freshness, latency, continuity, or quality is advertised or budgeted | Operate: typical; Distribute: typical; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-003, BR-053 | STRUCTURAL budget/limit/provenance facts; EXTENSIBLE planners/caches/routing |
| CAP-069 | Developer framework, CLI, and hosted deployment | When external developers build, test, package, deploy, or operate Boring products | Distribute: typical; External/headless: typical; Internal factory: intrinsic | BR-049 | STRUCTURAL Package/release contract; EXTENSIBLE CLI and hosting |
| CAP-070 | Orchestrator/worker code factory with review gates | When the internal or customer-visible orchestrator/worker factory pattern is used | Improve: typical; Internal factory: intrinsic | BR-035, BR-044, BR-049 | Reuses STRUCTURAL Work/Run/Artifact/Attention; EXTENSIBLE orchestration |
| CAP-071 | Usage and attention facts | When usage, attention, cost, reservation, or provider consumption is measured | Operate: typical; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-051, BR-052 | STRUCTURAL attribution |
| CAP-072 | Flexible pricing, billing, and settlement | When access, Work, Delivery, usage, service, or Outcomes map to money or settlement | Distribute: typical; Improve: conditional; External/headless: typical; Internal factory: typical | BR-052 | EXTENSIBLE commercial policy over STRUCTURAL usage facts |
| CAP-073 | Party ownership, payer, Publisher, provider, and liability roles | Whenever more than one business principal can own, act, pay, publish, provide, benefit, or bear liability | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-005, BR-052 | STRUCTURAL |
| CAP-074 | Authority decision/enforcement decomposition | For every governed Operation/Effect/Delivery/egress decision | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-011, BR-018 | STRUCTURAL |
| CAP-075 | Information-flow labels and derived-data inheritance | Whenever information is derived, cached, indexed, summarized, embedded, evaluated, or transferred | Operate: typical; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-023, BR-024 | STRUCTURAL |
| CAP-076 | Source-driver lifecycle, identity mapping, schema drift, fitness, and health | When a Source Connection/driver is used | Operate: typical; Distribute: typical; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-021, BR-022 | STRUCTURAL Source/Vintage/health lineage; EXTENSIBLE drivers |
| CAP-077 | Governed derived Projections, cache correctness, and defective-transform recovery | When a derived Projection, cache, search/vector index, materialized View, or prompt store exists | Operate: typical; Distribute: typical; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-023, BR-024 | STRUCTURAL transformation/policy lineage; EXTENSIBLE stores |
| CAP-078 | Source and semantic Vintage identification | When replay, citation, Evidence, comparison, freshness, or exact-state claims depend on Source/semantic state | Operate: typical; Distribute: typical; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-022 | STRUCTURAL when evidence/replay is claimed |
| CAP-079 | Package lineage / Package Version / Release / Deployment / Instance separation | When Package lineage is built, released, deployed, or installed into an Instance | Operate: typical; Distribute: intrinsic; Improve: typical; External/headless: typical; Internal factory: intrinsic | BR-039 | STRUCTURAL |
| CAP-080 | Release supply-chain provenance and attestations | When distributed or hosted Releases contain behaviorally relevant dependencies/content | Distribute: hosted distribution; Improve: typical; External/headless: typical; Internal factory: intrinsic | BR-040, BR-043 | STRUCTURAL manifest/provenance; EXTENSIBLE builders/scanners |
| CAP-081 | Upgrade three-way merge, migration, restore, and forward fix | When an active Instance is upgraded, migrated, restored, or forward-fixed | Distribute: intrinsic; Improve: typical; Internal factory: intrinsic | BR-042 | STRUCTURAL lineage/checkpoints/receipts; EXTENSIBLE migration tooling |
| CAP-082 | Semantic contract compatibility and versioned integration-event notifications | When external clients, generated clients, Packages, or events depend on compatibility | Operate: typical; Distribute: typical; Improve: typical; External/headless: intrinsic; Internal factory: intrinsic | BR-014, BR-037 | STRUCTURAL contract/notification versions; EXTENSIBLE transport |
| CAP-083 | Replay grades, safe no-effect replay, and terminal execution digest | When replay, counterfactual comparison, incident reconstruction, or terminal sealing is offered | Operate: typical; Distribute: typical; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-012, BR-029, BR-050 | STRUCTURAL grade/digest/Effect constraints; EXTENSIBLE tooling |
| CAP-084 | Canonical identities/references, record versions, signed commitments, and selective-disclosure receipts | When typed references, concurrency versions, digests, signatures, receipts, or external verification are used | Operate: intrinsic; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-010, BR-027, BR-040, BR-056 | STRUCTURAL |
| CAP-085 | Actual Model Invocation identity, alias/fallback drift, and provider data-use facts | Whenever a model provider call occurs | Operate: typical; Distribute: typical; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-020 | STRUCTURAL when models are used; EXTENSIBLE providers |
| CAP-086 | Secure update metadata, deterministic dependency resolution, and behavior-changing configuration lineage | When Releases/Deployments update through a registry, dependency resolver, or mutable configuration | Distribute: intrinsic; Improve: typical; External/headless: typical; Internal factory: intrinsic | BR-040, BR-043 | STRUCTURAL Release/Deployment trust; EXTENSIBLE registries/builders |
| CAP-087 | Admission scheduling, reservation, fairness, and backpressure | When Work is queued, concurrent, multi-tenant, delegated, capacity-limited, or deadline-bound | Operate: typical; Distribute: typical; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-011, BR-012, BR-051 | STRUCTURAL reservation/lease facts; EXTENSIBLE scheduler |
| CAP-088 | Staged rollout and scoped incumbents | When Improve or staged deployment claims are made | Distribute: typical; Improve: intrinsic; Internal factory: intrinsic | BR-034 | STRUCTURAL promotion scope |
| CAP-089 | Data lifecycle, Evidence withdrawal, and portable exit | When data/Evidence can be retained, corrected, withdrawn, exported, imported, moved, forked, or deleted | Operate: typical; Distribute: intrinsic; Improve: intrinsic; External/headless: typical; Internal factory: intrinsic | BR-024, BR-030, BR-031, BR-048 | STRUCTURAL labels/lineage; EXTENSIBLE export tools |
| CAP-090 | Verifiable Artifact and Delivery receipts | When an Artifact/result is delivered outside its producing context or independently verified | Operate: typical; Distribute: intrinsic; Improve: intrinsic; External/headless: intrinsic; Internal factory: intrinsic | BR-027, BR-028 | STRUCTURAL digest/provenance |
| CAP-091 | Marketplace and automated payouts | When marketplace listing, automated publisher economics, or payouts are offered | Distribute: conditional; External/headless: conditional | BR-052 | EXTENSIBLE commercial layer |

The matrix must not be read as an implementation sequence.

---
# 7. User-visible proof capabilities

The following features make the platform’s value understandable without exposing its architecture.

## 7.0 One trust surface across Plan, Progress, Proof, and Change

The product should present one coherent, access-controlled trust surface:

- **Plan — before execution:** goal, Sources, authority, proposed Operations/Effects, recipients, service class, estimate and tolerance, budget/attention/time, required approvals, and what data may leave the Instance;
- **Progress — during execution:** current stage, Source health/freshness, budget burn, blockers, child Work, partial/provisional Artifacts, fallback/degradation, cancellation state, and unknown Effects;
- **Proof — after execution:** exact Artifact/Delivery versions, citations, Agent/Package/Release, actual Model Invocations and kernels where permitted, Decisions, Effect/Delivery receipts, cost, replay grade, limitations, and later Outcomes;
- **Change impact — before activation:** added/removed Sources, Operations, authority, data-use/support/evaluation purposes, models/providers, regions, executable code, dependencies, configuration, migrations, recurring cost, regressions, and rollback/restore limits.

Primary action labels, recipients, amounts, diffs, risk/impact facts, and receipt status come from typed platform records. Model-authored explanation is secondary and visibly attributed. External proof uses selective disclosure so verification does not expose private Instance metadata or content beyond the recipient’s authority.

## 7.1 Named, costed, resumable Work

A user can leave “ACME renewal,” return on another device, see what happened, what remains blocked, how much it cost, and which outcomes later arrived.

## 7.2 Attention inbox instead of Agent babysitting

The user sees only what needs judgment, ranked by value, urgency, and risk. Every item opens exact context and can be answered from another approved channel.

## 7.3 Artifact with replay and explanation

A report, forecast, formulation, or draft shows:

- Sources and citations;
- Agent and Package revision;
- deterministic calculations;
- Operations and effects;
- human edits;
- cost and latency;
- ability to replay or compare.

## 7.4 Incumbent versus candidate everywhere

The user can compare two drafts, forecasts, formulations, Experiences, or Agent revisions; keep both; choose explicitly; and revert later.

## 7.5 Deterministic number with explanation

When a product presents a portfolio weight, nutritional result, forecast transformation, or constraint decision, the number comes from a versioned kernel and can be reproduced.

## 7.6 Unknown external effect that is visibly not retried

If an external provider response is ambiguous, the product shows “outcome unknown,” offers reconciliation, and never silently repeats the action.

## 7.7 Package capability passport and evaluation pack

A subscriber sees what a Package requests and what changed in a new version, including evaluation fixtures, known gains, regressions, authority, and expected cost.

## 7.8 Channel-first brief to delivered Artifact

A user or authorized external client can submit a bounded brief through Boring chat, WhatsApp, email, Slack/Teams, MCP, API, or another approved channel; receive questions and approvals without losing the Work; and obtain a durable Artifact with a delivery receipt. The same Work can move to a richer Boring Experience for review and later return to the original channel.

## 7.9 Declared continuity surface

The product shows its exact continuity surface by failure domain. A route-first application may retain authorized reads, deterministic calculations, selected writes, export, and safe Attention; an Agent-only job service may retain intake, status, prior Artifacts, export, and Effect reconciliation. Identity, policy, key, residency, or sensitive-data failure may visibly fail closed rather than impersonating availability.

## 7.10 Developer create-to-deploy path

A developer can scaffold an Agent or application with `npx boring create`, run and evaluate it locally, inspect its requested capabilities, deploy an immutable release with `npx boring deploy`, bind hosted Sources and secrets, observe Work and costs, and roll back without adopting a different hosted architecture.

## 7.11 Code factory review gate

An orchestrator delegates bounded child Work to worker Agents, workers produce code/test/release Artifacts, automated gates evaluate them, and only the items requiring judgment reach the human inbox with exact diffs, evidence, cost, and promotion choices. A deliberate failing fixture proves that the gate changes the decision; the worker’s own “tests passed” statement is never enough.

## 7.12 Stale approval that cannot execute

A user approves an exact email draft or deployment proposal. When the recipient, Artifact revision, effect, or cost changes, the old Approval visibly becomes invalid. A high-risk action started in WhatsApp requires step-up or an additional approver before execution.

## 7.13 Suspicious win that gets audited, not celebrated

When a candidate Agent, formulation, Experience, or code revision shows an implausibly large improvement, the product presents held-out results, comparison budgets, gate receipts, integrity checks, evaluator authorship, and candidate lineage before promotion is offered. “Too good to be true” becomes a review state.

## 7.14 Last-known-good service through failure

A refresh, semantic query, background job, Release, or Package upgrade fails. The user continues to see the prior validated result with a clear stale/failure marker, while recovery or rollback is offered. The candidate never silently displaces the incumbent.

## 7.15 Budget exhaustion that pauses instead of burning

A long-running job reaches its approved budget. The system checkpoints progress, preserves partial Artifacts and incurred cost, stops new usage, and asks the human whether to extend, narrow, deliver partially, or cancel. It never silently overspends or discards produced work.

## 7.16 Verifiable external Delivery

A job begins in WhatsApp or MCP and finishes outside the Boring UI. The recipient receives an audience-bound proof that reveals only the permitted Artifact commitment, issuer/Release/Agent claims, validation, Delivery time, and linked receipt facts—without exposing private Instance, Source, Run, or infrastructure metadata.

## 7.17 Revocation reaches derived data

A customer revokes or deletes a Source item. Search indexes, embeddings, caches, summaries, and stale generated Views derived from it are invalidated or policy-qualified. Historical evaluations identify that their Evidence set changed, and portable export produces a signed manifest without leaking secrets.

---

## 7.18 Job Contract and Delivery truth

The customer can inspect the exact accepted Job Contract Revision governing each Run, quote, deliverable, service obligation, Delivery, acceptance Decision, and charge. An amendment creates a new revision and never retroactively changes completed or active execution.

## 7.19 Message correction without historical rewrite

A provider edits or deletes a Message after Admission. The transcript reflects the provider event, but the original Run snapshot remains immutable. Pending Approvals are invalidated where material, affected Artifacts/Evidence are qualified, and a correction path is offered instead of silently rewriting history.

## 7.20 Effective Package and update-trust diff

Before install or upgrade, the subscriber sees the direct and transitive capability, data-use, model/runtime, region, support/evaluation, recurring-cost, executable-code, migration, and trust-root changes. Stale or rollback/freeze-suspect update metadata blocks activation rather than being hidden behind a valid artifact signature.

# 8. Representative capability bundles

Detailed product bundles are derived examples rather than normative capability claims. They have been moved to Appendix A.

# 9. Independent posture coordinates and Quality Claims

Boring must not imply that every axis is a ladder toward one ideal product. This section uses independent **posture coordinates**. Some coordinates are ordered capability/assurance states; others are categorical product forms. A higher number is not automatically commercially or ethically better.

The coordinates are:

- **E — Agent execution and initiative**;
- **L — Evidence, Outcomes, and learning**;
- **G — Governance and operational assurance**;
- **D — Distribution form**;
- **H — Human collaboration topology**;
- **M — Agent topology**;
- **X — Application composition**;
- **S — Sovereignty/deployment form**;
- **Q — declared Quality Claims**, recorded separately rather than compressed into a score.

Per-Operation autonomy, Advice/Action/Attestation, impact, time/causality, continuity surface, commercial model, and regulated status remain descriptors.

## 9.1 E — Agent execution and initiative

- **E0 — No Agent execution:** human/deterministic software only.
- **E1 — Assistive:** Agent observes or drafts under direct initiation; no autonomous consequential Effect.
- **E2 — Bounded governed action:** admitted Agent Runs may execute declared Operations under exact policy/Approval.
- **E3 — Event/schedule initiative:** Automations may admit bounded Work with rate, budget, Attention, and kill-switch controls.
- **E4 — Governed delegation:** child Work/Runs and specialist Agents operate under narrowing, deadlock/conflict controls, and measurable benefit.

## 9.2 L — Evidence, Outcomes, and learning

- **L0 — No learning claim:** outputs may be used without persistent Evidence-driven adaptation.
- **L1 — Local preference:** explicit user/Instance preferences and corrections; no shared improvement claim.
- **L2 — Typed Evidence:** Decisions, measurements, receipts, quality/cost, and failures join to Work/revisions.
- **L3 — Outcome-linked:** versioned Outcome Definitions, multi-causal attribution, corrections, and missingness are operable.
- **L4 — Protected comparison and promotion:** Objective Basis, assignment, held-out Evidence, adversarial evaluation, Promotion Plans, monitoring, and rollback/forward fix are operable.

## 9.3 G — Governance and operational assurance

- **G0 — Best effort:** no consequential autonomy or durable assurance claim.
- **G1 — Durable/inspectable:** Work, Run, Artifact, Usage, audit, recovery, and declared continuity exist.
- **G2 — Governed consequences:** Authentication Context, exact Authority/Approval, multidimensional Effects, idempotency/reconciliation, information flow, and Attention are operable.
- **G3 — Enterprise/sovereign:** federation, support sessions, retention/export, supply/update trust, SLO/Quality Claims, DR, and regional policy are tested.
- **G4 — High assurance/regulated:** impact-specific controls, separated duties/quorum, professional Attestation, load-bearing gates, incident/restore evidence, and domain oversight apply.

## 9.4 D — Distribution form

`private/internal`, `reusable within one organization`, `developer-hosted`, `Publisher/subscriber product`, and `public/machine distribution` are categories. They may coexist; they are not a maturity ladder.

## 9.5 H — Human collaboration topology

`single user`, `shared visibility`, `collaborative Work`, `cross-Party mandate`, and `regulated collaboration` are declared independently. The selected topology triggers membership, guest, revocation, quorum, and information-flow requirements.

## 9.6 M — Agent topology

`none`, `one primary Agent`, `bounded specialists`, `delegation graph`, and `cross-Party/external Agent` are categories. More Agents are not a higher score; M must be justified by value and control evidence.

## 9.7 X — Application composition

`one contribution`, `modules in one Package`, `several deterministically composed Packages`, `shared navigation/search/Attention`, and `cross-application Work` are categories with increasing composition obligations, not universal goals.

## 9.8 S — Sovereignty and deployment form

`provider-hosted`, `customer-owned data/export`, `regional policy/customer-held credentials`, `dedicated/customer-controlled`, and `multi-region/regulated` are contract forms. A product may choose one deliberately; each must make truthful continuity, exit, key, update-trust, and DR claims.

## 9.9 Example posture declarations

```text
mail product:          E2 / L2 / G3 / D=reusable-internal / H=collaborative / M=one / X=modules / S=regional
industrial optimizer: E2 / L4 / G4 / D=private / H=regulated / M=specialists / X=one / S=customer-controlled
creator Package:       E1 / L1 / G2 / D=publisher-product / H=shared / M=one / X=one / S=hosted-exportable
internal code factory: E4 / L4 / G3 / D=internal / H=collaborative / M=delegation-graph / X=multi-package / S=regional
```

## 9.10 Declared Quality Claims

Each advertised capability, Package/Release, Deployment, Work type, and service class declares applicable Quality Claims rather than inheriting one platform-wide promise. Claims may cover Admission/start/production/Delivery latency; continuity by failure domain; Source freshness/coverage; Effect reconciliation; RPO/RTO and restore verification; policy/entitlement staleness; revocation/deletion propagation; tenant isolation/noisy-neighbor; estimate accuracy; Attention budget; Usage correction; evaluation power/drift; and support-response limits.

Each claim has `QualityClaimId`, version, scope/cohort, target or explicit qualitative bound, measurement method/source, window/tolerance, owner, evidence/freshness, breach/remedy, exclusions, and withdrawal/supersession. A target that cannot be measured from authoritative or declared Evidence is not a Quality Claim.

# 10. Business validation, selection criteria, and falsification

## 10.1 Shared success conditions

### Value

- useful output;
- meaningful time saved;
- better decision or outcome;
- lower cost or increased throughput;
- access to expert capability;
- reduced human coordination burden.

### Trust

- private data remains private;
- authority is bounded and revocable;
- untrusted content cannot create authority;
- consequential effects are approved or policy-controlled;
- approvals bind exact proposals, invalidate on change, and support step-up or quorum where required;
- results have provenance;
- failures and unknown effects are visible;
- revisions are reversible;
- customers can export their data.

### Repeatability

- users complete repeated Work cycles;
- the value survives novelty;
- Work can be resumed and audited;
- failed refreshes and upgrades preserve an honest last-known-good result where policy permits;
- the next customer or Instance requires less custom engineering.

### Economics

- customers pay or an internal cost center explicitly funds the Work;
- the commercial model fits the vertical rather than forcing every offer into one universal billing unit;
- model, compute, external API, channel, and support costs are measurable;
- human attention is reduced rather than displaced into review;
- usage facts remain stable when pricing or payer policy changes;
- every billable usage fact has an admitted Execution and explicit payer/funding binding;
- payer, user, publisher, developer, platform, and provider cost responsibilities are distinguishable;
- gross margin can improve;
- publisher/subscriber/developer economics remain understandable;
- one customer or developer can be onboarded with less custom engineering than the previous one.

### Learning

- feedback joins to its originating Work and revision;
- preference and Outcome remain separate;
- comparison is statistically and causally honest enough for the decision;
- candidate and incumbent are compared under matched or explicitly normalized cost, latency, and human-attention budgets;
- held-out evidence and evaluators are protected from the Actors they judge;
- suspicious wins, evaluator tampering, weakened gates, and self-reported success are treated as integrity findings;
- rejected candidates and reasons remain available in the improvement archive;
- improvements do not rely on persuasive self-evaluation;
- customer evidence does not silently widen scope.

## 10.2 Metric definitions, time to value, repeatability, and operating quality

Before comparing products or cohorts, define:

- activation event;
- eligible and qualifying Work;
- first-cycle and second-cycle denominator;
- cohort entry and exclusion rules;
- natural return window for the domain;
- what counts as normal onboarding/support versus bespoke rescue;
- accepted Artifact and contract-closed Work;
- Source-health and Outcome-coverage requirements;
- treatment of cancelled, rejected, missing, corrected, or withdrawn data.

Report activation and first-cycle completion alongside second-cycle completion; otherwise a small or selectively defined denominator can make repeatability look healthier than it is.

Before repeatability, each product should measure the time from account/Instance creation or first Channel contact to:

- identity and entitlement resolution;
- first usable Source connection or accepted input;
- first admitted Work;
- **time to first produced Artifact**;
- **time to first delivered Artifact**;
- first accepted Artifact or observed customer Outcome;
- completion without bespoke builder intervention.

The cross-product repeatability metric remains **second-cycle completion rate**:

> The percentage of activated users or Instances that complete a second qualifying Work cycle within the domain’s natural return window, without bespoke rescue by the builder.

It is a leading indicator, not a universal value metric.

### Primary metric by business job

| Job | Candidate primary measures |
|---|---|
| **Operate** | Accepted or contract-closed Work per human hour; time/throughput saved; quality and rework. |
| **Distribute** | Subscriber activation and repeat value; publisher leverage; margin and support burden without publisher access to private data. |
| **Improve** | Outcome lift versus scoped incumbent at matched budgets, with guardrails and attribution confidence. |
| **Channel-first Job Delivery** | Time to first accepted Artifact; Delivery/revision success; cost and attention per accepted job. |
| **Developer platform** | Create-to-first-successful-Deployment time; Deployment and rollback success; support incidents per Release. |
| **Internal factory** | Lead time to approved Release; review attention; gate yield/integrity; rollback and escaped-defect rate. |

### Common guardrails

Supporting measures should include:

- quality, validation, revision, and rejection rates;
- Produced → Delivered → Accepted → Outcome-observed conversion;
- recovery, Effect reconciliation, and orphaned-Work rate;
- declared RPO/RTO and tested restore success where promised;
- Attention Items, Human Decisions, and minutes per accepted Work/Artifact;
- estimate/quote versus actual cost, latency, and attention;
- cost and gross margin per accepted or contract-closed Work;
- Source connection, freshness, completeness, drift, and reconciliation health;
- safety, policy, information-flow, gaming, and supply-chain incidents, plus detection time;
- retained use at the natural domain frequency;
- Release build, migration, upgrade, canary, rollback, restore, and forward-fix success;
- Outcome coverage, attribution confidence, correction, contest, and withdrawal rate;
- stale/last-known-good service rate and freshness disclosure.

A falling attention ratio at stable quality and Outcome is evidence that autonomy is saving work. A rising ratio indicates the product may be moving work into review rather than removing it.

## 10.3 Minimum demonstrable loop by job

### Operate

A user performs domain work in a purpose-built View. The Agent performs the same class of work through the shared domain Operation. The user reviews it through the attention plane, and later resumes the Work with full provenance.

### Distribute

A publisher creates a Package. A subscriber receives an isolated Instance, connects one private Source, obtains a useful Artifact, and can accept a publisher upgrade without the publisher gaining access to subscriber data.

### Improve

A candidate Artifact or revision is produced from evidence, evaluated against an incumbent under declared criteria, promoted by authorized decision, connected to a later Outcome, and rollback remains possible.

### Channel-first / external / headless

A user or authorized external client begins with a brief through chat, WhatsApp, email, Slack/Teams, MCP, API, or another approved channel; an immutable Job Contract Revision is accepted and bound to durable Work; questions and approvals can be answered across channels; a durable Artifact is delivered; and later Outcome remains linkable without exposing the customer’s full private context.

### Developer platform

A developer creates an Agent or application locally, runs the same Work and evaluation contracts used in hosting, deploys an immutable release through the CLI, binds hosted Sources and secrets, obtains a functioning Instance, observes traces and costs, and can roll back.

### Internal code factory

An orchestrator admits and decomposes Work, bounded worker Agents produce code or Package Artifacts, automated review gates evaluate them, human-required decisions land in the inbox, and only authorized approval may merge, release, deploy, or promote the candidate.

## 10.4 Criteria for a strong domain

This section does not select the first domain. It defines a useful scoring rubric.

| Criterion | Question | Discriminating bar for a first L4 proof |
|---|---|---|
| **Outcome latency** | How long between Agent work and a measurable result? | Days to a few weeks, not quarters. |
| **Outcome measurability** | Can the result be captured automatically or reliably? | Captured by a Source the product already reads—such as reply, conversion, data release, or test result—not dependent on routine manual entry. |
| **Decision frequency** | Are there enough repeated cycles to learn? | Several meaningful cycles per user or Instance within the validation window. |
| **Cost of error** | Can mistakes be caught, compensated, or safely approved? | Low enough to permit real use under approval rather than permanent suggest-only mode. |
| **Data accessibility** | Can the buyer connect useful Sources quickly? | Useful data connected in the first session or first assisted onboarding. |
| **Buyer proximity** | Does the person with the pain control the purchase? | The person or Party experiencing the pain can sign or directly cause the invoice. |
| **Value density** | Is a modest improvement economically meaningful? | A small improvement can justify the expected model, compute, support, and attention cost. |
| **Attention savings** | Does the product reduce human decisions or merely relocate them? | Attention ratio falls without degrading Outcome quality. |
| **Deterministic kernel availability** | Can critical calculations be grounded outside the LLM? | Required numerical or constraint claims have a testable non-LLM basis. |
| **Sovereignty advantage** | Is private hosting/governance a buying reason? | At least one buyer treats control, residency, or audit as material—not decorative. |
| **Regulatory load** | Does regulation create differentiation or prohibitive friction? | Governance is commercially differentiating while liability remains operable for the first product. |
| **Reference/distribution density** | Is there an expert, creator, or network that already reaches the users? | A credible path exists to a concentrated set of buyers without building a marketplace first. |
| **Customization repeatability** | Do customer variations look like overlays rather than bespoke rewrites? | Most differences can be expressed as configuration, Source bindings, definitions, or overlays. |

Score each criterion from 0–3: **0 fails, 1 weak, 2 adequate, 3 strong**. For a domain intended to prove L4, Outcome latency, Outcome measurability, and Buyer proximity are gates: a score of 0 on any one disqualifies the domain for that proof regardless of total. Keep candidate scores beside the open questions in §11 so the comparison visibly re-ranks as evidence changes.

A domain with slow or unobservable Outcomes may still be a strong E1–E3 or L0–L3 product. It is a weaker choice for proving L4.

### Stop/go gates for a first product or proof

A weighted score cannot compensate for a failed non-negotiable gate. Before committing the platform to a first domain, record `go`, `conditional`, or `stop` for:

- a named Work noun and repeatable customer-value cycle;
- an economically useful outcome or deliverable that is not merely “good conversation”;
- feasible Authority, liability, human-only acts, and consequential-Effect controls;
- accessible, lawfully usable Sources with adequate fitness and a credible first-session path;
- deterministic basis for purchased numerical/constraint claims;
- an honest continuity surface and support/recovery posture;
- attributable usage, payer, attention, and a plausible margin/financing model;
- demonstrated willingness to pay or committed internal funding, a plausible sales/procurement cycle, and a buyer who can authorize it;
- feasible integration/onboarding, data rights and licenses, support burden, and no dependency on bespoke rescue for every cycle;
- a route to buyers and second-cycle use without marketplace-scale dependency;
- containment of untrusted content and private Publisher/subscriber separation;
- for an L4 proof, measurable Outcome latency, assignment/evaluation integrity, and adequate sample opportunity.

Each gate record names evidence, owner, review date, decision date, and `go`/`conditional` expiry. A `stop` requires an explicit decision to change the target product claim, reduce impact/autonomy, select another domain, or accept the constraint as a non-goal. It must not be averaged away.

## 10.5 Conditions under which the thesis fails for a domain

Do not force a domain onto the platform when:

- meaningful work cannot be represented as domain Operations and remains only conversation;
- the Agent cannot perform meaningful work under any economically acceptable authority;
- outcomes cannot be observed even late or partially, yet the product is sold as self-improving;
- every token must be manually checked, so no attention is saved;
- deterministic calculations cannot be separated from model invention where correctness matters;
- untrusted content cannot be contained;
- the switching cost from generic ChatGPT plus documents is effectively zero because Boring holds no durable Work, Artifacts, authority, or operational integration;
- cost cannot be attributed to Work and unit economics cannot improve;
- subscriber and publisher data cannot be isolated;
- the product depends on a multi-app or marketplace ecosystem before one useful application exists;
- regulation makes the intended autonomous action legally or operationally impossible;
- evidence is too confounded to justify promotion, but the system promotes anyway.

These are product filters, not moral failures. Such a domain may still use ordinary chat or software. It should not shape the platform’s foundations.

## 10.6 Architecture acceptance through golden journeys and failure matrices

A STRUCTURAL requirement family should be exercised by at least two materially different golden journeys unless a documented mandatory trust/legal/privacy/billing/recovery boundary justifies a single specialized journey. Focused conformance tests complement rather than replace cross-journey pressure.

Minimum journeys:

1. **Route-first domain application** — declared continuity surface, human and Agent semantic parity including a human-only act, Work/Job Contract Revision, current Authentication Context, Artifact, Attention, Delivery, and Outcome.
2. **Bounded Channel-first job** — Message/Conversation/Thread separation, constrained Intake Run, private Source Projection, taint, step-up Approval, Effect Group/unknown reconciliation, per-destination Delivery, and later Outcome.
3. **Publisher Package lifecycle** — effective transitive capability/data-use diff, secure update metadata, isolated Instance, overlays/private data, mixed-version migration, active Runs, staged activation, rollback/restore/forward fix, EOL/export.
4. **Internal code factory** — delegation graph, shared-resource conflict, platform-recorded gates, human review, Release/Promotion Plan, canary monitoring, last-known-good.
5. **Evidence-driven comparison** — assignment integrity, stochastic routing facts, sequential/multiple-comparison rule, expert-panel protocol where applicable, exposure/consent/charging, Evidence withdrawal and recomputation.
6. **Cross-Party collaboration and exit** — explicit mandate, guest/member revocation cascade, controlled Delivery/export, support session, regional restore/import, and termination without historical erasure.

Every `BR` family maps to applicable `CAP` IDs, at least one focused positive conformance test, and negative/fault/exit tests where failure is meaningful. High-risk families—tenant/Party isolation, Authentication/Authority, Approval, fencing, multidimensional Effects, information flow/Transfer, update trust, evaluation, Promotion, audit integrity, DR, and commercial metering—require adversarial or mutation evidence.

The failure matrix covers, as applicable:

- duplicate/replayed Message, import, Admission, Invocation, Effect, Delivery, and callback;
- provider Message edit/delete after Admission and account reassignment;
- stale target/Approval/quorum/Authentication Context/obligation;
- fence loss, process death, incompatible checkpoint, history nondeterminism, active-Run upgrade;
- atomicity fault, outbox backlog/state loss, poison event, unsupported schema, correction/retraction;
- model alias/fallback/cache drift, stochastic variance, provider deprecation;
- Source drift, unversioned Vintage, partial sync, permission-filter leakage, revocation/deletion propagation;
- prompt injection, forged Instruction Envelope, archive/active-content attack, destination lookalike, unauthorized egress;
- partial Effect Group, Effect-unknown deadline, reconciliation/compensation failure;
- per-recipient Delivery failure, expired access, withdrawal outside control;
- evaluation leakage, repeated peeking, panel conflict/drift, assignment contamination, missing telemetry;
- dependency cycle/diamond/unavailable/revoked package, stale update metadata, rollback/freeze/mix-and-match attack;
- expand/contract migration failure, dry-run mismatch, destructive restore, forced security quarantine;
- delegation cycle/deadlock/contention/conflicting outputs and membership/guest revocation;
- DST/missed schedule, old-event replay under revoked authority, voice/API authentication failure;
- Usage double count/correction, quote expiry/material change, entitlement downgrade, billing dispute;
- region/control-plane/identity/policy/key outage, split brain, backup restore, provider/Boring disappearance.

The coverage manifest records requirement/capability version, applicability decision, owner, evidence, freshness, waiver and expiry, journey/test links, and unresolved `DEC` dependencies. An extension point is not stable until compatibility, duplicate, stale, failure, revocation, rollback, and exit behavior passes. These are forcing functions, not an implementation roadmap.

# 11. Business questions intentionally left open

1. **DEC-001** — Which job and domain become the first paid product?
2. **DEC-002** — What is the first named Work noun a customer will see?
3. **DEC-003** — Does the first buyer want a domain application, an expert Agent, or both?
4. **DEC-004** — Which output class is being sold: Advice, Action, or Attestation?
5. **DEC-005** — What meaningful Outcome can be observed within 30 days without pretending?
6. **DEC-006** — What is the promised human attention budget?
7. **DEC-007** — Which deterministic calculations must be outside the model?
8. **DEC-008** — Which Sources are necessary, and which data must explicitly not become a Source?
9. **DEC-009** — How expressive must declarative Views be before trusted code is required?
10. **DEC-010** — How much Agent identity and memory should persist across Instances?
11. **DEC-011** — Is subscriber-local personalization sufficient, or do buyers expect cross-product continuity?
12. **DEC-012** — Which subscriber evidence may be exported to a publisher, organization, or platform?
13. **DEC-013** — What evidence may improve a shared Package without revealing customer content?
14. **DEC-014** — Can an expert method be captured primarily from the publisher’s own Work rather than manual authoring?
15. **DEC-015** — Which external consumption door matters first: MCP, existing SaaS, email/chat channel, or API?
16. **DEC-016** — How much application-building autonomy should an Agent receive before human review?
17. **DEC-017** — Can Agent-generated declarative Experiences cover the first meaningful products?
18. **DEC-018** — When does specialist multi-Agent work outperform one well-configured Agent?
19. **DEC-019** — Which collaboration capability creates value before creating coordination overhead?
20. **DEC-020** — Does one Work context ever need to span several independently entitled Packages?
21. **DEC-021** — Is shared attention across applications sufficient before unified cross-app Work exists?
22. **DEC-022** — Which domains require Swiss residency rather than general European residency?
23. **DEC-023** — Which products create regulated advice or action, and who carries liability?
24. **DEC-024** — How should erasure affect evidence that contributed to an already-promoted revision?
25. **DEC-025** — How are publisher upgrades merged with subscriber overlays and data?
26. **DEC-026** — What remains usable when the model or remote runtime is unavailable?
27. **DEC-027** — Which outcome signals are robust enough for automated or policy-based promotion?
28. **DEC-028** — Is recursive improvement primarily customer value, an internal moat, or both?
29. **DEC-029** — What is the smallest useful Package capability passport?
30. **DEC-030** — Which usage facts are required before any billing model is selected?
31. **DEC-031** — Which channel should provide the first low-friction job experience: first-party chat, WhatsApp, email, Slack/Teams, MCP, or another channel?
32. **DEC-032** — What minimum accepted Job Contract Revision distinguishes sellable bounded Work from an open-ended conversation?
33. **DEC-033** — Which verticals are best priced by subscription, seat/Instance, job, delivered Artifact, usage, retainer, hosting, or outcome—and who is the payer in each?
34. **DEC-034** — Which parts of pricing, entitlement, billing, tax, collection, and settlement belong to Boring versus an external commercial provider?
35. **DEC-035** — Should the developer path optimize first for Boring-hosted deployment, self-hosted framework adoption, or equal support for both?
36. **DEC-036** — Which code-factory contracts from the current orchestrator/worker/review-inbox setup should become reusable platform capabilities, and which should remain internal process?
37. **DEC-037** — Which evaluation signals and fixtures must remain invisible to the Agents optimized against them, and who may refresh or rotate them?
38. **DEC-038** — What payer, funding, entitlement, and provider-credential context must be frozen at admission for each commercial model?
39. **DEC-039** — Which Effect dimensions and impact profiles require step-up, multi-party Approval, quorum, or four-eyes control?
40. **DEC-040** — What is the lifecycle and scope of an Objective Basis that compares many Work items without becoming mandatory for ordinary applications?
41. **DEC-041** — Which last-known-good results may be served stale, for how long, and which regulated or time-critical products must fail closed instead?
42. **DEC-042** — Which Package contribution collisions may be disabled, aliased, wrapped, or replaced, and which require operator trust or subscriber approval?
43. **DEC-043** — What content, if any, may support personnel access during incident response, and can ordinary metering/support remain entirely on the facts plane?
44. **DEC-044** — Before Part 2 becomes normative, how will its terminology be mapped explicitly to existing ratified repository decisions so no frozen concept is silently re-derived under a new name?
45. **DEC-045** — Which business Parties must be distinct in the first products: Instance owner, payer, Publisher, provider, and platform operator?
46. **DEC-046** — Which Sources can provide stable Vintages, and what claims are forbidden when a Source is unversioned?
47. **DEC-047** — Who may declassify or aggregate derived data so it can leave an Instance or improve a Package?
48. **DEC-048** — Which Outcome Definitions are stable enough for evaluation or billing, and how are historical comparisons handled after the definition changes?
49. **DEC-049** — Which external-effect Operations have reliable reconciliation, and which must always escalate Effect-unknown to a human?
50. **DEC-050** — Should `BSL` remain the public name of the analytical semantic engine, or only an implementation/repository label behind `semantic.*`?
51. **DEC-051** — Which legal/business roles must be represented explicitly per purpose and jurisdiction rather than inferred from Instance ownership or hosting?
52. **DEC-052** — What is the minimum delegation envelope and child-output validation required before multi-Agent work provides more value than one bounded Agent?
53. **DEC-053** — Which Source-health and data-fitness signals must be user-visible for each initial connector?
54. **DEC-054** — Which Release classes require reproducible builds, transparency references, or separate Publisher/builder/operator Attestations?
55. **DEC-055** — What queue, fairness, reservation, and backpressure behavior is required before multi-Agent or multi-tenant operation becomes credible?
56. **DEC-056** — What Package dependencies and kernels must be digest-pinned for reproducible Release behavior?
57. **DEC-057** — Which contracts and events require compatibility guarantees for developers and external clients?
58. **DEC-058** — What data and Evidence must remain exportable if Boring, a model provider, or a hosting provider disappears?
59. **DEC-059** — Does the accepted-work `RequestKey` already satisfy canonical Run identity semantics, or is a separate caller-idempotency binding required?
60. **DEC-060** — Which interactions remain Thread-only, when is draft Work created, and what exact Authority, payer, Source, and expiry envelope applies to an Intake Run?
61. **DEC-061** — What is the required relationship among Delivery intent, external Effect, provider receipt, platform Delivery receipt, and recipient acknowledgement for the first Channels?
62. **DEC-062** — Which actual Model Invocation facts are available from each provider, and which aliases or fallbacks make replay/evaluation claims weaker?
63. **DEC-063** — Which Execution Profiles and trust zones are required for the first sandboxes, connectors, browsers, renderers, kernels, and Package code?
64. **DEC-064** — What secure-update metadata, trust roots, revocation, rollback/freeze protection, and offline verification are required for each Release class?
65. **DEC-065** — Which Memory scopes may contain content authored at Publisher/platform scope, and how is cross-product user context kept user/Party-controlled without becoming subscriber-derived shared Memory?
66. **DEC-066** — Which Approval changes are material, how are displayed-estimate tolerances defined, and how is single-use Approval consumption made atomic with Effect authorization?
67. **DEC-067** — What control-plane/policy/identity outage behavior and maximum stale-lease exposure are permitted by each impact tier and sovereignty profile?
68. **DEC-068** — Which public, keyed, or selectively disclosed commitment format is used for each Artifact, Effect, Delivery, Release, and portable-export verification case?


## 11.1 Decision register

Open status is explicit rather than implied. Owners are accountable functions, not necessarily one named person; Part 2 or product governance must replace them with named owners and decision dates before the item blocks implementation.

| Decision | Status | Accountable owner | Current blocker / evidence target | Decision date | Ratified source |
|---|---|---|---|---|---|
| DEC-001 | open | Product + Architecture | Product discovery evidence | — | — |
| DEC-002 | open | Product + Architecture | Product discovery evidence | — | — |
| DEC-003 | open | Product + Architecture | Product discovery evidence | — | — |
| DEC-004 | open | Product + Architecture | Part 2 design and first-product evidence | — | — |
| DEC-005 | open | Data/Evaluation + Product | Part 2 design and first-product evidence | — | — |
| DEC-006 | open | Product + Architecture | Part 2 design and first-product evidence | — | — |
| DEC-007 | open | Product + Architecture | Part 2 design and first-product evidence | — | — |
| DEC-008 | open | Data/Evaluation + Product | Part 2 design and first-product evidence | — | — |
| DEC-009 | open | Product + Architecture | Part 2 design and first-product evidence | — | — |
| DEC-010 | open | Data/Evaluation + Product | Part 2 design and first-product evidence | — | — |
| DEC-011 | open | Product + Architecture | Product discovery evidence | — | — |
| DEC-012 | open | Legal/Privacy + Product | Part 2 design and first-product evidence | — | — |
| DEC-013 | open | Legal/Privacy + Product | Part 2 design and first-product evidence | — | — |
| DEC-014 | open | Product + Architecture | Part 2 design and first-product evidence | — | — |
| DEC-015 | open | Security/Runtime + Product | Product discovery evidence | — | — |
| DEC-016 | open | Product + Architecture | Part 2 design and first-product evidence | — | — |
| DEC-017 | open | Product + Architecture | Product discovery evidence | — | — |
| DEC-018 | open | Product + Architecture | Part 2 design and first-product evidence | — | — |
| DEC-019 | open | Product + Architecture | Part 2 design and first-product evidence | — | — |
| DEC-020 | open | Platform Architecture + Security | Part 2 design and first-product evidence | — | — |
| DEC-021 | open | Product + Architecture | Part 2 design and first-product evidence | — | — |
| DEC-022 | open | Legal/Privacy + Platform Architecture | Part 2 design and first-product evidence | — | — |
| DEC-023 | open | Legal/Privacy + Product | Jurisdiction/domain counsel | — | — |
| DEC-024 | open | Legal/Privacy + Data/Evaluation | Part 2 design and first-product evidence | — | — |
| DEC-025 | open | Platform Architecture + Product | Part 2 design and first-product evidence | — | — |
| DEC-026 | open | Platform Architecture + Product | Part 2 design and first-product evidence | — | — |
| DEC-027 | open | Data/Evaluation + Product | Part 2 design and first-product evidence | — | — |
| DEC-028 | open | Product + Architecture | Part 2 design and first-product evidence | — | — |
| DEC-029 | open | Platform Architecture + Security/Runtime + Product | Part 2 design and first-product evidence | — | — |
| DEC-030 | open | Commercial + Finance | Part 2 design and first-product evidence | — | — |
| DEC-031 | open | Product + Security/Runtime | Product discovery evidence | — | — |
| DEC-032 | open | Product + Commercial + Architecture | Part 2 design and first-product evidence | — | — |
| DEC-033 | open | Commercial + Finance | Product discovery evidence | — | — |
| DEC-034 | open | Commercial + Finance | Part 2 design and first-product evidence | — | — |
| DEC-035 | open | Developer Platform | Product discovery evidence | — | — |
| DEC-036 | open | Developer Platform + Product Architecture | Part 2 design and first-product evidence | — | — |
| DEC-037 | open | Data/Evaluation + Product | Part 2 design and first-product evidence | — | — |
| DEC-038 | open | Commercial + Finance + Security/Runtime | Part 2 design and first-product evidence | — | — |
| DEC-039 | open | Security/Runtime + Legal/Privacy + Product | Part 2 design and first-product evidence | — | — |
| DEC-040 | open | Data/Evaluation + Product Architecture | Part 2 design and first-product evidence | — | — |
| DEC-041 | open | Product + Legal/Privacy + Domain Assurance | Jurisdiction/domain counsel | — | — |
| DEC-042 | open | Platform Architecture + Security | Part 2 design and first-product evidence | — | — |
| DEC-043 | open | Security/Runtime + Legal/Privacy | Part 2 design and first-product evidence | — | — |
| DEC-044 | open | Product + Architecture | Repository/normative decision reconciliation | — | — |
| DEC-045 | open | Commercial + Finance + Legal/Privacy | Product discovery evidence | — | — |
| DEC-046 | open | Data/Evaluation + Product | Part 2 design and first-product evidence | — | — |
| DEC-047 | open | Legal/Privacy + Product | Part 2 design and first-product evidence | — | — |
| DEC-048 | open | Data/Evaluation + Commercial + Finance | Part 2 design and first-product evidence | — | — |
| DEC-049 | open | Security/Runtime + Product | Part 2 design and first-product evidence | — | — |
| DEC-050 | open | Product Architecture + Developer Platform | Part 2 design and first-product evidence | — | — |
| DEC-051 | open | Legal/Privacy + Product | Jurisdiction/domain counsel | — | — |
| DEC-052 | open | Security/Runtime + Product | Part 2 design and first-product evidence | — | — |
| DEC-053 | open | Data/Evaluation + Product | Part 2 design and first-product evidence | — | — |
| DEC-054 | open | Platform Architecture + Security | Part 2 design and first-product evidence | — | — |
| DEC-055 | open | Platform Architecture + Product | Part 2 design and first-product evidence | — | — |
| DEC-056 | open | Platform Architecture + Security | Part 2 design and first-product evidence | — | — |
| DEC-057 | open | Developer Platform | Part 2 design and first-product evidence | — | — |
| DEC-058 | open | Legal/Privacy + Platform Architecture | Part 2 design and first-product evidence | — | — |
| DEC-059 | open | Platform Architecture + Security/Runtime | Repository/normative decision reconciliation | — | — |
| DEC-060 | open | Product Architecture + Security/Runtime | Part 2 design and first-product evidence | — | — |
| DEC-061 | open | Platform Architecture + Security/Runtime + Product | Product discovery evidence | — | — |
| DEC-062 | open | Data/Evaluation + Product | Part 2 design and first-product evidence | — | — |
| DEC-063 | open | Platform Architecture + Security | Product discovery evidence | — | — |
| DEC-064 | open | Platform Architecture + Security | Part 2 design and first-product evidence | — | — |
| DEC-065 | open | Data/Evaluation + Legal/Privacy + Product | Part 2 design and first-product evidence | — | — |
| DEC-066 | open | Security/Runtime + Product | Part 2 design and first-product evidence | — | — |
| DEC-067 | open | Security/Runtime + Platform Architecture | Part 2 design and first-product evidence | — | — |
| DEC-068 | open | Security/Runtime + Platform Architecture | Part 2 design and first-product evidence | — | — |

A Decision changes status through `open → investigating → proposed → ratified | rejected | deferred | superseded`. Ratification records alternatives, rationale, evidence, affected BR/CAP IDs, compatibility/migration impact, owner, effective date, and superseded decisions. “Deferred” has a review trigger/date; it is not a silent permanent open state.

# 12. Capability handoff to Part 2

Part 2 should determine the smallest set of identities, boundaries, and relations required to satisfy this capability space.

It should not create one object per capability.

## 12.1 Candidate identity and durable-record budget

Part 2 must separate durable identities and lineages from lifecycle, policy, evidentiary, and transport records. A low noun count must not force independent state machines into overloaded rows; conversely, every term below does not automatically require a root aggregate.

### Core identities and lineages

Part 2 should cover the business space with roughly these durable identity families, or justify a merge/split:

1. **Party** and explicit Party Relationship/mandate — controlling, represented, paying, publishing, providing, benefiting, or bearing liability.
2. **Actor and stable Agent identity** — operational subject; Agent issuer/owner namespace and lineage remain distinct from behavior revision, Binding, model policy, Memory, and runtime.
3. **Instance** — isolated context with exactly one controlling Party and explicit participant relationships.
4. **Package lineage, Package Version, Release, and Deployment lineage** — publisher method, authored definition, verified closure, and environment rollout remain distinct.
5. **Source data lineage** — Source Connection, Resource, Item/external identity, and Projection lineage; Capability Provider invocation is separate.
6. **Operation / Domain Contract** — stable versioned domain semantics with compatibility, human-only acts, Effect dimensions, and policy obligations.
7. **Work** — durable customer-value lineage independent of Thread, Message, Job Contract Revision, Run, UI, and process.
8. **Artifact** — logical output identity with immutable content versions, component/derivation lineage, renditions, and external copies.
9. **Revision / scoped incumbent** — immutable proposed replacement and active selection; Objective Basis, Evaluator, Promotion Plan, and exposure attach when improvement exists.

### Durable lifecycle, policy, and evidentiary records or relations

Part 2 must preserve the independent semantics of:

- Binding/role, Party Relationship/mandate, membership/guest relation, and represented Party;
- Agent revision, scoped Memory, Agent/Instance binding, revocation/compromise/derive lineage;
- Channel Binding, Authentication Context, External Conversation, Message/version, Thread, and provider session;
- Job Contract Revision, Work lineage/facets, and deliverable contract;
- Admission Decision/snapshot and canonical Run;
- Attempt, Lease/fence epoch, checkpoint manifest, orchestration/history revision, and Model Invocation;
- Operation Invocation, Effect intent/member, Effect Group, dispatch attempt, observation, resolution, reconciliation, and compensation;
- Grant ceiling, policy/revision/decision, obligation instance/evidence, Approval/quorum, Delegation, credential use, and enforcement fact;
- Attention Item and typed Human Decision;
- Artifact version/component/citation/proof, Delivery intent/attempt/handoff/acknowledgement/withdrawal, and acceptance;
- Source Connection/Resource/Item mapping, Projection/dependency manifest, Vintage assurance, Source health, Transfer, policy composition, and propagation receipt;
- typed Evidence, Outcome Definition, Outcome/contributors, deduplication/adjudication/correction/withdrawal/recomputation;
- estimate, quote, reservation, Payer Binding, Usage Fact/correction/reversal, entitlement transition, pricing calculation, invoice/dispute, and settlement attribution;
- Package effective closure, capability/data-use diff, trust metadata, compiled composition, migration/checkpoint, Deployment/exposure/Promotion Plan, rollback/restore/forward fix, and last-known-good;
- domain event notification, inbox/outbox state, durable audit/correction/integrity evidence, support session, Quality Claim, and observability correlation.

Page, View, model, transport, mount, CLI command, scheduler, registry, billing provider, renderer, and other replaceable implementation concepts remain important capabilities or adapters but do not become universal business identities merely because they exist.

## 12.2 Structural relations Part 2 must preserve

- every Instance has exactly one controlling Party; other Parties participate through explicit relationships/mandates, and termination has defined effects on active Work, access, Delivery, and retained audit;
- Actor identity, Authentication Context, Channel Binding, represented Party/mandate, and Authority are distinct and all are recorded where consequential;
- Agent identity has issuer/owner namespace and fork/derive/transfer/revocation/compromise lineage independent of Agent revision and Instance binding;
- Job Contract Revisions are immutable; full Runs, quotes, service/Delivery obligations, acceptance, and delivery-based charges bind the exact accepted revision;
- Channel, External Conversation, Message/version, Thread, Work, and Run remain distinct; provider edits/deletes never rewrite admitted history;
- Source Connection, Resource, Item, Projection, Capability Provider, and Vintage assurance remain distinct; a remote executable service cannot bypass Operation/Effect rules by being called a Source;
- Operation kind and full Effect dimensions are separate; one Invocation may produce an immutable Effect Group with several member Effects and cumulative impact;
- Instruction Envelope, ordered Context Manifest, conservative Run taint, and value-level provenance remain reconstructable; authentication never turns narrative content into Authority;
- Artifact content version, rendition, external copy, selective proof, Delivery intent, dispatch Effect, handoff, acknowledgement, and acceptance remain separate;
- Promotion uses an immutable Promotion Plan whose monitoring, consent/charging, stop, state compatibility, rollback/restore/forward-fix, and last-known-good facts remain durable;

- every Instance, Package/Release, Source, and durable record has a controlling Party or explicit cross-Party relationship;
- every consequential Work, Human Decision, support action, Channel interaction, transfer, and Usage Fact names the acting Actor, represented Party, and Binding/role where applicable; legal controller/processor/fiduciary roles are declared rather than inferred;
- every Instance identifies the Package/Release lineage it installs—or an explicit private/unpackaged origin—and every Package identifies Publisher identity, signature, and version/fork/derive lineage;
- Actors act on behalf of Parties, and every consequential event names the Actor;
- Agent identity, immutable Agent revision, Instance/Seat binding, model policy, scoped Memory, runtime process, and actual Model Invocations remain distinct; every consequential Run records exact revision and binding, and every model call records the available actual provider facts;
- Work is the customer-value join and is distinct from Thread, Channel conversation, model-native session, Run, Attempt, and process placement; conversation may remain Thread-only, and draft Work exists only for a plausible customer-value unit;
- canonical Run identity and caller/request idempotency remain semantically distinct unless the ratified `RequestKey` contract demonstrably satisfies both sets of invariants;
- one Work may aggregate child Work, multiple Runs, Deliveries, Human Decisions, Artifact versions, and Outcomes; the graph is not a mandatory linear pipeline;
- Work control/fulfillment/budget facets, Run, Attempt, Lease/fence, Model Invocation, Operation Invocation, Effect/Effect Group, Delivery, acceptance Decision, and Outcome observation retain independent lifecycle semantics;
- a Thread-only conversation and constrained Intake Run may exist before full Work is contracted; the Intake Run has its own Admission and cannot silently widen into the later full Run;
- one admitted Run joins exact inputs, accepted Job Contract Revision where applicable, Actor, represented Party, Agent revision/binding, Authority, Payer Binding—including platform or Channel funding where applicable—Source/Vintage references, Context Manifest, Operation Invocations, Effects, cost, and produced Artifacts;
- each Attempt, worker Lease/fence, and actual Model Invocation remains distinct; one Attempt may renew a Lease and invoke several models/fallbacks; replacement uses a new Attempt and fence epoch;
- a failed Run does not automatically fail Work, and child Work, retries, and replacement workers preserve explicit causality and economics;
- the immutable Admission snapshot is distinct from the append-only execution record; replay declares its grade and defaults to no external Effect, customer write, duplicate Delivery, or duplicate charge;
- retries, resumes after process loss, and replacement workers are Attempts beneath the same Run and never overwrite prior Attempts; lease renewal may continue one Attempt, while replacement uses a new Attempt and higher fence token/epoch;
- every authoritative worker commit is fenced at the system-of-record boundary, while external Effects additionally use intent identity, provider idempotency, receipts, and reconciliation;
- every Artifact, Attention Item, Delivery, and Evidence record links to Work and, where execution-produced, to the producing Run;
- every model/tool/Agent-Source/sandbox/domain-Effect/customer-chargeable execution belongs to an admitted Run; constrained Intake Runs preserve this invariant without turning every conversation into Work, while minimum attributable ingress/security processing remains outside customer Work;
- provider credentials and payer/funding context are resolved per Run rather than through ambient process state or model input;
- each Source/Projection consumed by a Run is Vintage-identifiable where supported and explicitly marked unversioned where not;
- delegable acts share Domain Contract semantics across authorized humans, Agents, automations, and external clients while schemas, projections, assurance, limits, and capability subsets may differ; human-only acts remain explicit;
- Authority is host-issued and decomposable into ceilings/bindings, policy revisions, per-invocation decisions and obligations, typed Human Decisions, exact Approvals, narrowed delegation, credential use, and boundary enforcement;
- obligation fulfillment, break-glass, support dual identity, delegation parent/depth, and revocation cascade remain auditable;
- the Admission snapshot fixes a historical maximum ceiling, while sensitive policy, authority, obligations, credentials, record versions, budget, and state are revalidated immediately before an Effect commits; widening or payer change creates a new Run;
- single-use Approval consumption is atomic with authorization of the exact Effect intent;
- Source/tool/child-Agent content is data, not authority; conservative Run taint remains while value-level provenance and typed validation support sink-specific review without model-only declassification;
- causal provenance is distinct from information-flow permission;
- derived Projections carry all applicable ownership, sensitivity, audience, license, residency, purpose, model-use, support-use, retention, and revocation constraints from inputs; policy composition is multidimensional and incompatible combinations fail closed;
- an Actor’s self-report is a claim, while consequential execution facts originate from platform instrumentation, deterministic kernels, provider receipts, or authorized human Attestation;
- business audit is durable, attributable, access-controlled, exportable, and tamper-evident according to impact; traces, metrics, logs, and profiles do not replace it;
- Source, Knowledge, Memory, Evidence, and Operational Facts remain distinct in scope and purpose;
- filesystems are one Source/Projection kind, not the universal data model;
- Domain Contract is distinct from optional analytical semantics;
- deterministic kernels are versioned when used;
- Preference Evidence is distinct from real Outcome;
- Outcome Definitions are versioned and comparisons across materially different definitions are qualified;
- an Objective Basis may outlive and compare many Work items without becoming mandatory for ordinary Work;
- Evidence visible to an optimizing Actor is distinguishable from protected held-out Evidence used to judge it;
- a judged Actor cannot author, select, modify, schedule, or observe the Evaluator fixtures and held-out Evidence that decide its promotion;
- candidate archives retain rejected Revisions, evaluations, gaming findings, and reasons;
- Revisions are immutable and activated through durable scoped exposure and staged promotion; shadow paths create no customer Effect, write, Delivery, or charge;
- Package lineage, Package Version, Release, Deployment, Instance, and private customer data remain distinct;
- behaviorally relevant Package dependencies, kernels, Semantic Models, Evaluators, and migrations are pinned in a Release;
- Experience is a versioned projection over domain behavior, not the owner of it;
- each product exposes its declared model-independent continuity surface without a model call; identity, policy, key, Source, residency, and entitlement failures may narrow or fail closed according to the Quality Claim;
- deployment provider and shell implementation never define durable identity;
- Package and application contributions are namespaced and collide only through explicit deterministic reject/disable/alias/wrap/replace policy, never load order;
- the resolved composition is immutable and last-known-good remains active until a candidate passes validation;
- shared Work state is distinct from personal presentation state;
- a domain event is a versioned integration notification rather than audit truth or Authority; it supports correction/supersession/retraction and duplicate/reorder/replay handling;
- a Channel or external conversation links to Work but never becomes its durable identity;
- Channel Bindings may carry a baseline provider/account assurance classification, but each consequential Decision or Invocation binds the actual transaction-level Authentication Context; insufficient assurance requires step-up and a new context.
- produced output, delivered Artifact, and later successful Outcome remain distinguishable;
- Approval binds exact intent and becomes invalid after material change;
- single-use Approval consumption is atomic with final authorization of the exact Effect intent or Effect Group, or protected by a tested equivalent; authoritative UI fields—not model prose—define the target, recipient, amount, cumulative impact, Job Contract Revision, and policy obligations;
- external Effects preserve separate intent, Effect-group membership, dispatch attempts, observation, resolution, idempotency, reconciliation, and compensation facts; they declare reconciliation or unreconcilable behavior, and Effect-unknown is never blindly retried;
- Delivery may be backed by Effects, but provider receipts, authoritative Effect observation, platform Delivery receipt, handoff/access, recipient acknowledgement, withdrawal attempt, and acceptance Decision remain distinct;
- Attention timeout never auto-approves consequential Effects;
- budget exhaustion pauses Work and preserves partial results rather than silently continuing;
- last-known-good result and incumbent remain available after failed refresh, evaluation, composition, Release, or upgrade where policy permits;
- upgrades use preflight, three-way merge, migration receipts, staged activation, and an explicit rollback, restore, or forward-fix path;
- orchestrator, worker Agents, automated gates, and human reviewers use the same Work, Run, Artifact, Attention/Human Decision, Effect, Evidence, and promotion semantics;
- automated gates are load-bearing and platform-recorded; a gate whose removal changes no protected decision is an integrity defect;
- a developer Deployment produces an immutable Release and hosted Instance rather than a special ad hoc runtime identity;
- Usage Facts are distinct from entitlement, pricing, billing, collection, and settlement;
- Usage Fact estimates, reservations, actuals, corrections, and reversals remain duplicate-safe append-only facts; Entitlement suspension changes Admission without deleting Work identity or Level-0 history;
- isolation is enforced at every applicable database, object store, queue, cache, search/vector, sandbox, telemetry, support, backup/restore, and key boundary—not inferred from one column alone;
- cross-boundary movement is explicit, labeled, rechecked at egress, and auditable.

## 12.3 Extension points Part 2 should expose without multiplying the core

- Source and connector drivers, including cursor/backfill/freshness implementations;
- derived Projection, cache, index, and embedding implementations;
- deterministic domain kernels;
- analytical semantic engines, including the current `BSL` implementation;
- model providers and routers, actual Model Invocation adapters, runtime/Execution Profile providers, schedulers, queues, and lease/fencing implementations;
- View renderers and workbench hosts;
- versioned event transports and trigger providers;
- inbound/outbound Channel adapters and notification providers;
- Effect reconciliation providers;
- orchestrator/worker strategies and automated review gates;
- developer SDK/CLI, template, build, Release, Deployment, and hosting providers;
- Evaluator implementations, anti-gaming detectors, held-out-set rotation, and gate-efficacy methods;
- authentication step-up, quorum, approval-channel, and assurance providers;
- information-flow policy, declassification, retention, erasure, and export providers;
- entitlement, pricing, billing, tax, payment, and settlement providers;
- Package transports, registries, deterministic dependency resolvers, secure-update metadata, trust-root distribution, signing, provenance/SBOM, transparency, and vulnerability providers;
- region and residency implementations;
- external Agent protocols;
- collaboration and composition UX;
- Source-health, schema-drift, CDC/backfill, and data-quality adapters;
- performance/context planning, progressive discovery, routing, and cache implementations;
- Release builders, reproducibility attestations, transparency logs, and non-code component/license scanners;
- support-session, audit-integrity, and tamper-evidence implementations;
- delegation routers, envelope validators, and child-output validators.

## 12.4 Anti-proliferation rules for Part 2

1. A capability does not automatically deserve an object.
2. An extension adapter does not become a business identity.
3. A UI concept does not own domain data or authority.
4. A runtime placement does not own Work.
5. An Agent definition does not grant itself authority.
6. A semantic engine does not become the universal application model.
7. An optimization record does not become mandatory for ordinary software.
8. A marketplace concern does not redefine the Instance or Package boundary.
9. Multi-Agent, multi-user, and multi-app are cardinality and relation problems before they are new platforms.
10. A Channel adapter, developer CLI, billing plan, and code-factory orchestrator are clients or extensions of the same Work substrate, not parallel cores.
11. A pricing model must not become an execution identity or evidence schema; payer binding is a relation captured at admission, not a universal pricing object.
12. A facts plane must not become a second business object model; it is a content-minimized projection of admitted Work and Execution.
13. Objective Basis is optional improvement scope, not a required field on every Work item.
14. Approval Channels carry decisions but do not mint Authority or survive material proposal change.
15. Work, Thread, Run, Attempt, Operation Invocation, and Effect must not be collapsed merely to reduce the noun count.
16. Party and Actor must not be conflated; ownership/liability and operational identity are different.
17. Package, Release, Deployment, and Instance must not be conflated.
18. Causal provenance must not be treated as permission to export or reuse derived data.
19. Traces, metrics, and logs must not become the authoritative business audit.
20. A cache, index, embedding store, materialized View, or mount is a Projection, not a new Source of truth.
21. A universal event envelope does not imply universal event sourcing.
22. The final architecture should be explainable through a small diagram and a named end-to-end Work flow.
23. Publisher and Subscriber are Party roles, not new identity roots; a candidate is an Artifact with evaluation relations; and a method is a Revision of an Agent, workflow, policy, Evaluator, Semantic Model, Experience, kernel, or Package—not a separate platform object.
24. Attention Item and Human Decision must not be collapsed; one requests attention, the other records the typed response.
25. Evidence and Outcome must not be collapsed; an Outcome is a real-world observation under a versioned definition and supporting Evidence.
26. Estimate, quote/consent, reservation, Usage Fact, budget, price, invoice, and settlement must not be collapsed.
27. Package lineage, Package Version, Release, Deployment, and Instance must not be compressed into one mutable “app” record.
28. Evaluator definition, fixture custody, held-out Evidence, execution implementation, and promotion authority must not be collapsed.
29. Audit and observability must not be collapsed; tracing is an extension over durable business identities and facts, not the source of truth.
30. Caller idempotency, canonical Run identity, Effect idempotency, and Delivery-attempt idempotency must not be collapsed merely because one current protocol uses a shared field name.
31. Attempt and worker Lease/fence must not be collapsed; forensic execution history and revocable scheduling authority have different lifecycles.
32. One Attempt may contain several Model Invocations; model/provider routing is not Attempt identity.
33. Mutable record version/ETag must not be called a business Revision; concurrency control and immutable candidate lineage are different concepts.
34. Delivery and external Effect must not be collapsed; provider dispatch, confirmed Effect, recipient handoff, and acceptance are different facts.
35. An authenticated Instruction Envelope identifies its speaker and context but does not mint Authority or declassify Source content.
36. Publisher/platform learning must not use subscriber-derived mutable Memory as a shortcut around Evidence export, declassification, Knowledge, and immutable Revision paths.
37. A Release digest or signature must not be treated as a complete update-security system without trust-root, freshness, revocation, rollback/freeze, and dependency-resolution semantics.
38. Business Attestation, supply-chain/build attestation, and human attestation are typed contexts sharing an English word, not one interchangeable record or authority.
39. Binding is typed—Party/Actor role, Agent/Instance participation, Channel Binding, Source/credential, or Payer Binding—and one kind must not silently confer another. Authentication Context is evidence, not another generic Binding.

## 12.5 Capability set Part 2 must account for

Each `BR-xxx` entry is a stable requirement family. Part 2 may split it into finer invariants but must retain parent traceability, applicability, tests, owner, and unresolved `DEC` dependencies.

```text
BR-001 — Clause classes, feedback-corpus identity, stable IDs, manifest schema, waivers, supersession, and Decision governance.
BR-002 — Part 1 scope boundary and prohibition on physical topology, implementation sequence, MVP, or final naming decisions.
BR-003 — Declared continuity surface and failure-domain matrix with fail-closed safety and versioned Quality Claims.
BR-004 — Delegable semantic Operation parity plus explicit human-only/non-delegable acts.
BR-005 — Party/Actor separation, one controlling Party per Instance, explicit cross-Party mandate and liability context.
BR-006 — Stable Agent namespace/owner/subject plus fork, derive, transfer, revocation, compromise, revision, Binding, and runtime separation.
BR-007 — Versioned Job Contract Revision lifecycle and exact binding to Runs, quotes, service, Delivery, acceptance, and charges.
BR-008 — Work identity, orthogonal lifecycle facets, split/merge/fork/reopen/archive/duplicate lineage, and economics rollup.
BR-009 — Channel, Channel Binding, Authentication Context, External Conversation, Message, Thread, Work, and Run separation.
BR-010 — Layered idempotency for Message/event, import, Work intent, Admission, Invocation, Effect Group, Delivery, and callback.
BR-011 — Admission-first execution, bounded Intake Run envelope, immutable ceiling, current revalidation, and non-widening amendments.
BR-012 — Run/Attempt/Lease/fence/Model Invocation separation, monotonic fencing, checkpoints, and active history/version compatibility.
BR-013 — Atomic state/audit/outbox or tested equivalent, inbox/outbox recovery, correction, ordering, and declared read consistency.
BR-014 — Versioned Domain Contract, semantic compatibility, progressive discovery, generated clients, and explicit non-delegable acts.
BR-015 — Operation kind separated from complete multidimensional Effect declaration, autonomy ceiling, impact, and reversibility.
BR-016 — Effect and Effect Group intent, dispatch, observation, unknown closure, reconciliation, compensation, and cumulative impact.
BR-017 — Attention Item/Human Decision separation, deterministic ranking facts, unanswered policy, batch safety, and attention budgets.
BR-018 — Exact Approval digest/display, Authentication Context, atomic consumption, quorum, obligations, step-up, break-glass, and support.
BR-019 — Authenticated Instruction Envelope, ordered Context Manifest, conservative Run taint, value provenance, and sink validation.
BR-020 — Model policy, actual Model Invocation facts, fallback ladder, cache isolation, drift, stochastic replay and comparison.
BR-021 — Source Connection/Resource/Item and Capability Provider separation, identity mapping, health, drift, conflict, and revocation.
BR-022 — Vintage assurance grades, Source/semantic provenance, comparability, and explicit unversioned limitations.
BR-023 — Projection dependency manifest, pre-ranking permission filtering, policy inheritance, rebuild/quarantine, and propagation receipts.
BR-024 — Multidimensional information-flow composition, durable Transfer records, declassification validation, egress, and withdrawal/recall limits.
BR-025 — Execution Profiles, credential brokering, trust-zone isolation, governed egress, rendering/attachment safety, and runtime attestations.
BR-026 — Artifact type contracts, logical/version/rendition/copy separation, component manifests, branch/merge, validation, and policy.
BR-027 — Typed citations, audience-bound selective proof, canonical commitments, signatures, and privacy-safe verification.
BR-028 — Per-destination Delivery intent, dispatch Effect, observation, handoff/access, acknowledgement, acceptance, expiry, and withdrawal attempt.
BR-029 — Facts/content plane separation, versioned Operational/Usage facts, durable audit, privacy-safe observability, and corrections.
BR-030 — Typed Evidence assurance, producer/method/uncertainty, deduplication, adjudication, correction, withdrawal, and permitted purpose.
BR-031 — Versioned Outcome Definitions, multi-causal attribution, missingness, conflicts, recomputation, and comparison qualification.
BR-032 — Objective Basis, candidate dependency delta, assignment integrity, comparable budgets/Vintages, and stochastic controls.
BR-033 — Protected evaluators/fixtures, sequential and multiple-comparison rules, human-panel governance, anti-gaming, and evaluator drift.
BR-034 — Immutable Promotion Plan, scoped incumbent/exposure, consent/charging, monitoring/stop rules, rollback/restore/forward-fix feasibility.
BR-035 — Load-bearing gates, negative controls, mutation/adversarial evidence, platform-originated facts, and suspicious-win audit.
BR-036 — Automation Actor/rule, DST-safe schedule occurrence, event replay under current Authority, loop/deadlock/budget controls, and kill switches.
BR-037 — Versioned events/APIs/MCP/voice/Channel protocols, authentication, edit/delete, callback, destination, attachment, and cross-Channel continuity.
BR-038 — Versioned Experience Catalog, permission-aware bindings, synthetic/redacted preview, accessibility/localization, capability diff, and trusted-code lane.
BR-039 — Package/Package Version/Release/Deployment/Instance separation, immutable closure, direct/transitive capability and data-use passport.
BR-040 — Deterministic dependency resolution, behavior-changing configuration lineage, SBOM/component manifest, provenance, and update trust.
BR-041 — Deterministic contribution composition, namespace/collision policy, immutable compiled manifest, and last-known-good.
BR-042 — Upgrade preflight/three-way merge, expand-contract mixed versions, dry-run fidelity, active Runs, migration receipts, and EOL.
BR-043 — Security update/quarantine policy, re-consent, rollback/freeze/mix-and-match resistance, trust-root rotation, and offline verification.
BR-044 — Multi-Agent delegation graph, narrowing, cycles/deadlocks/contention/conflict, child completion, taint, cost, and fault containment.
BR-045 — Multi-user membership/guest lifecycle, revocation cascade, cross-Party collaboration, quorum eligibility, and historical audit.
BR-046 — Multi-application namespacing, entitlement, shared search/Attention, cross-app references, and unresolved unified Work choice.
BR-047 — Instance isolation across all substrates, residency, keys, local/dedicated/customer-controlled deployment, and provider substitution.
BR-048 — Scenario-specific DR/continuity, RPO/RTO, restore integrity, split-brain prevention, portable copy/move/fork/import, holds and erasure.
BR-049 — Developer manifest/lockfile, stable CLI/API schemas and exit codes, local/hosted parity, emulator, conformance, deploy/promotion/rollback.
BR-050 — Audit correction/tamper evidence/key custody, support-session lifecycle, kill switches, diagnostics, replay grades, and content access controls.
BR-051 — Usage Fact identity/lifecycle, reservations/actuals/corrections/reversals, deduplication, provider reconciliation, and economics attribution.
BR-052 — Payer Binding, quote-to-bill chain, entitlement transitions, pricing/billing/settlement separation, disputes, and suspension without deletion.
BR-053 — Independent posture coordinates and versioned Quality Claims rather than one maturity score or accidental service promise.
BR-054 — Capability matrix with stable CAP IDs, applicability triggers, dependencies, evidence freshness, omissions, waivers, and compatibility.
BR-055 — Architecture acceptance through multiple journeys, positive/negative/fault/exit tests, stop/go domain gates, and falsification.
BR-056 — Terminology reconciliation, anti-proliferation, reference flows, normative-source governance, and traceability to ratified repository decisions.
```

**Acceptance test for Part 2:** every applicable BR family maps to named identities/boundaries/lifecycles or explicit extension points, applicable CAP IDs, conformance and negative/fault tests, evidence, and an owner. An inapplicable family has a reason and review trigger; an open DEC is not silently treated as resolved.

## 12.6 Terminology and decision reconciliation

This mapping prevents Part 2 from re-deriving existing runtime decisions under adjacent names. It does not add new business objects.

The vocabulary table in §2.5 and the requirement families in §12.5 are canonical within Part 1. Other sections may add applicability, lifecycle, or proof detail but must not redefine the term incompatibly. A detected duplicate normative clause is consolidated or cross-referenced; it is not allowed to drift as a second source of truth.

| Part 1 term | Established/runtime interpretation |
|---|---|
| **Work** | Customer-value aggregate spanning Runs, Artifacts, Attention, Deliveries, acceptance, Outcomes, and rolled-up economics. It is not the canonical execution identifier. |
| **Execution / Run identity** | Canonical `RunId`, minted or resolved at Admission. The existing `RunId := RequestKey` mapping may remain only if the ratified `RequestKey` contract is host-resolved, immutable, non-reusable, deployment-independent, and suitable as the permanent Run identity. If `RequestKey` is caller-controlled, expiring, endpoint-scoped, or reusable, preserve a separate idempotency binding rather than conflating semantics. A Run is one admitted logical execution, not the whole customer Work item; an Intake Run may be Thread-linked without full Work, while a full Execution Run attaches to Work. |
| **Intake Run** | A separately admitted clarification execution attached to a Thread and optional draft/prospective Work before the accepted Job Contract Revision exists. It has narrow budget, context, Sources/Capability Providers, Authority, and Effect ceiling; it never silently inherits into a full Run. |
| **Attempt** | A concrete worker/runtime generation, process-loss resume, retry boundary, or replacement beneath the same admitted Run. Lease renewal may continue one Attempt; replacement uses a new Attempt. |
| **Worker claim / Lease / fence** | Revocable scheduling authority for an Attempt, with a fence token/epoch checked on authoritative commits. It is not Attempt or Run identity. |
| **Model Invocation** | One actual model/provider call beneath an Attempt. Several calls and models may occur in one Attempt; actual provider/deployment/alias, parameters, policy, cache/fallback, usage, and result facts are retained where available. |
| **Operation Invocation** | A governed call beneath a Run, carrying exact contract, input, Authority, policy, and concurrency context. |
| **Effect identity** | Stable `effectId` for one Effect intent, with separate Effect-group membership, dispatch attempts, observation, resolution, idempotency, receipts, reconciliation, and linked compensation. |
| **Delivery / Effect relationship** | Delivery is the business handoff of an exact Artifact/result to a consumer. It may use one or more Effects, but provider dispatch receipt, confirmed Effect, platform Delivery receipt, recipient acknowledgement, and acceptance remain distinct. |
| **Record version / Revision** | Record version or ETag is mutable-state concurrency control. **Revision** remains an immutable proposed replacement/incumbent lineage. The terms must not be interchanged. |
| **Agent binding** | The relation also called a **Seat** in existing direction work: participation, role, authority ceiling, budget, and local policy in an Instance. It grants participation but is not Agent identity. Whether `Seat` remains the final public/runtime name is an explicit naming decision; this review does not silently override the established mapping. |
| **Thread / External Conversation / Message / provider session** | Product-level durable history / provider-scoped conversation / versioned communication / provider-native runtime or transport session. Existing machinery may implement adapters, but none is Work or Run identity. |
| **compute / simulate** | A non-live-state refinement of `observe`. Authority policy may group them, while deterministic-kernel, evaluation, cost, and provenance policy may distinguish them. |
| **observe / compute-simulate / propose / mutate / external-effect** | Compatibility/policy shorthand projected from Operation kind plus declared Effect dimensions. The multidimensional Effect set is canonical when one Invocation combines mutation, disclosure, Delivery, financial, administrative, coordination, or external consequences. |
| **delegation** | A governed coordination Operation that admits child Work/Run under narrowed Authority and bounded budget; it need not become a universal Source Effect dimension. |
| **Payer Binding** | An Admission snapshot/relation attached to the canonical Run, not a second execution identity or a pricing object. |
| **Objective Basis** | A versioned comparison basis reused across candidate and evaluation Work. It is optional improvement scope rather than a mandatory field on every Work item. |
| **Vintage** | Source/Projection snapshot, commit, release, cursor, as-of timestamp, or digest recorded for replay and comparison; `unversioned` is explicit when unavailable. |
| **Package / Package Version / Release / Deployment / Instance** | Publisher-owned lineage / immutable authored definition / policy-verified immutable deployable / environment-and-rollout binding / durable Party-owned application context. |
| **Party / Actor** | Business owner/payer/Publisher/provider/liability holder / operational identity acting on a Party’s behalf. |
| **Admission snapshot / execution record / audit / observability** | Immutable intended context / append-only actual history / durable authoritative decisions and Effects / sampled operational signals. None may silently substitute for another. |
| **Authentication Context / Channel Binding / Actor / Authority** | How the Actor proved identity for a transaction / external-account mapping / durable operational identity / what that Actor may do. None substitutes for another. |
| **Job Contract Revision / Work / Run** | Immutable bounded-work agreement / durable customer-value lineage / one admitted logical execution bound to an exact accepted revision when applicable. |
| **Source Connection / Resource / Item / Projection / Capability Provider** | Provider-account binding / collection / addressable data / derived authorized representation / executable service. |
| **Operation kind / Effect dimensions / Effect Group** | Semantic act shape / all possible consequences / stable grouped intent with membership and cumulative semantics. |
| **Instruction Envelope / Context Manifest / taint** | Authenticated directive / exact ordered context supplied / conservative provenance-risk state. Authentication does not erase taint or create Authority. |
| **Artifact version / rendition / external copy / Delivery** | Immutable content / rendering / foreign duplicate / business handoff lifecycle. |
| **Promotion Plan / Deployment rollout** | Governed candidate exposure/monitoring decision / environment-specific activation mechanism. |
| **Quality Claim / metric / SLO** | Versioned relied-upon promise / observation / one possible operational objective implementing the promise. |


Any future document that introduces a second canonical Run identifier, a second Agent-to-Instance participation object, a second semantic-query contract, a second contribution-collision mechanism, or a second business audit path must explicitly reconcile and delete the predecessor rather than coexist indefinitely.

Where this mapping conflicts with an actually ratified normative document, the owner must rule explicitly and update this table. Review summaries are Evidence for reconciliation, not substitutes for the normative source.

## 12.7 Reference end-to-end Work flow for validating Part 2

One flow cannot prove this option space. Part 2 must trace the following without parallel object models.

### Flow A — route-first application and human-only act

1. A human enters through a strong Authentication Context, opens Work under an accepted Job Contract Revision, and uses a normal Page/View.
2. The Agent receives a permission-filtered Context Manifest and invokes the same delegable Operation semantics.
3. A professional signature remains explicitly human-only; the Agent prepares evidence but cannot perform the Attestation.
4. A Source outage activates the declared continuity surface; identity/policy failure visibly fails closed.
5. Produced Artifact, per-destination Delivery, acceptance, Usage, and later Outcome remain separate and attributable.

### Flow B — Channel-first bounded job

1. A provider Message version enters an External Conversation through a Channel Binding and is deduplicated/scanned without becoming Work automatically.
2. A constrained Intake Run clarifies under bounded funding/Source/tool/retention rules; an immutable Job Contract Revision is accepted and a full Run admitted.
3. Attempts use fenced Leases, checkpoint manifests, actual Model Invocations, Source Resource/Item Projections and Vintage assurance; Run taint persists across replacement.
4. One Invocation creates a multi-member Effect Group. Typed Approval with step-up/quorum is atomically consumed; partial provider response becomes owner/deadline-bound Effect-unknown and is reconciled.
5. Delivery facts remain separate from dispatch and acknowledgement; a later Message edit qualifies Evidence but never rewrites the Run.

### Flow C — Package upgrade and sovereign recovery

1. A Publisher creates Package Version and Release; resolver computes transitive capability/data-use closure and verifies secure-update metadata.
2. Subscriber overlays/private data are preflighted; an expand-contract migration supports old/new clients and active Runs under a mixed-version window.
3. Canary Promotion Plan monitors exact Quality Claims. A bad migration halts; rollback feasibility is checked against written state and restore/forward fix is selected honestly.
4. A regional/control-plane failure executes the scenario-specific continuity/DR plan, verifies keys/policy/audit/erasure ledger, and preserves Instance identity or records explicit remapping on import.
5. EOL/export never gives Publisher read-back access or deletes subscriber Work.

### Flow D — internal factory and protected improvement

1. Orchestrator creates child Work through a narrowing delegation graph; cycle/deadlock/contention and shared-record conflict are detected.
2. Workers produce Artifact components; platform-originated tests/gates and expert panel protocol generate typed Evidence.
3. Assignment, repeated looks, model/cache/runtime differences, cost/attention, and held-out exposure are recorded.
4. An immutable Promotion Plan controls canary, consent/charging, monitoring, stop, rollback/forward fix, and last-known-good.
5. Evidence correction/withdrawal triggers recomputation and qualification without deleting the original decision history.

### Flow E — cross-Party collaborator, support, and commercial dispute

1. A mandate and guest membership allow a collaborator limited Work/Artifact access; revocation cascades to sessions, links, delegation, quorum eligibility, and future search.
2. A support session receives separate Approval and Authentication Context, accesses minimum facts/content, exports a redacted diagnostic, expires, and is post-reviewed.
3. Usage estimates, reservation, provider actual, correction, quote, accepted Job Contract Revision, Delivery, invoice, and dispute remain a traceable chain.
4. Cancellation/suspension preserves lawful data, continuity/export, audit, and reactivation rules.

A candidate Part 2 fails if it cannot express these flows while preserving BR-001–BR-056 and the anti-proliferation rules.

# Appendix A — Representative capability bundles

These bundles are examples, not separate architectures.

## A.1 Creator Studio

```text
Operate domain work
+ domain navigation and Views
+ ambient Agent
+ content and document Artifacts
+ analytics Sources
+ optional semantic measures
+ publishing Operations
+ outcome capture
+ evidence-aware improvement
```

## A.2 Creator’s Personal Agent

```text
Distribute expert capability
+ expert knowledge and method
+ subscriber-private Sources
+ chat or small Experience
+ Artifact history
+ scoped personalization
+ Package / Instance boundary
+ subscription or entitlement later
```

## A.3 Creator-Published SaaS

```text
Operate
+ Distribute
+ brand and Experience
+ isolated subscriber Instances
+ subscriber-owned data
+ Package upgrades
+ local overlays
+ optional adaptive loop
```

## A.4 Macro Research Terminal

```text
Operate
+ public/private time-series Sources
+ Domain Contract
+ analytical semantic engine
+ deterministic transformations
+ charts and research Artifacts
+ data vintages
+ forecast Outcomes
+ incumbent comparison
```

## A.5 Investment Workbench

```text
Operate
+ private/public research Sources
+ company and portfolio semantics
+ deterministic risk and portfolio kernel
+ thesis Artifacts
+ Advice / Attestation distinction
+ approvals
+ portfolio Outcomes
+ optional specialist Agents
+ sovereign deployment
```

## A.6 Industrial Formulation

```text
Operate
+ Improve
+ proprietary Sources
+ ingredient/cost/constraint semantics
+ deterministic formulation kernel
+ candidate Artifacts
+ simulation and lab workflow
+ expert approval
+ delayed Outcomes
+ controlled method improvement
```

## A.7 SME Pipeline Recovery

```text
Operate
+ CRM/import Source
+ mail context
+ account and pipeline Views
+ stale-opportunity event triggers
+ follow-up drafts
+ human approval
+ reply and pipeline Outcomes
+ later Agent revision comparison
```

## A.8 Boring Internal Code Factory

```text
Operate internal product development
+ orchestrator Agent
+ bounded worker-Agent child Work
+ isolated branches/worktrees/sandboxes and narrowed Sources
+ code/declarative candidate Artifacts
+ tests, CI, security, and evaluation gates
+ review-gated Attention Items in the human inbox
+ cost and attention budgets
+ bounded acquisition experiments
+ human merge, release, deploy, and promotion decisions
+ package and Experience revision
+ production and commercial evidence returned to the next cycle
```

## A.9 Channel-First Agent Job Service

```text
accepted Job Contract Revision
+ first-party chat / WhatsApp / email / Slack/Teams / voice / MCP / API intake
+ identity and entitlement resolution
+ secure attachment and Source connection
+ asynchronous Agent Work
+ questions and approvals through Attention
+ durable Artifact delivery
+ acceptance / revision / rejection
+ per-job, subscription, retainer, usage, or hybrid commercial model
+ optional later Outcome
```

## A.10 Developer Platform and Hosted Agent Application

```text
npx boring create
+ local Agent/app development
+ Operations, Sources, Views, and evaluation fixtures
+ npx boring dev / test
+ capability passport and deploy preview
+ npx boring deploy
+ hosted Instance, secrets, region, logs, budgets, and rollback
+ platform subscription or hosting/usage model
+ later Package publishing and distribution
```

---

