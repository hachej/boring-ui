# Expert software building blocks — working direction (2026-09-10)

> **Status: owner working direction, not a ratified architecture amendment.**
> This document synthesizes the product discussion following the Grok Bot UX,
> runtime-SDK and credential/egress proposals in this PR. It records the shape
> to grill before turning it into contracts or implementation work. Existing
> rulings in RECONCILIATION and DECISIONS win where wording differs.

## The product split

**Clinic and the multi-worker bot are distinct products over shared substrate.**
Clinic is a ready-to-use clinical product whose primary Experience follows a
recognizable consultation workflow. The multi-worker bot is a conversation-led
product in which a familiar bot understands an intention, performs small work,
delegates substantial work, and reveals useful working surfaces as needed.
Neither is a skin or mode of the other. Both may use the same agent runtime,
Threads, governed operations, knowledge, artifact, release and installation
machinery.

This is not a permanent creator/consumer split. A doctor may personalize Clinic
without entering a builder mode, and a bot user may operate a finished tool
without creating software. Creating or changing software is a distinct job
behind either Experience.

## The interaction model

The default relationship is one obvious user-facing bot and one composer. The
bot remains available while substantial work continues remotely. It answers
small requests directly; for larger requests it creates durable work, sends a
bounded brief to an appropriate worker, and returns the result to the same
user-facing conversation. Named specialists may be visible and directly
addressable, but the user need not select one before expressing intent.

The Grok Bot chat extract is useful UX evidence, not verified implementation
evidence. We adopt its approachable distinction between a user-facing bot and
background workers, but not the simplifications "one agent = one long session"
or "one chat = one job" as our ontology.

Underneath the Experience:

```text
Agent       durable identity and definition
Seat        an Agent participating under one Workspace's constraints
Thread      one durable job
Session     one runtime conversation; a Thread binds 0..n Sessions
Run         one admitted execution, identified by its request key
Artifact    a durable work result that survives any worker computer
```

The user's conversation is the front door; the Thread is the durable job;
workers are bounded participants; artifacts are the durable value. A single
chat may initiate several jobs. A job may survive context compaction, browser
closure, channel changes, runtime restarts and worker replacement.

## User-facing bots and remote agents

A **user-facing bot** operates in a Workspace. It maintains the relationship,
interprets intent, uses existing domain capabilities, initiates durable work,
delegates, presents results and asks for decisions. Being user-facing does not
imply broad execution authority.

A **remote agent** executes bounded work in a purpose-specific environment. It
receives explicit resources, authority and budget; streams status; can be
steered or stopped; and returns messages, artifacts, evidence and decisions to
the Thread. Remote describes an execution boundary, not whether the agent is
visible. Research, evaluation, document processing, coding and release review
may use different remote-agent classes.

A **creator agent is one privileged class of remote agent**, not a more
powerful user-facing bot and not a synonym for every remote agent. It can inspect
and modify candidate renderer code, CSS, domain operations and tests in a
candidate environment. It cannot modify the active product, protected checks,
grants or activation pointer, and it cannot approve its own candidate.

By default a worker receives a bounded brief, not a transcript dump:

```text
Goal · relevant context · selected resources · constraints and authority
expected deliverables · acceptance checks · parent Thread/Run · result target
```

Selected messages or artifacts can be referenced explicitly. Full-history
access is exceptional and authorized, especially when a Workspace contains
clinical or other private data. Agent-to-agent consultation is likewise a
bounded host-mediated message, not shared memory, a fused Session, or direct
A2A loopback.

## A real computer, without ambient authority

[OpenComputer is an interface reference](OPENCOMPUTER-INTERFACE-REFERENCE.md),
not a decision to adopt its hosted control plane or replace Boring's runtime.
It demonstrates coherent public shapes for agent definitions, durable and
steerable Sessions, ordered events, source checkout, computer leases,
checkpoints, browser tokens, previews and credential-free external operations.
Use those solved shapes to retain, sharpen or fill Boring's existing premises
and mechanisms—never to create a parallel stack.

Boring continues to own authority, canonical records, placement and the
additional separation:

```text
remote-agent Session  ≠  computer lease  ≠  installed product runtime
```

The computer may be disposable or hibernating. Thread state, artifacts and
evidence survive it. Accepted software runs in the durable product runtime for
its Installation, never in the builder computer. The host can place execution
locally, on sovereign remote infrastructure or through an optional provider;
the interface is not coupled to OpenComputer. Capabilities are narrowed by
agent declaration ∩ Workspace grant ∩ job restriction ∩ current host policy.
Full network egress is not a universal default.

Credential-backed actions use the credential-broker and egress model in
[CREDENTIALS-AND-EGRESS.md](CREDENTIALS-AND-EGRESS.md): the runtime receives a
surrogate scoped to a provider, destination, operation, job and lifetime; the
real secret exists only at the network boundary. A creator may be able to open
a pull request without being able to read or exfiltrate the underlying token.

## What experts assemble

Constrain implementation choices, not expert intentions. The initial creation
space has three composable forms:

1. **Working document** — note, letter, sourced analysis, lesson.
2. **Interactive tool** — calculator, questionnaire, comparison, annotation.
3. **Workspace over records** — dossier, case tracker, research collection,
   course.

A product can combine these forms. The reusable software and the private work
performed with it have separate lifecycles: updating or sharing a consultation
tool cannot overwrite or export consultations produced with it.

The proposed expert-software blocks are semantic, not merely visual:

| Block | Responsibility |
| --- | --- |
| Knowledge | approved sources, retrieval, citations and source versions |
| Skill / method | expert procedure, terminology and output conventions |
| Record | typed domain information, identity, validation and relationships |
| Operation | governed read, calculate, propose, save, export or external effect |
| Presentation | documents, forms, tables, timelines, charts, source/review controls |
| Workflow behavior | triggers, background work, human decisions and failure handling |

A skill says how to approach work; workflow behavior says how work proceeds;
neither should secretly prescribe an entire interface. UI, agents,
deterministic jobs and authorized external clients use the same governed domain
operations.

## Shadcn as the presentation constraint

**Generated Experiences use one curated, versioned shadcn-based component set.**
The creator composes approved components and tokens; it does not choose another
design system, reinstall shadcn per artifact, rewrite shared primitives, or
invent arbitrary interaction states. Shared typography, spacing, color,
loading, error, accessibility and recovery behavior are platform constraints.

Expert-facing components sit above shadcn: sourced passage, editable document
section, proposal-versus-accepted comparison, clinical letter draft, record
summary. If a needed capability is absent (for example rich-text annotation or
a chart), it follows an explicit extension path and becomes reusable only after
review. Common components do not require common layouts.

The generation ladder is:

1. **Configure** an existing block or method.
2. **Compose** existing blocks and operations.
3. **Extend** with candidate code only when the requested behavior cannot be
   expressed safely through the first two.

The generator spends effort on the expert's method and interaction, not on
rebuilding authentication, persistence, authorization or a component library.

## Personalization without prompt engineering

Experts should personalize by correcting visible results, not by editing system
prompts. A doctor can say, for example, "too long; keep only the reason, the
important findings and my request to the cardiologist." The bot proposes the
revised output and may ask whether to retain that form for future letters. An
example chosen explicitly by the expert may guide a versioned presentation or
method preference; patient facts must not leak into the reusable preference.

Separate three layers:

- **common behavior** — ingestion, persistence, background preparation,
  conflict and recovery semantics;
- **personal method** — structure, wording, density, reasoning and examples;
- **presentation** — layout, visibility, ordering and complexity.

A density or layout adjustment should not require new application code. A novel
interactive capability may.

## The Clinic tracer case

The first valuable clinical behavior described by the expert is not "generate
a letter after I ask." It is **have the cardiology letter ready in the doctor's
style before the consultation ends**:

1. New notes or authorized transcription arrive while the doctor works.
2. The system periodically or eventfully processes only relevant changes,
   without interrupting typing.
3. A sufficiently explicit referral intent starts or updates a draft when that
   automation is enabled.
4. Superseded calculations are discarded and late output cannot overwrite a
   human correction.
5. The doctor reviews, edits and validates the draft; preparation never implies
   sending or making the clinical decision.

"Refresh every 30 seconds" is an observed preference and latency target to
test, not the universal workflow primitive. The common block needs incremental
input/version semantics, debouncing, cancellation, last-known-good output and
human-edit protection.

A small co-construction pilot can test usefulness before broad commercial
investment. It does not waive confidentiality, security or applicable legal
obligations, and this document does not determine medical-device status.

## Standard result envelope

A worker should return more than prose:

- user-facing message;
- artifact or View reference;
- status (`queued`, `running`, `blocked`, `completed`, `failed`, or
  `unknown-outcome`);
- evidence and provenance;
- human decision request when blocked;
- optional next action that carries no authority by itself.

Internal reasoning and raw tool traces stay out of the primary transcript.
Short progress is user-facing; inspectable evidence and attributed work live one
level deeper.

## Candidate-to-product loop

```text
expert → user-facing bot → creation Thread → remote creator agent
       → candidate source + preview + checks + evidence
       → expert Keep / Reject → host-authorized activation
       → installed product runtime
```

The current release, approved shadcn blocks, domain-operation contracts,
selected examples and relevant preferences enter the candidate environment.
Production credentials, unrestricted private records, protected controls and
the active product filesystem do not.

## Questions for the building-block grill

Resolve these one at a time before freezing contracts:

1. Does the first supported creation space include all three forms, or begin
   with documents + interactive tools while preserving record-compatible
   boundaries?
2. What is the minimum semantic contract every block must expose?
3. Which personalization changes are data/configuration, method/behavior, or
   candidate code?
4. What event and version contract supports incremental background work without
   overwriting human edits?
5. Which shadcn components are admitted initially, and how does a missing
   component graduate into the curated set?
6. What exact artifact/View envelope lets chat, canvas and standalone products
   render the same result?
7. When does the front bot do work directly versus create a Thread and delegate?
8. What context-selection and disclosure policy produces a worker brief?
9. Which remote-agent classes exist initially, and what capabilities distinguish
   each?
10. What proof is required before a creator candidate can be kept and activated?

The grill should produce the smallest coherent block set that proves the Clinic
letter case and a structurally different non-clinical case; it should not
promote a universal workflow DSL or component schema without repeat-use
evidence.
