# Part 1 — Business Use Cases and Required Platform Capabilities

**Status:** Draft for validation
**Purpose:** Define the business option space and the capabilities the platform must be able to support.
**Out of scope for this section:** implementation sequencing, package boundaries, database schemas, class/interface design, migration order, and MVP versus post-MVP decisions.

> Transcription note (2026-08-17): captured from the author's plaintext draft.
> Capability matrices were reconstructed as markdown tables from the linearized
> paste; verify ratings against the source of truth if one exists.
> Review with proposed revisions: [PART-1-REVIEW.md](PART-1-REVIEW.md).

## 1. Why this section exists

Boring may evolve in several directions:

- a purpose-built SaaS application with an Agent operating underneath;
- a personal or expert Agent distributed to an audience;
- a creator-published application;
- a research terminal;
- an industrial or scientific optimization system;
- a multi-Agent or collaborative environment;
- a platform that can help build, customize, distribute, evaluate, and improve its own applications;
- eventually, a sovereign European application and Agent cloud.

These directions overlap heavily.

A creator studio, a macro research terminal, an investment workbench, an SME pipeline product, and an industrial formulation system can all share the same fundamental capabilities even though their users, interfaces, data, and commercial models differ.

The goal of this section is therefore not to define one final product category. It is to answer:

- What are the fundamental families of business use cases?
- What can the users of each family do?
- What platform capabilities are required to support them?
- Which capabilities are shared across several families?
- Which dimensions may evolve independently over time?
- Which business possibilities must the future architecture preserve?

The architectural objects and interfaces required to provide these capabilities will be defined in Part 2.

## 2. Core business thesis

Boring should enable people to build and operate agent-native applications.

An agent-native application:

- feels like normal purpose-built software to a human;
- lets an authorized Agent perform the same meaningful domain work as the human;
- keeps data, authority, history, outcomes, and improvement logic under the application owner's control;
- can start with one user, one Agent, and one simple application;
- can later support more Agents, collaborators, data systems, application modules, and distribution channels;
- can collect evidence from real usage;
- can become adaptive or recursively improved without requiring a different platform.

The visible product may be: a creator studio, a CRM, a mail client, a macro research terminal, an investment workbench, an industrial formulation product, a clinic operations product, a dashboard, a document system, a chat-first expert Agent, or a headless Agent service.

The common capability is not a particular shell or layout. The common capability is:

> Humans and Agents can use governed data and operations to perform durable work, produce useful outputs, receive feedback, and — where appropriate — improve the application, the Agent, or the domain result.

## 3. Three core use-case families

The business opportunity can be condensed into three overlapping use-case families.

### 3.1 Use Case A — Agent-Native Domain Software

**Business statement**

> I want to build a purpose-built application for an individual or organization, where users can perform their normal work through a familiar SaaS interface, while an authorized Agent can perform the same meaningful actions, create useful outputs, and optionally learn from usage and real outcomes.

**Representative products:** creator studio; CRM; mail client; SME pipeline and follow-up application; investment research application; macro research terminal; document and knowledge system; clinic operations application; portfolio workbench; industrial operations interface; content calendar; planning and scheduling product; analytics product.

**Primary customer types:** individual professional; creator; analyst; consultant; SME owner or team; research group; operating team; enterprise department; regulated organization.

**What the user can do**

The user can:

- navigate through domain-specific pages and records;
- create, inspect, update, and organize domain data;
- work with files, documents, dashboards, messages, tasks, and records;
- ask the Agent to act on the current context;
- let the Agent perform any domain action for which it has authority;
- review, edit, approve, reject, or defer Agent work;
- resume previous pieces of work;
- see what was done, by whom, and why;
- connect private and public data;
- optionally measure the real-world result of the work;
- optionally allow the system to improve from repeated usage.

**What the product should feel like**

The default experience should be a normal domain application:

```
Navigation
    ↓
Domain pages and Views
    ↓
Records, documents, dashboards, actions
    ↓
Ambient Agent assistance
```

The Agent may appear through: a small composer; inline suggestions; "things needing attention"; approval cards; generated reports or drafts; automated background work; an optional drawer; a dedicated chat or research page when useful.

Chat is available, but chat is not necessarily the product.

**Examples**

*Creator Studio* — `Today · Ideas · Research · Content · Calendar · Analytics`

The Agent may: identify opportunities; research topics; draft content; update a content plan; analyze performance; suggest the next experiment.

*SME Pipeline Tool* — `Accounts · Pipeline · Tasks · Follow-ups · Reports`

The Agent may: identify stale opportunities; summarize account context; draft follow-ups; prioritize the weekly queue; update records after approval.

*Macro Research Terminal* — `Research · Indicators · Scenarios · Forecasts · Reports`

The Agent may: query time series; compare regimes; create charts; test hypotheses; produce a research report; track forecasts against later data.

*Industrial Formulation Interface* — `Ingredients · Suppliers · Formulations · Experiments · Results · Production`

The Agent may: compare ingredient substitutions; identify cost reductions; check constraints; propose a formulation; prepare an experiment; interpret test results.

**Business value**

This family sells outcomes such as: time saved; better decisions; higher throughput; more consistent work; access to expertise; fewer missed opportunities; better analysis; safer execution; improved business metrics.

**Possible commercial models:** recurring SaaS subscription; per-seat subscription; usage-based pricing; private deployment; design-partner pilot; enterprise contract; value-based or outcome-linked pricing in selected domains.

### 3.2 Use Case B — Distributed Personal or Expert Agent

**Business statement**

> I want to package an expert's Agent, methodology, knowledge, workflows, and tools so other people can use them with their own private context, without the expert manually serving every user.

**Representative products:** a creator's content strategy Agent; a macro analyst's research Agent; a consultant's SME diagnostic Agent; a real-estate expert's analysis Agent; an investment expert's company research Agent; a sales expert's pipeline Agent; a personal CFO Agent; a course creator's methodology Agent; an industry expert's technical review Agent.

**Primary customer types**

*Publisher:* creator; consultant; analyst; coach; educator; domain expert; specialist firm; software company.

*Subscriber:* individual follower; customer; professional; team; another Agent or application in the future.

**What the publisher can do**

The publisher can potentially: define the Agent's methodology; provide knowledge, instructions, examples, and skills; provide specialized tools or operations; provide a minimal or rich application interface; define default workflows; define optional semantic models and evaluators; define the brand and product promise; release improved versions over time; learn from explicitly permitted product-level evidence; distribute the Agent to an existing audience.

**What the subscriber can do**

The subscriber can: use the expert Agent; connect their own private data; maintain private conversations and work history; receive reports, plans, drafts, recommendations, and analyses; inspect and approve consequential actions; use specialized pages or tools supplied by the publisher; personalize the Agent or experience locally; retain ownership of their private data and outcomes; potentially connect the Agent to other applications; potentially expose selected capabilities to their own team.

**Possible product shapes**

*Chat-first expert Agent:*

```
Expert Agent
Conversation
Artifacts
History
Sources
```

*Small purpose-built application:*

```
Today
Recommendations
Reports
History
────────────────
Ask Sarah…
```

*Full creator-published SaaS:*

```
Domain navigation
Pages and dashboards
Expert Agent underneath
Subscriber-owned data
```

*Embedded or headless Agent:*

```
Existing application
    ↓
Expert Agent capability
    ↓
Structured result or Artifact
```

**Important ownership boundary**

The product must distinguish:

```
Publisher-owned:                 Subscriber-owned:
- methodology                    - connected data
- Agent definition               - credentials
- packaged knowledge             - Threads and history
- default workflows              - prompts
- default Views                  - Artifacts
- product branding               - local preferences
- package lineage                - local customizations
                                 - private outcomes
```

Subscriber data should not automatically become publisher or platform training data. Any reuse of subscriber evidence must be explicit, governed, and privacy-preserving.

**Business value**

This family turns expertise into repeatable software.

The publisher gains: recurring revenue; leverage beyond one-to-one service; productized methodology; distribution to an existing audience; a channel for improving the methodology.

The subscriber gains: access to expert methods; lower cost than personal consulting; persistent context; a product adapted to their own data; repeatable delivery.

**Possible commercial models:** monthly subscription; annual subscription; usage credits; premium tier with more Sources or usage; team subscription; bundled course or membership; API or Agent-access subscription; platform revenue share in the future.

**Relationship to full application publishing**

A creator-published full SaaS application is not a separate foundational family. It is an advanced distribution form combining:

```
Agent-Native Domain Software
+ Distributed Expert Agent
+ Versioned Application Experience
+ Subscriber Isolation
+ Commercial Entitlement
```

### 3.3 Use Case C — Recursive Research and Optimization System

**Business statement**

> I want to build a governed system for domain experts, where humans and Agents use private and public evidence to generate alternatives, evaluate them, observe what actually happens, and recursively improve both the proposed solutions and the method that produces them.

**Representative domains:** portfolio construction; investment research; macroeconomic forecasting; industrial food formulation; factory scheduling; supplier allocation; logistics; pricing; SME go-to-market; marketing; creator growth; clinic operations; educational planning; energy optimization; scientific research; organizational planning; city and transport planning.

**Primary customer types:** domain expert; researcher; analyst; scientist; industrial R&D team; operating team; fund manager; consultant; executive team; public institution; regulated organization.

**What the user can do**

The user can:

- attach proprietary and public data;
- describe a goal, problem, hypothesis, or desired result;
- express hard constraints;
- express soft preferences and expert judgement;
- ask an Agent to explore alternatives;
- generate one or several candidate solutions;
- compare trade-offs;
- run deterministic calculations;
- run simulations or external tools;
- review and modify candidates;
- record approval, rejection, and expert reasoning;
- execute or test a candidate;
- record real-world measurements;
- compare expected and actual results;
- improve the next candidate from accumulated evidence;
- improve the Agent or method itself;
- preserve full provenance and reversibility.

**The generic loop**

```
Data and evidence
      ↓
Human objective, problem, or hypothesis
      ↓
Agent exploration
      ↓
Candidate output
      ↓
Evaluation, simulation, or expert review
      ↓
Decision
      ↓
Real-world test or deployment
      ↓
Outcome
      ↓
Evidence
      ↓
Improved candidate or method
      ↻
```

**Examples**

*Portfolio Process* — the system may help: define an investment universe; collect public and private company information; mirror analyst intuition; create investment theses; generate candidate portfolios; evaluate risk, concentration, and liquidity; compare assumptions with outcomes; improve research and portfolio-construction methods.

*Macro Analysis* — the system may help: query economic time series; create transformations; form hypotheses; create forecasts and scenarios; track data vintages; compare forecasts with later releases; identify which methods and assumptions performed best.

*Industrial Formulation* — the system may help: ingest ingredients, suppliers, prices, and constraints; propose alternative formulas; calculate cost and nutrition; compare trade-offs; plan tests; collect lab and sensory results; create the next candidate.

*SME Go-To-Market* — the system may help: discover customer pains; create offers; test positioning; generate campaigns; observe conversion and revenue; improve targeting and messaging; allocate bounded experimental budgets.

**Business value**

This family sells measurable improvement: lower cost; higher yield; better forecast accuracy; improved risk-adjusted return; faster R&D; higher conversion; better resource allocation; lower human workload; more alternatives tested; improved decision quality.

**Possible commercial models:** paid pilot; enterprise subscription; private deployment; per-workspace or per-team pricing; compute/usage pricing; value-based pricing; shared savings; research partnership; long-term platform contract.

## 4. Cross-Cutting Use Mode — The Application and Platform Improve Themselves

This is not a fourth business family. It is a capability that may apply to all three families.

**Business statement**

> I want any Boring application — including Boring itself — to be able to propose improved versions of its Agents, interfaces, semantic definitions, workflows, evaluators, or package configuration, while ensuring that no change becomes active without validation, comparison, authorization, and rollback.

**Possible improvement targets:** domain candidate; Agent instructions; Agent examples; retrieval configuration; model-routing policy; tool selection; workflow; evaluator; semantic model; calculation; View; Page; navigation; application defaults; product package; onboarding; commercial offer; Boring's own internal process.

**Generic self-improvement process**

```
Observed evidence
      ↓
Proposed revision
      ↓
Validation
      ↓
Evaluation against an incumbent or baseline
      ↓
Promotion or rejection decision
      ↓
Limited activation
      ↓
Monitoring
      ↓
Rollback if needed
```

**What this capability must prevent:** silent live self-rewriting; an Agent granting itself more authority; an Agent changing the evaluator that judges its own revision without disclosure; uncontrolled mutation of production code; untraceable changes; loss of the incumbent version; using private customer evidence outside the permitted scope.

**Why it matters commercially:** better Agents over time; better product defaults; reusable improvements; faster adaptation to verticals; lower maintenance burden; evidence-based product development; a potentially compounding platform moat.

## 5. Evolution Dimensions

The product families above can evolve independently along several dimensions. These dimensions are capabilities, not additional foundational use cases.

### 5.1 Agent Cardinality

```
one Agent → several specialized Agents → Agent teams → external Agent collaboration
```

Possible capabilities: add a specialist Agent; assign roles; route work; delegate bounded tasks; return structured results; retain Agent provenance; set per-Agent budgets; set different authority ceilings; inspect Agent activity when useful; hide orchestration from ordinary users.

Business examples: Research Agent, Writing Agent, Risk Agent, Pricing Agent, Review Agent.

### 5.2 Human Collaboration

```
one user → team → organization → external collaborator
```

Possible capabilities: membership; roles; shared work; comments; assignments; approvals; activity history; attention queues; shared Artifacts; personal presentation state; audit and accountability; controlled external sharing.

### 5.3 Application Composition

```
one application → several modules → several installed applications → composed personal or team environment
```

Possible capabilities: install several products; retain each product's identity and version; combine navigation; combine search; open cross-application resources; use one global composer; preserve entitlements; preserve data boundaries; create cross-application work contexts; avoid exposing technical package boundaries in the user experience.

Example: `Creator Studio + Sponsorship CRM + Mail + Analytics`

### 5.4 Distribution

```
private application → reusable definition → installed product → expert subscription → public product → Agent/API service
```

Possible capabilities: version an application or Agent; define requirements; export/import; install in another private context; create isolated subscriber instances; apply local customizations; upgrade; rollback; publish; control visibility; meter usage; enforce entitlement; support creator economics.

### 5.5 Adaptivity

```
static → personalized → evidence-aware → outcome-driven → recursively improved
```

Possible capabilities: remember explicit preferences; track accept/edit/reject; capture downstream outcomes; compare versions; create candidate revisions; run offline evaluations; promote and roll back; distinguish local and reusable improvements.

### 5.6 Deployment and Sovereignty

```
local → Boring-hosted Switzerland → Boring-hosted EU → dedicated environment → customer-controlled deployment
```

Possible capabilities: portable application identity; portable Agent definition; replaceable model provider; replaceable compute provider; region-aware storage; region-aware model execution; customer-controlled credentials; backup and export; tenant isolation; audit; private networking; dedicated runtime where required.

## 6. Capability Inventory

This inventory describes what the platform may need to support across the business use cases. It does not decide which capabilities are implemented first.

Legend:

- **Essential** — intrinsic to the use-case family.
- **Common** — likely in many products, but not universally required.
- **Optional** — useful for selected products.
- **Advanced** — later-stage form of the capability.

Column key for the tables below: **A** = Agent-Native Domain Software, **B** = Distributed Expert Agent, **C** = Recursive Research / Optimization.

### 6.1 Product Experience Capabilities

| Capability | A | B | C |
|---|---|---|---|
| Purpose-built domain navigation | Essential | Common | Essential |
| Route-first pages | Essential | Common | Common |
| Declarative Views | Common | Common | Common |
| Trusted custom Views | Optional | Optional | Common |
| Tables, records, forms, charts, documents | Essential | Common | Essential |
| Optional workbench with tabs/panes | Optional | Optional | Common |
| Chat-first mode | Optional | Common | Optional |
| Ambient Agent mode | Common | Common | Common |
| Agent drawer or dedicated page | Common | Common | Common |
| Attention and approval interface | Common | Common | Essential |
| Mobile/responsive experience | Common | Common | Optional |
| Branding and theming | Common | Essential | Common |
| Deep links to application context | Common | Common | Common |
| Personal View state | Common | Common | Common |
| Shared recommended Views | Optional | Optional | Common |

**Key business requirement:** the same platform must support a normal SaaS interface, a minimal expert-Agent interface, and a research workbench — without making any one of them the universal shell.

### 6.2 Agent Capabilities

| Capability | A | B | C |
|---|---|---|---|
| Stable Agent identity | Essential | Essential | Essential |
| Versioned Agent behavior | Essential | Essential | Essential |
| Agent uses domain operations | Essential | Essential | Essential |
| Agent receives current semantic context | Essential | Essential | Essential |
| Structured Agent outputs | Essential | Essential | Essential |
| Artifact generation | Essential | Essential | Essential |
| Human approval requests | Common | Common | Essential |
| Background work | Common | Common | Common |
| Long-running work | Optional | Optional | Common |
| Specialist Agent delegation | Optional | Optional | Common |
| Multi-Agent routing | Optional | Optional | Common |
| Agent budget limits | Common | Common | Essential |
| Agent model policy | Common | Common | Common |
| External Agent access | Optional | Common | Optional |
| Subscriber-local personalization | Optional | Essential | Optional |
| Agent self-improvement candidates | Common | Common | Essential |

### 6.3 Human and Agent Operation Parity

**Business requirement**

> If a user can perform a meaningful domain action in the application, an authorized Agent should be able to address the same action structurally.

Examples:

```
Human button:       Move opportunity to Negotiation
Agent instruction:  Move ACME to Negotiation
Automation:         Move opportunity when approval arrives
```

All three should use the same domain behavior.

**Required capabilities:** typed domain actions; input validation; output validation; authorization; effect classification; approval policy; idempotency; retry behavior; audit; provenance; error handling; response shaping for humans and Agents; discovery by the Agent; safe invocation by UI; safe invocation by automation; optional API/MCP exposure.

**Important distinction**

```
Agent-addressable ≠ Agent-authorized
```

The platform can make an action structurally available while still restricting it to: humans only; selected Agents; selected roles; explicit approval; specific records; specific contexts; bounded budgets.

### 6.4 Data and Source Capabilities

| Capability | A | B | C |
|---|---|---|---|
| Private file access | Common | Common | Essential |
| Multiple logical file sources | Optional | Optional | Common |
| Database access | Common | Optional | Essential |
| CSV/JSON/Parquet import | Common | Common | Common |
| SQLite/DuckDB support | Optional | Optional | Common |
| SaaS connector access | Common | Common | Common |
| Mail access | Common | Optional | Optional |
| CRM/ERP access | Common | Optional | Common |
| Document and knowledge sources | Common | Essential | Essential |
| Public data sources | Optional | Common | Essential |
| Object/artifact storage | Essential | Essential | Essential |
| Runtime filesystem projection | Optional | Optional | Common |
| Data residency metadata | Common | Common | Essential |
| Source health and revocation | Common | Common | Essential |
| Data export and portability | Common | Essential | Essential |

**Important capability distinction:** not every data source should become a filesystem mount. The platform must support:

```
files as files
databases as governed queries
mail as mail operations
CRM as domain operations
services as service operations
```

while presenting them coherently to the Agent and application.

### 6.5 Semantic Data Capabilities

A semantic layer is especially valuable when the product depends on structured domain data.

**Business requirement:** the Agent and application should reason in domain concepts such as revenue, gross margin, engagement, inflation, portfolio weight, supplier cost, conversion, customer risk — rather than raw vendor table and field names.

**Required capabilities:** discover semantic models; describe entities; describe measures; describe dimensions; describe relationships; validate queries; query domain concepts; explain how a result was calculated; track semantic-model versions; track source versions and data vintages; preserve query lineage; bind semantic queries to Views; bind semantic measures to evaluations and outcomes; allow SQL or lower-level access as a governed escape hatch; support BSL as one semantic implementation; allow future replacement or augmentation of the semantic engine.

**Business uses**

```
Agent reasoning:       Find accounts with high pipeline value and no contact in 21 days.
Generated interfaces:  Create a chart of revenue by channel and a table of declining campaigns.
Outcome measurement:   Measure realized margin after the new formulation.
Recursive evaluation:  Compare the incumbent Agent and candidate Agent on forecast error and cost.
```

**Applicability:** a semantic model may be central to analytics, research, operations, finance, optimization, dashboards, and generated business interfaces. It may be unnecessary for simple chat, basic file editing, document writing, and some mail workflows.

### 6.6 Durable Work Capabilities

**Business requirement:** users must be able to leave and resume a piece of work independently of the model provider, the Agent process, the sandbox, the browser, the machine, and the current UI layout.

**Required capabilities:** durable work context; human and Agent events; linked records and resources; linked Artifacts; pending approvals; execution status; reconnect; replay or snapshot; provenance; optional parent/child work; participant list; context selection; personal presentation state; shared recommended context; archive and export.

**User-facing examples:** ACME proposal; Eurozone inflation scenario; New supplier formulation; Q4 creator campaign; Portfolio concentration review.

### 6.7 Artifact Capabilities

Agents and humans produce durable outputs. Examples: report; draft; email; spreadsheet; chart; dataset; formulation; portfolio candidate; forecast; presentation; workflow; application View; Agent revision.

**Required capabilities:** stable identity; content storage; type; creator; producing execution; input references; version; provenance; citations; review status; approval status; relationship to later outcomes; share link; open in the correct View; export; comparison; supersession.

Artifacts are universal. Not every Artifact is an optimization candidate.

### 6.8 Governance and Safety Capabilities

| Capability | A | B | C |
|---|---|---|---|
| Human identity | Essential | Essential | Essential |
| Organization/team membership | Common | Optional | Common |
| Agent identity | Essential | Essential | Essential |
| Role-based maximum authority | Essential | Essential | Essential |
| Request-scoped narrowing | Essential | Essential | Essential |
| Record/path/data-subset constraints | Common | Common | Essential |
| Approval for consequential actions | Common | Common | Essential |
| Revocation | Essential | Essential | Essential |
| Audit | Essential | Essential | Essential |
| Budget and usage limits | Common | Essential | Essential |
| Data residency | Common | Common | Essential |
| Provider credential isolation | Essential | Essential | Essential |
| Delegation narrowing | Optional | Optional | Common |
| External Agent isolation | Optional | Common | Optional |
| Policy versioning | Common | Common | Essential |
| Outcome-unknown handling | Common | Common | Essential |
| Rollback | Common | Common | Essential |

**Core business rule** — an Agent must never be able to: grant itself access; widen a delegated permission; reveal credentials; bypass approval; silently repeat an uncertain external effect; activate its own unvalidated revision.

### 6.9 Evidence and Feedback Capabilities

Every product should be able to capture useful evidence without forcing users into an "optimization dashboard."

**Evidence sources:** accepted Agent output; edited Agent output; rejected output; ignored output; explicit rating; human explanation; later reuse; downstream record change; reply; conversion; revenue; performance metric; test result; forecast error; lab measurement; operational result; failure; cost; latency.

**Required capabilities:** link feedback to the originating work and Agent version; distinguish human preference from real-world outcome; preserve final human-edited output; preserve Agent-produced output; track version and configuration; track data and semantic-model versions; track costs and failures; support delayed outcomes; support manual and automatic outcome capture; support sensitive evidence; support export and deletion; support local-only evidence; support explicitly shared or aggregated evidence.

### 6.10 Recursive Improvement Capabilities

A product becomes recursively improvable when it can: identify an improvement target; define what "better" means; gather relevant evidence; propose a new immutable revision; validate it; compare it against an incumbent; enforce guardrails; require promotion authority; activate it without deleting the incumbent; monitor it; roll back.

**Possible targets:** Agent instructions; examples; knowledge selection; Agent routing; model policy; evaluator; semantic model; View; navigation; workflow; package; domain candidate; commercial offer.

**Required capability distinctions**

```
candidate generation
evaluation
promotion
production execution
```

These should not be performed under one uncontrolled authority.

**Improvement scopes:** user-local; instance-local; publisher/package-level; organization-level; platform-level.

A successful local improvement must not automatically become global.

### 6.11 Agent-Built and Agent-Customizable Application Capabilities

**Business requirement** — a user should eventually be able to say:

> "Add a supplier-risk page." · "Show sponsor revenue beside each campaign." · "Build a forecast comparison dashboard." · "Add an approval step." · "Make LinkedIn the primary channel."

The Agent should be able to inspect: what can be done; what data means; how the interface can present it.

**Required reflective capabilities**

```
Operation Catalog:   What actions and queries exist? What are their schemas?
                     What effects do they have? What approvals do they require?
Semantic Catalog:    What entities, dimensions, measures, relationships,
                     types, and filters exist?
Experience Catalog:  What View types and components exist? How can they bind
                     data? How can they invoke actions? What layouts and
                     presentation modes are valid?
```

**Required customization flow**

```
User request
      ↓
Agent-generated experience change
      ↓
Schema and reference validation
      ↓
Preview
      ↓
Diff
      ↓
Human approval
      ↓
Versioned activation
      ↓
Rollback or reset
```

**Possible customization levels:** parameters and filters; layout; navigation; declarative Views; calculations; semantic bindings; workflow configuration; Agent configuration; reviewed code package.

### 6.12 Packaging and Distribution Capabilities

A reusable Agent or application may need: stable package identity; immutable version; content digest; publisher identity; description; branding; Agent definitions; knowledge and skills; Experience definition; semantic models; required Source types; required operations; requested authority; migrations; compatibility information; evaluation fixtures; installation; isolated instance creation; local overlays; upgrade; rollback; export/import; sharing; fork/derive lineage; human-facing application access; Agent-facing operation access; usage metering; entitlement; subscription; publisher analytics; publisher/subscriber data boundary.

This capability group supports both a small personal Agent product and a complete creator-published SaaS product.

### 6.13 Collaboration and Composition Capabilities

**Multi-Agent:** several Agent roles; different authority ceilings; routing; delegation; parent/child work; shared Artifacts; review; cost attribution; Agent provenance.

**Multi-User:** membership; shared records; shared work; approvals; assignments; comments; notifications; activity; personal View state; shared recommended context.

**Multi-Application:** several installed products; namespaced contributions; navigation composition; global search; cross-application resource references; common composer; context routing; preserved entitlement; preserved package lineage; preserved data boundaries.

**Business principle:** adding an Agent, collaborator, or application should ideally add a binding or contribution, not require a separate platform architecture.

### 6.14 Cloud and Sovereignty Capabilities

The platform may eventually need: local execution; local file and database access; hosted execution; Swiss residency; EU residency; dedicated environment; customer-controlled environment; portable Agent definitions; portable application packages; replaceable model providers; replaceable sandbox providers; remote workers; encrypted credentials; private networking; backups; restore; export; regional policy enforcement; regional Artifact storage; regional semantic-query execution; tenant-level audit; dedicated metering.

The product identity, Agent identity, work history, and application semantics should remain stable regardless of deployment.

### 6.15 Commercial Platform Capabilities

Potential business models require: user accounts; team accounts; application instances; plans; entitlements; usage credits; metering; billing; creator subscriptions; publisher payouts; trials; invitations; private offerings; public offerings; usage limits; team limits; data/source limits; Agent limits; customer support and diagnostics; export on cancellation; suspension without data destruction; margin tracking.

This section does not assume which model will be selected.

## 7. Capability Bundles by Business Use Case

The same capability can serve several products. The following bundles illustrate how the platform may be composed.

### 7.1 Creator Studio

```
Agent-native domain software
+ domain navigation and Views
+ ambient Agent
+ content/document Artifacts
+ analytics Sources
+ semantic metrics
+ publishing operations
+ outcome capture
+ optional recursive improvement
```

### 7.2 Creator's Personal Agent

```
distributed expert Agent
+ expert methodology and knowledge
+ private subscriber Sources
+ chat or minimal application
+ Artifact history
+ subscriber-local personalization
+ package/version boundary
+ entitlement and subscription
```

### 7.3 Creator-Published SaaS

```
agent-native domain software
+ distributed expert Agent
+ brand and Experience definition
+ isolated subscriber instances
+ subscriber-owned data
+ instance-local customization
+ package upgrades and rollback
+ subscription and entitlement
```

### 7.4 Macro Research Terminal

```
agent-native domain software
+ time-series Sources
+ semantic catalog
+ analytical operations
+ charts and reports
+ hypothesis and forecast Artifacts
+ data vintages
+ later observed outcomes
+ recursive method improvement
```

### 7.5 Investment Workbench

```
agent-native domain software
+ public and private research Sources
+ semantic company and portfolio models
+ thesis Artifacts
+ scenario and risk operations
+ approvals and investment decisions
+ portfolio outcomes
+ optional multi-Agent research/risk team
+ sovereign deployment
```

### 7.6 Industrial Formulation System

```
agent-native domain software
+ proprietary operational Sources
+ semantic ingredient/cost/constraint model
+ candidate formulation Artifacts
+ deterministic calculations
+ simulation or lab workflow
+ expert approval
+ real outcome capture
+ recursive candidate and method improvement
+ strong governance and sovereignty
```

### 7.7 SME Pipeline Tool

```
agent-native domain software
+ CRM/import Source
+ mail context
+ account and pipeline Views
+ domain operations
+ follow-up Artifacts
+ human approval
+ reply and pipeline outcomes
+ later recursive instruction improvement
```

### 7.8 Autonomous Commercial Discovery

```
recursive research and optimization
+ market-signal Sources
+ opportunity Artifacts
+ product/landing-page generation
+ bounded acquisition operations
+ conversion and revenue outcomes
+ human capital-allocation approval
+ application and commercial-offer improvement
```

This is primarily a future internal use of the platform.

## 8. Product Maturity Spectrum

Any product may move along this spectrum without changing its fundamental business identity.

- **Level 1 — Agent-Assisted:** human uses domain software; Agent answers and performs authorized work.
- **Level 2 — Personalized:** the product remembers explicit preferences and local customizations.
- **Level 3 — Evidence-Aware:** the product records approvals, edits, rejections, reuse, cost, and failures.
- **Level 4 — Outcome-Driven:** the product connects work to real-world results.
- **Level 5 — Recursively Improved:** the product proposes, evaluates, promotes, and rolls back improved versions.

An ordinary mail client may remain at Levels 1–3. An industrial optimizer may target Level 5. A creator product may begin at Level 1 and become outcome-driven after analytics are connected.

## 9. Business Success Conditions Shared Across the Use Cases

Regardless of product family, the platform should be able to demonstrate:

**Value:** useful output; time saved; better outcome; lower cost; increased throughput; access to expertise; improved decision quality.

**Trust:** private data remains private; Agents have bounded authority; consequential actions are approved; results have provenance; changes are reversible; customers can export their data.

**Repeatability:** users complete repeated work cycles; value is not limited to novelty; outputs can be reproduced or audited; the next customer can be onboarded with less custom engineering.

**Economics:** customers pay; model and infrastructure costs are measurable; support burden is sustainable; gross margin can improve; creator or publisher economics can be supported later.

**Learning:** feedback can be linked to the originating work; real outcomes can be distinguished from preference signals; revisions can be compared; improvements do not rely only on persuasive self-evaluation.

## 10. Business Questions Intentionally Left Open

This section does not resolve the following questions. They should remain visible because they influence later architecture and product choices.

1. Which use-case family becomes the first paid product?
2. Does the first buyer primarily want a domain application or an Agent?
3. How much interface customization can remain declarative?
4. Which domains provide sufficiently fast and independent outcomes?
5. How much Agent identity and personalization should move between applications?
6. Can a work context eventually span several installed applications?
7. Which subscriber evidence may be used to improve a publisher's package?
8. Which improvements remain customer-local?
9. What level of creator distribution is commercially valuable first?
10. Do customers want a full SaaS application, an expert Agent, or both?
11. Which operations should external Agents eventually access?
12. Which domains require Swiss residency rather than general European residency?
13. When does multi-Agent specialization outperform one strong Agent?
14. Which collaboration features create value before they create complexity?
15. How should creator/subscriber and platform economics be divided?
16. Is recursive improvement primarily the product value, the internal moat, or both?
17. Which outcome signals are robust enough to drive automated promotion?
18. When does an application need arbitrary trusted code rather than declarative Views?
19. How should multiple published products compose without losing entitlement and data boundaries?
20. How much application-building autonomy should an Agent receive before human review?

## 11. Capability Set to Carry Into Part 2

Part 2 should determine the minimal objects and abstractions required to provide the following business capabilities.

1. Purpose-built application experience
2. Agent identity and versioned behavior
3. Human/Agent operation parity
4. Governed access to heterogeneous data and services
5. Semantic discovery and querying
6. Durable resumable work
7. Artifacts and provenance
8. Human approval and feedback
9. Real-world outcome capture
10. Recursive candidate/evaluation/promotion
11. Agent-generated declarative application changes
12. Package and version boundaries
13. Subscriber and tenant isolation
14. Multi-Agent extensibility
15. Multi-user extensibility
16. Multi-application extensibility
17. Local-to-cloud portability
18. Sovereignty, residency, audit, and export
19. Metering, entitlement, and commercial operation
20. The ability for Boring itself to use the same improvement process

Part 2 should resist creating one architectural object per capability. The objective will be to find the smallest set of clean identities, boundaries, and relations that can support this complete capability space.
