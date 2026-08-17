Generated image: Boring UI Workspace Navigation Diagram

Generated image: Boring UI Workspace States & Flows

Generated image: Boring UI Workspace Shell Concept Board

Today 6:46 AM
Pasted markdown(1).md
File
Pasted markdown (2).md
File
Pasted text (3).txt
Document
I asked 3 competing LLMs to do the exact same thing and they came up with pretty different plans which you can read below. I want you to REALLY carefully analyze their plans with an open mind and be intellectually honest about what they did that's better than your plan. Then I want you to come up with the best possible revisions to your plan (you should simply update your existing document for your original plan with the revisions) that artfully and skillfully blends the "best of all worlds" to create a true, ultimate, superior hybrid version of the plan that best achieves our stated goals and will work the best in real-world practice to solve the problems we are facing and our overarching goals while ensuring the extreme success of the enterprise as best as possible; you should provide me with a complete series of git-diff style changes to your original plan to turn it into the new, enhanced, much longer and detailed plan that integrates the best of all the plans with every good idea included (you don't need to mention which ideas came from which models in the final revised enhanced plan):


https://claude.ai/code/artifact/66dc2f8b-2084-42d5-910f-e409520e8670

Pasted markdown(2).md
File
Pasted markdown (2)(1).md
File
Pasted text (4).txt
Document
I asked 3 competing LLMs to do the exact same thing and they came up with pretty different plans which you can read below. I want you to REALLY carefully analyze their plans with an open mind and be intellectually honest about what they did that's better than your plan. Then I want you to come up with the best possible revisions to your plan (you should simply update your existing document for your original plan with the revisions) that artfully and skillfully blends the "best of all worlds" to create a true, ultimate, superior hybrid version of the plan that best achieves our stated goals and will work the best in real-world practice to solve the problems we are facing and our overarching goals while ensuring the extreme success of the enterprise as best as possible; you should provide me with a complete series of git-diff style changes to your original plan to turn it into the new, enhanced, much longer and detailed plan that integrates the best of all the plans with every good idea included (you don't need to mention which ideas came from which models in the final revised enhanced plan): 

Yes—it is structurally covered, but it is not prominent enough as a business use pattern.

The current plan models it as:

Input / Brief
      ↓
Work admitted
      ↓
Agent Execution
      ↓
Artifact / Result
      ↓
Delivery
      ↓
optional review, revision, approval, or outcome

That appears in the current concepts of Work, Execution, and Artifact, and in the external/headless scenario where a client submits a brief and receives a durable output. The external reviews also highlighted that Work—not chat—should be the commercial unit because it can carry value, cost, retention, and ROI.

But I agree with your concern: a reader could finish Part 1 thinking primarily about persistent SaaS and recursive optimization, while missing the simpler and commercially powerful case:

    Give the Agent a job. It completes the job. It delivers the result.

The use case

I would name it:
Agent Job Delivery

    I want to submit a bounded job to an Agent, provide the required context and constraints, and receive a completed, usable deliverable—without needing to operate a full application or manage the Agent’s internal process.

Examples:

research these 20 companies
→ investment memo

analyze this dataset
→ report and dashboard

review this contract
→ issue list and revised draft

prepare this campaign
→ content package

analyze this business
→ diagnostic and action plan

compare these suppliers
→ sourcing recommendation

turn these notes into a deck
→ presentation

evaluate this formulation
→ comparison report

This is probably one of the simplest ways to sell an Agent.

The customer does not necessarily want:

    a workspace;

    a dashboard;

    ongoing optimization;

    visible multi-Agent collaboration;

    an app builder;

    a long conversation.

They want:

brief
→ completed work
→ useful output

It should not become a fourth foundational architecture

I would model it as a delivery mode available to all three business jobs.
For domain software

CRM record + request
→ Agent completes account research
→ result delivered into the CRM

For a distributed expert Agent

subscriber submits business context
→ expert Agent performs diagnosis
→ subscriber receives report

For recursive research or optimization

objective + data
→ Agent produces candidate formulation
→ system returns candidate + evaluation

So:

Operate
Distribute
Improve

describe why the customer hires the product.

Job delivery

describes how value is consumed.

That is similar to the current external/headless concept, but broader: it can occur inside a Boring UI, through an API, by email, through MCP, or through a minimal upload-and-deliver application.
The minimal job contract

At the business level, a job needs:

Input
Instructions
Context
Constraints
Expected deliverable
Completion criteria
Budget / deadline

Conceptually:

JobRequest {
  brief
  inputRefs
  constraints
  expectedOutput
  acceptanceCriteria?
  deadline?
  budget?
}

The delivered result needs:

JobDelivery {
  status
  artifacts
  summary
  provenance
  costs
  unresolvedQuestions?
  requiredApprovals?
}

I would avoid deciding in Part 1 whether Job is a separate technical object or simply a shape of Work. My current recommendation is:

    Job is a business-facing form of Work, not necessarily a new architectural primitive.

A Work item might be:

continuous:
“Manage the ACME renewal”

bounded job:
“Produce an investment memo on ACME”

Same durable substrate, different contract and UX.
Job lifecycle

The plan should explicitly support:

draft
→ submitted
→ accepted
→ running
→ needs-input
→ needs-approval
→ delivered
→ accepted
→ revision-requested
→ closed

And failure states:

rejected before execution
blocked
failed
cancelled
partially delivered
outcome unknown

This matters because “Agent generated some text” is not the same as “the job was delivered.”
What counts as delivery

The output should normally be a durable Artifact, not only an assistant message.

Possible deliverables:

document
report
spreadsheet
dataset
presentation
draft email
code patch
dashboard
decision memo
candidate formulation
portfolio
structured JSON result

The customer should be able to:

    open it;

    download or export it;

    inspect Sources and provenance;

    request a revision;

    accept it;

    share it;

    compare versions;

    reuse it elsewhere.

The prior architecture analysis correctly framed this “brief → durable Artifact” path as an important product feature, including foreign-client and headless delivery.
Several product shapes can expose the same job
1. Minimal job portal

Upload inputs
Describe job
Submit
Track status
Receive output

This could be the fastest commercial product shape.
2. Normal SaaS action

Company record
[Generate investment memo]

The job originates inside a domain application.
3. Chat

“Analyze these companies and prepare a report.”

Chat is simply the intake surface.
4. Email or messaging

Send brief
→ receive result
→ approve or revise

5. API or MCP

external system submits job
→ polls/subscribes
→ receives structured Artifact

6. Recurring job

Every Monday:
analyze pipeline
→ deliver prioritized action report

All should use the same job semantics underneath.
Capabilities needed

I would add a clear capability subsection covering:
Capability	Why it matters
Structured intake	The Agent must understand required inputs, constraints, and expected output.
Input validation	A job should not begin with missing or incompatible data.
Admission	The platform decides whether the job is authorized, feasible, and within budget.
Durable identity	The job survives browser, process, and runtime failures.
Status and progress	The customer knows whether it is queued, running, blocked, or delivered.
Questions and approvals	The Agent can pause and request human input without losing the job.
Bounded scope	The Agent receives only the Sources and Operations needed for that job.
Budget and deadline	Prevent unbounded research or runaway Agent teams.
Artifact delivery	Results are durable, versioned, exportable, and citable.
Acceptance and revision	The customer can accept, reject, or request another version.
Provenance	The result records Agent version, Sources, Operations, cost, and citations.
Recoverability	Failed attempts do not lose the job or duplicate external effects.
Notification	The customer can be informed outside the originating interface.
Metering	Supports per-job pricing and margin analysis.
Optional outcome link	Later determine whether the delivered job actually created value.
Commercial importance

This pattern supports several straightforward revenue models:

per job
per delivered Artifact
credit packs
subscription including N jobs
premium turnaround
human-reviewed delivery
recurring managed service

It is particularly useful for selling before a complete SaaS interface exists.

For example:

    Upload your portfolio universe and receive a weekly research shortlist.

Or:

    Send your creator analytics and receive ten evidence-backed content briefs.

Or:

    Upload ingredients and supplier prices and receive three feasible cost-reduction candidates.

This can generate revenue while the richer application gradually forms around repeated jobs.
Important distinction: delivery versus outcome

The platform should keep three moments separate:

Produced
= the Agent generated an output

Delivered
= the customer received a valid agreed deliverable

Successful
= the deliverable later achieved its intended real-world result

Example:

Produced:
campaign draft generated

Delivered:
customer accepted and exported the campaign

Outcome:
campaign generated 18 qualified leads

That separation is essential for the recursive loop.
Recommended revision to Part 1

I would add Agent Job Delivery under the consumption modes, beside native application and external/headless use:

## Agent Job Delivery

I want to submit a bounded job with inputs, constraints, expected
deliverables, budget, and deadline; allow an authorized Agent to perform
the work asynchronously; answer questions or approvals when needed; and
receive durable, versioned Artifacts with provenance.

This is not another foundational business job. It is a delivery mode
available to Operate, Distribute, and Improve.

The minimum loop is:

input / brief
→ admitted Work
→ Agent execution
→ questions or approvals when required
→ durable Artifact delivery
→ accept, revise, reject, or close
→ optional later Outcome

And add the key business invariant:

    A completed Agent turn is not necessarily a delivered job. Delivery requires an agreed output contract, durable Artifact, terminal receipt, and customer-visible status.

So the answer is:

    Yes, the architecture already covers it through Work → Execution → Artifact, but the business document should explicitly elevate “Agent Job Delivery” as a core consumption and monetization mode.

It may actually be one of the best near-term bridges between concierge services, personal expert Agents, normal SaaS, and later recursive optimization.

the job first intercat is probalby : chat or mcp or whatsapp (other chant chanles)

Yes. This is an important refinement:

    For Agent Job Delivery, the first interaction will often be a channel—not an application page.

The initial user journey may be:

WhatsApp message
→ Agent completes job
→ PDF/report/draft delivered

or:

Chat request
→ Agent asks clarifying questions
→ work completed asynchronously
→ Artifact appears in chat and in the app

or, for machine consumers:

MCP client
→ submits structured job
→ polls or subscribes to status
→ receives Artifact

The previous architecture comparisons surfaced this as a cross-cutting “foreign client/headless” consumption mode: WhatsApp, Telegram, MCP, existing applications, and other clients can submit a brief and receive a durable Artifact without depending on Boring’s own shell.

That should be made explicit in Part 1.
The correct conceptual flow

INTERACTION CHANNEL
Chat · WhatsApp · Email · MCP · API · Slack · Teams
                         │
                         ▼
                     INTAKE
           identity · entitlement · brief
             inputs · attachments · intent
                         │
                         ▼
                    WORK / JOB
           durable identity · scope · budget
          expected output · acceptance criteria
                         │
                         ▼
                  AGENT EXECUTION
                         │
             questions / approvals / blockers
                         │
                         ▼
                      ARTIFACT
            report · draft · data · decision
                         │
                         ▼
                    DELIVERY
          original channel · app · email · API
                         │
                         ▼
              ACCEPT / REVISE / REJECT
                         │
                         ▼
                optional later OUTCOME

The key principle is:

    Conversation is an intake and steering surface. It is not the durable identity of the job.

A WhatsApp thread, Chat session, or MCP request may create or interact with a durable Work item, but none of those external identifiers should become the canonical Work identity.
1. Separate Channel, Conversation, Work, and Artifact

These are different concepts.
Channel

Where interaction happens:

first-party chat
WhatsApp
Telegram
Slack
Teams
email
MCP
HTTP API
voice

Conversation

A sequence of messages in a Channel.

It may help clarify a request, answer questions, or approve an action.
Work / Job

The durable contract for what the user wants completed.

It survives:

    switching channels;

    leaving the chat;

    process failure;

    runtime replacement;

    a long pause waiting for approval;

    delivery through another interface.

Artifact

The durable deliverable produced by the Work.

Examples:

investment memo
content brief
spreadsheet
report
campaign package
forecast
portfolio proposal
formulation
dashboard
code patch

This distinction lets someone begin a job in WhatsApp, review it later in a rich web application, and receive the final deliverable through email—all without creating three separate pieces of work.

WhatsApp intake
        ↓
same Work ID
        ↓
approval in Boring app
        ↓
same Work ID
        ↓
PDF delivered by email

2. The application is not necessarily the acquisition surface

This changes how we should think about the role of the SaaS interface.

The app may not be the user’s first interaction.

Instead, the app can become the persistent control plane for:

    connected data;

    job history;

    Artifacts;

    approvals;

    settings;

    permissions;

    dashboards;

    outcomes;

    subscription;

    team collaboration.

The first value may be delivered entirely through a messaging channel.
Creator-distributed Agent example

Creator shares:
“Message my Agent on WhatsApp”

Subscriber:
“Analyze my last 20 videos and give me 10 ideas.”

Agent:
asks for channel export or secure connection

Agent:
completes research

Subscriber receives:
10 content briefs + link to private dashboard

The user enters through WhatsApp.

The richer application emerges only when they need:

history
analytics
source connections
editing
comparison
team sharing
automation

That may be a much stronger adoption path than asking every subscriber to learn a new SaaS product immediately.
3. Channel-first job delivery fits all the identified business uses
Agent-native SaaS

A job can originate from the app:

[Generate investment memo]

or from an external channel:

WhatsApp:
“Prepare the weekly ACME account report.”

Both create the same underlying Work.
Distributed expert Agent

This may be the default interaction model:

subscribe
→ message expert Agent
→ receive deliverable

A complete application is optional at first.
Recursive optimization

A domain expert may submit:

“Find three lower-cost formulations
using the new supplier prices.”

The Work produces candidate Artifacts, evaluations, and perhaps later Outcomes.
Boring’s internal product factory

Another Agent can submit a job through MCP:

research pain cluster
→ build product brief
→ produce landing-page package

Same durable Work model.
4. Three channel families

It is useful to distinguish three broad channel types.
A. First-party human channels

Examples:

Boring chat
app composer
mobile Boring client

Advantages:

    richest context;

    strongest identity;

    secure attachments;

    inline Views and approval components;

    easy connection to current application state.

These can support the most sophisticated experience.
B. Third-party human messaging channels

Examples:

WhatsApp
Telegram
Slack
Teams
email
SMS

Advantages:

    extremely low friction;

    users already live there;

    good for creator distribution;

    strong asynchronous behavior;

    natural notifications and approvals.

Limitations:

    constrained interface;

    third-party data retention;

    limited rich UI;

    external identity must be mapped safely;

    sensitive data may not be appropriate to send through the channel;

    inbound content must be treated as untrusted.

For sensitive jobs, the channel may carry only:

brief
status
questions
approval
deep link

while private data is uploaded or connected through a secure Boring interface.
C. Machine channels

Examples:

MCP
HTTP API
webhook
another Agent
existing SaaS integration

These are more structured.

A machine client may use operations such as:

job.submit
job.getStatus
job.answerQuestion
job.approve
job.cancel
artifact.list
artifact.get

MCP is not merely “chat without a UI.” It is a machine-facing projection of the same Work and Operation model.
5. Channel adapters should normalize interaction

Each channel should convert its native events into a common inbound envelope.

Conceptually:

interface InboundInteraction {
  channel: ChannelRef

  externalConversationId?: string
  externalMessageId: string

  principalRef?: PrincipalRef
  targetInstanceRef?: InstanceRef
  targetAgentRef?: AgentRef

  text?: string
  attachments?: AttachmentRef[]

  replyTo?: string

  receivedAt: string
  trust: ContentTrust
}

This does not mean this exact interface must become a core object. It describes the capability boundary.

The adapter resolves:

    who sent the message;

    which subscription or instance it belongs to;

    whether the sender is authenticated;

    whether the message continues an existing Work item;

    whether it starts a new Work item;

    whether attachments should be imported;

    what channel-specific restrictions apply.

Then the core works with:

Principal
Work
Operation
Artifact
Attention

rather than WhatsApp-specific or MCP-specific semantics.
6. Not every message should automatically become a job

This is a subtle but important UX question.

A user might say:

    “Can you help me analyze my portfolio?”

That is not yet a sufficiently bounded job.

The Agent may need to clarify:

Which portfolio?
What period?
What type of analysis?
What deliverable?
What deadline?
Which Sources may I use?

The system should be able to move from an unstructured conversation to a structured job contract.

unstructured message
        ↓
clarification
        ↓
proposed job contract
        ↓
user confirmation
        ↓
admitted Work

For example:

JOB

Title:
Weekly portfolio risk review

Inputs:
Current holdings
Risk-model data
Research notes

Deliverables:
Risk report
Top five concentration concerns
Three proposed mitigations

Deadline:
Friday 10:00

Maximum cost:
CHF 8

External effects:
None

[Start job]

For low-risk jobs, confirmation may be implicit.

For expensive, sensitive, or consequential jobs, explicit confirmation is valuable.
7. The same channel can handle questions and approvals

During execution, the Agent may need human input.

Agent:
“I found two conflicting supplier price lists.
Which should be authoritative?”

[January contract]
[Latest uploaded CSV]
[Stop job]

Or:

Agent:
“The report is ready, but sending it to the client
is an external action.”

[Review first]
[Approve sending]
[Reject]

An approval response must be tied to:

    the correct Principal;

    the exact Work;

    the exact proposed Operation;

    the exact input or Artifact revision;

    an expiration or revocation state.

A user replying “yes” in an unrelated WhatsApp conversation must not accidentally authorize an old consequential action.
8. Delivery can happen through a different channel

The output channel should be independent from the intake channel.

Examples:

Input:
WhatsApp

Progress:
WhatsApp

Review:
Boring web application

Final delivery:
email + secure Artifact link

or:

Input:
MCP

Questions:
callback / attention item

Final output:
structured MCP resource

or:

Input:
email

Final output:
dashboard + PDF attachment

The Work record should define a delivery policy:

interface DeliveryPreference {
  statusChannels: ChannelRef[]
  approvalChannels: ChannelRef[]
  artifactChannels: ChannelRef[]
}

Again, this is a capability description, not necessarily a proposed database table yet.
9. Channel capabilities the platform will need
Capability	Why
External identity binding	Map phone number, email, MCP client, or chat session to the correct Principal and Instance.
Entitlement resolution	Verify that the sender may use the expert Agent or product.
Conversation-to-Work linking	Continue an existing job or create a new one without treating the external conversation as the job identity.
Message idempotency	Messaging providers and clients may deliver duplicates.
Attachment import	Safely import files, images, audio, datasets, and URLs.
Content trust labeling	Messages and attached documents are untrusted content, not authority.
Secure escalation	Move sensitive data entry or complex review into a trusted Boring View.
Status projection	Translate internal states into channel-appropriate messages.
Questions	Ask for missing information and resume the same job.
Approval projection	Show bounded approval choices tied to the exact proposed action.
Artifact delivery	Send a file, structured result, summary, or secure deep link.
Cross-channel continuity	Start in one channel and continue in another.
Rate and abuse limits	Prevent spam, loops, and runaway consumption.
Channel-specific policy	Restrict what data and effects are allowed on each channel.
Audit and provenance	Record where the request, answer, approval, and delivery happened.
Notifications	Deliver completion, blocker, failure, and outcome reminders.
Localization	Use the subscriber’s preferred language and channel conventions.
10. Channel policy is part of sovereignty

A third-party messaging channel should not automatically receive the same information as a first-party application.

A product may specify:

WhatsApp:
- accept brief
- accept small attachments
- show status
- ask questions
- approve low-risk mutations
- deliver summaries and secure links

Not allowed:
- expose confidential source data
- display full private research corpus
- approve high-risk external effects
- transmit credentials

MCP may have a different policy:

MCP:
- submit structured job
- attach authorized resource refs
- inspect status
- retrieve allowed Artifacts

Not allowed:
- select another subscriber's Instance
- inherit the caller Agent's full authority
- access internal Threads not explicitly exposed

This lets Boring remain sovereign even when the interaction channel is not hosted by Boring.
11. The job-first model can naturally generate the future app

This may be one of the most important connections.

The first version of a product can be:

message
→ job
→ Artifact

As repeated jobs accumulate, the platform sees stable patterns:

same inputs
same questions
same deliverable
same approvals
same outcomes

The Agent can then propose:

    a structured intake form;

    a saved job template;

    a dashboard;

    a record page;

    a review queue;

    an automation;

    a complete domain interface.

The evolution becomes:

conversational service
        ↓ repeated job pattern
structured job template
        ↓
specialized Views
        ↓
purpose-built SaaS
        ↓
adaptive / recursive product

This is a credible path toward “the application builds itself.”

The application is not generated from an abstract prompt.

It crystallizes from repeated real work.

That is much more likely to produce a useful interface.
12. Implication for Part 1

I would add a cross-cutting section titled:
Channel-First Agent Job Delivery

Proposed wording:

## Channel-First Agent Job Delivery

A user or another Agent may first encounter a Boring product through a
conversation or machine channel rather than through its full application
interface.

Representative entry channels include:

- first-party chat or composer;
- WhatsApp, Telegram, Slack, Teams, email, or another messaging channel;
- MCP or another Agent-facing protocol;
- HTTP API, webhook, or an existing application.

The channel is an intake, steering, notification, and delivery surface.
It is not the durable identity of the work.

The common flow is:

brief / input
→ identity and entitlement resolution
→ clarification
→ durable Work admission
→ Agent execution
→ questions and approvals when required
→ durable Artifact delivery
→ accept, revise, reject, or close
→ optional later Outcome

The same Work may move between channels. A request may begin in WhatsApp,
be reviewed in a Boring application, and deliver its final Artifact through
email. An MCP client may submit a structured job and receive the same kind
of Artifact through a machine-facing projection.

The platform therefore needs channel-neutral Work, Operation, Artifact,
Attention, authority, and evidence semantics. Channel-specific conversation
IDs, message IDs, sessions, and formatting remain adapter concerns.

A completed Agent turn is not necessarily a completed job. Job completion
requires a terminal Work status and a durable deliverable satisfying the
agreed output contract.

And I would add this business principle:

    The full SaaS interface may be the persistent control plane, while chat, WhatsApp, MCP, email, or another channel is the first point of value delivery.

That makes the model cover both extremes:

user starts inside a rich domain SaaS

and:

user messages an Agent, receives a job, and only later discovers the app

without needing two architectures.

ok enehance the part-1 wit this use-case if it's missing. and have you incldied a as a premises the billing ?? wes hould be fleixbe here as wellas it dependin the vertical. and in 3.5 Cross-cutting internal mode  -> we should incldue the code facotry: I alredy have a facatory setup where I ahve orhcestrora + worker agents with review gate that post to the inbox where my review is needed..  + I think an andditiona disitubiton = a dev just uning our framwoer to create and host agent on our platofrm... npx boring create , npx boring deploy ... 

Updated. The document now treats the new ideas as cross-cutting business and distribution modes, not as new parallel architectures.
What changed
1. Channel-first Agent Job Delivery is now explicit

Part 1 now covers the full flow:

chat / WhatsApp / email / Slack / Teams / voice / MCP / API
        ↓
identity and entitlement
        ↓
clarification and Job Contract
        ↓
durable Work
        ↓
Agent execution
        ↓
questions / approvals
        ↓
durable Artifact delivery
        ↓
accept / revise / reject
        ↓
optional later Outcome

The document now explicitly distinguishes:

Produced
= the Agent generated something

Delivered
= the customer received a valid agreed deliverable

Successful
= the deliverable later achieved its intended result

It also establishes that a channel conversation is not the durable Work identity. A job can start in WhatsApp, be reviewed in the Boring application, and be delivered by email without becoming three separate jobs.
2. Billing is now a flexible platform premise

Billing was present before, but it was not expressed strongly enough as an independent business dimension.

The revised plan now separates:

Usage facts
→ what was consumed

Entitlement and budget
→ what may be used

Pricing policy
→ how value or usage maps to a price

Billing and collection
→ invoices, payments, credits, tax

Settlement and payout
→ allocation between platform, publisher,
  developer, customer, and provider

Supported commercial models may include:

    subscription;

    seat or Instance pricing;

    per job;

    per delivered Artifact;

    usage or credits;

    retainer or managed service;

    developer hosting fee plus usage;

    creator/expert-Agent subscription;

    enterprise committed spend;

    bring-your-own-model/provider;

    publisher revenue sharing;

    outcome-linked or shared-savings pricing where attribution is credible;

    hybrids of these.

The critical premise is now:

    Usage and cost attribution are stable platform facts. Pricing and billing are configurable policies selected by the vertical and commercial offer.

The platform therefore does not assume that every product is billed per token, per seat, or through a marketplace.
3. The existing code factory is now a concrete reference use case

Section 3.5 now describes the factory you already operate:

backlog / product request / defect
        ↓
orchestrator decomposes Work
        ↓
bounded worker Agents
        ↓
code patches / tests / Package revisions
        ↓
automated review gates
        ↓
Attention Items in your inbox
        ↓
human review
        ↓
merge / release / deploy / reject

It now explicitly includes:

    orchestrator and worker Agents;

    bounded child Work;

    branches, worktrees, sandboxes, Sources, authority, and budgets;

    code and declarative revision Artifacts;

    type checks, tests, security checks, benchmarks, and evaluation packs;

    review-gated diffs sent to the human inbox;

    authorized merge, release, deployment, and promotion;

    cost, latency, failure, review, and deployment evidence.

The factory is not allowed a privileged self-modification bypass. It uses the same:

Work
Execution
Artifact
Attention
Evidence
Evaluation
Promotion

contracts as customer-facing products.
4. Developer distribution is now a named platform path

Part 1 now includes a distinct developer-distribution mode:

    A developer can use Boring as a framework, develop locally, and deploy an Agent or agent-native application onto Boring’s hosted platform.

Canonical journey:

npx boring create my-agent
cd my-agent
npx boring dev
npx boring test
npx boring deploy

Potential templates include:

    bounded job-delivery Agent;

    chat-first expert Agent;

    route-first SaaS application;

    headless MCP/API Agent;

    background worker;

    semantic-data Agent;

    extension for an existing Boring product.

The developer path includes capabilities for:

    local/hosted contract parity;

    Agent, Operation, Source, Experience, and evaluation manifests;

    capability passports;

    secrets and Source binding;

    immutable releases;

    hosted Instance creation;

    region, domain, budget, and entitlement configuration;

    logs, traces, costs, and health;

    promotion and rollback;

    later publishing and commercialization.

The deployed product becomes a normal Boring Package/Instance—not a parallel developer-only runtime.
5. The additions were propagated across the whole document

The revision updates more than the headline sections. It also adds the new capabilities to:

    the executive summary;

    business vocabulary;

    evolution dimensions;

    durable Work requirements;

    channel and automation capabilities;

    developer/operator capabilities;

    the capability matrix;

    user-visible proof scenarios;

    representative product bundles;

    minimum demonstrable loops;

    business success conditions;

    unresolved questions;

    the Part 2 noun budget;

    structural relations;

    extension points;

    anti-proliferation rules;

    the final Part 2 capability handoff.

The updated document now has 2,780 lines, up from 2,364.
Files

The diff was dry-run tested successfully with patch -p1.


