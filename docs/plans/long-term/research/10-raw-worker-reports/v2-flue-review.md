<table>
<thead>
<tr>
<th>claim</th>
<th>verdict</th>
<th>exact quote from the primary source</th>
<th>correction</th>
</tr>
</thead>
<tbody>
<tr>
<td>F1 — “Flue … uses the same harness [pi].”</td>
<td>CONFIRMED</td>
<td>
<code>@flue/runtime@2.0.3/package.json</code>: <code>"@earendil-works/pi-agent-core": "^0.83.0"</code>.
</td>
<td>
Flue 2.0.3 directly depends on pi-agent-core and constructs pi’s <code>Agent</code>. “Same harness” is accurate if the comparison target is also pi-agent-core; it does not imply the surrounding session runtime is the same.
</td>
</tr>
<tr>
<td>F1 — “pi gets an in-memory <code>messages</code> array.”</td>
<td>CONFIRMED</td>
<td>
Shipped runtime, <code>conversation-stream-store-CXwRWonS.mjs:2152-2158</code>: <code>const previousMessages = []</code>; then <code>messages: previousMessages</code> in pi’s <code>initialState</code>.
</td>
<td>
Use: “Flue constructs pi with a process-memory message array, then reconstructs and replaces that array from the canonical record stream when loading or recovering.”
</td>
</tr>
<tr>
<td>F1 — “pi … never persists.”</td>
<td>OVERSTATED</td>
<td>
Shipped runtime, <code>conversation-stream-store-CXwRWonS.mjs:1206</code>: <code>appendCanonical(records) { return this.conversationWriter.append(...); }</code>
</td>
<td>
Pi itself is not the persistence owner, but the Flue session persistently journals pi lifecycle output while pi mutates its in-memory state. Replace with: “pi keeps only live in-memory loop state; Flue independently persists canonical records derived from pi events.”
</td>
</tr>
<tr>
<td>F1 — “a <code>ConversationRecordWriter</code> exists by that exact name.”</td>
<td>CONFIRMED</td>
<td>
Shipped runtime, <code>sql-agent-execution-store-RrAtlpSL.mjs:13</code>: <code>var ConversationRecordWriter = class ConversationRecordWriter</code>.
</td>
<td>
The exact internal class name is real in 2.0.3. It is declared in an internal bundled type chunk and is not a documented public authoring API.
</td>
</tr>
<tr>
<td>F1 — “a <code>ConversationRecordWriter</code> is injected [into pi].”</td>
<td>WRONG</td>
<td>
Shipped runtime constructor: <code>this.conversationWriter = options.conversationWriter</code>; the later pi <code>new Agent({...})</code> options contain no writer.
</td>
<td>
The writer is injected into Flue’s session wrapper, not into pi. Pi receives model, tools, messages, streaming, steering, and rerender callbacks. Replace with: “Flue’s session wrapper receives a <code>ConversationRecordWriter</code> and journals pi events through it.”
</td>
</tr>
<tr>
<td>F1 — “their record stream is the only truth.”</td>
<td>CONFIRMED</td>
<td>
Flue persistence reference: “The stream is the sole authoritative transcript.” (<code>reference/data-persistence-api.md:142</code>)
</td>
<td>
Correct for the transcript. Fold checkpoints and submission rows are caches/bookkeeping or lifecycle ledgers; the canonical stream is the transcript authority. Avoid expanding “only truth” to attachments or pre-stream admission rows.
</td>
</tr>
<tr>
<td>F1 — “Flue solved [the three-owner transcript disagreement].”</td>
<td>OVERSTATED</td>
<td>
Shipped runtime comment: <code>state.messages tracks the run</code>; persistence reference: an adapter “must not model a second transcript.”
</td>
<td>
Flue eliminates a second durable transcript, but it still has a live pi message array, a reduced replay state, and optional fold checkpoints. The defensible claim is one authoritative durable transcript, not literally one representation of conversation state.
</td>
</tr>
<tr>
<td>F2 — “Eleven frameworks agree on what a durable agent record must carry. This is the intersection.”</td>
<td>WRONG</td>
<td>
OpenAI Agents SDK primary docs: “temporarily stores the state in a file”; LangGraph requires a checkpointer; Flue has managed durable admission. These are different contracts, not an intersection.
</td>
<td>
The survey itself classifies the OpenAI SDK durability as absent/app-owned and OpenClaw approval durability as unverified. Several surveyed systems expose no managed admission ledger, canonical stream, or pause record. Replace “intersection” with “a proposed synthesis, drawing mainly from Flue’s ledger/log and eve’s pause protocol.”
</td>
</tr>
<tr>
<td>F2 — the survey count is eleven frameworks.</td>
<td>CONFIRMED</td>
<td>
The field report’s comparison has eight rows and states its prior baseline is “Flue, Vercel eve, and Anthropic Managed Agents.”
</td>
<td>
Eight newly tabulated systems plus three baselines equals eleven. The plan should list them because “eleven” currently hides that three were researched under a different method and that some rows combine SDK plus hosted platform products.
</td>
</tr>
<tr>
<td>F2 — <code>admitted_at</code> is the Flue schema field.</td>
<td>WRONG</td>
<td>
Public Flue receipt type: <code>acceptedAt: string</code>. Adapter input uses <code>acceptedAt: number</code>.
</td>
<td>
Flue’s exact public name is <code>acceptedAt</code>, not <code>admitted_at</code>. The plan may choose its own snake_case schema, but must label it as a local design mapping rather than a field shared by the frameworks.
</td>
</tr>
<tr>
<td>F2 — admission occurs before model work.</td>
<td>CONFIRMED</td>
<td>
Flue durability guide: “recorded durably before any model work begins.” (<code>guide/durability.md:11</code>)
</td>
<td>
This is a real Flue guarantee. It is not an eleven-framework intersection: local OpenAI SDK runs and bare Mastra agent calls do not document the same managed admission boundary.
</td>
</tr>
<tr>
<td>F2 — <code>idempotency_key</code> is real and public in Flue.</td>
<td>CONFIRMED</td>
<td>
Shipped public declaration, <code>types-CVx9SjIx.d.mts:278</code>: <code>idempotencyKey?: string;</code>
</td>
<td>
The prior report’s conclusion that the field is absent from the public API is refuted by the shipped 2.0.3 declarations. The exact Flue spelling is camelCase <code>idempotencyKey</code>, scoped to <code>(agent, id)</code>, maximum 256 characters.
</td>
</tr>
<tr>
<td>F2 — the Flue agent-api reference documents <code>idempotencyKey</code>.</td>
<td>WRONG</td>
<td>
Bundled <code>reference/agent-api.md:150-155</code> lists only <code>id</code>, <code>message</code>, <code>initialData?</code>, and <code>uid?</code>.
</td>
<td>
There is a documentation/package inconsistency: channels and events docs use <code>idempotencyKey</code>, and shipped public types implement it, but the agent-api page omits it. Correction: public in the package, missing from that reference page—not absent from Flue.
</td>
</tr>
<tr>
<td>F2 — Flue’s keyed dispatch guarantees “at most one answer.”</td>
<td>CONFIRMED</td>
<td>
Shipped type doc: “message is delivered and answered at most once.” (<code>types-CVx9SjIx.d.mts:270-273</code>)
</td>
<td>
This is scoped to identical replay of a caller-chosen key for one <code>(agent, id)</code>. Reusing the key with a different payload conflicts; retrying a failed outcome requires a fresh key.
</td>
</tr>
<tr>
<td>F2 — <code>incarnation</code> is a real Flue concept.</td>
<td>CONFIRMED</td>
<td>
Persistence API: <code>createStream</code> is “minting a fresh incarnation id.” (<code>reference/data-persistence-api.md:171</code>)
</td>
<td>
Yes. The stream claim carries an <code>incarnation</code>, and the instance’s public <code>uid</code> names that incarnation for conditional sends.
</td>
</tr>
<tr>
<td>F2 — <code>incarnation</code> means “which process generation served [a submission].”</td>
<td>WRONG</td>
<td>
Shipped record type: the <code>uid</code> is “constant for the incarnation’s whole life.” (<code>attachment-store-CukHsFkd.d.mts</code>)
</td>
<td>
An incarnation is the lifetime of a created agent instance/stream, not an execution process generation and not a per-submission field. Process/attempt fencing uses <code>ownerId</code>, <code>attemptId</code>, leases, <code>producerId</code>, and <code>producerEpoch</code>. Replace the schema comment accordingly.
</td>
</tr>
<tr>
<td>F2 — submission status is only <code>queued | running | settled</code>.</td>
<td>OVERSTATED</td>
<td>
Flue persistence reference: <code>queued → running → (terminalizing →) settled</code>, with <code>joining</code>/<code>joined</code> for absorbed deliveries.
</td>
<td>
The three values are a coarse projection, not Flue’s actual lifecycle. If the local schema intentionally hides coordination states, say so; otherwise include <code>terminalizing</code>, <code>joining</code>, and <code>joined</code> or separate public state from internal state.
</td>
</tr>
<tr>
<td>F2 — every framework’s submission carries <code>tenant/workspace</code>.</td>
<td>WRONG</td>
<td>
Flue’s <code>AgentDispatchRequest</code> fields are <code>id</code>, <code>message</code>, <code>initialData?</code>, <code>uid?</code>, and <code>idempotencyKey?</code>.
</td>
<td>
Flue intentionally supplies no tenant/workspace field or authorization layer. Tenant scope is application middleware and chosen instance identity. This field may be required by boring-ui, but it is not part of the claimed framework intersection.
</td>
</tr>
<tr>
<td>F2 — the canonical record stream is append-only.</td>
<td>CONFIRMED</td>
<td>
Flue persistence reference: “Canonical records are never updated or rewritten.” (<code>reference/data-persistence-api.md:203</code>)
</td>
<td>
Correct for Flue’s canonical stream. Settlement rows, fold checkpoints, leases, and other operational projections do mutate; do not describe the entire persistence system as one append-only table.
</td>
</tr>
<tr>
<td>F2 — every record carries an opaque <code>cursor</code>.</td>
<td>WRONG</td>
<td>
Flue append signature returns <code>Promise&lt;{ offset: string }&gt;</code> for a batch; <code>ConversationRecordEnvelope</code> has no cursor/offset field.
</td>
<td>
Flue’s opaque <code>offset</code> belongs to an atomic append batch and read position, not each record. Replace with: “append batches receive opaque ordered offsets; records have stable ids and timestamps.”
</td>
</tr>
<tr>
<td>F2 — Flue’s offset is opaque.</td>
<td>CONFIRMED</td>
<td>
Persistence reference: “Offsets are opaque strings ordered by the stream.” (<code>reference/data-persistence-api.md:179</code>)
</td>
<td>
Correct, but call it an <code>offset</code> when attributing the concept to Flue. Applications should not fabricate it with sequence arithmetic.
</td>
</tr>
<tr>
<td>F2 — Flue has “one append-only stream per session.”</td>
<td>OVERSTATED</td>
<td>
Persistence reference calls these “canonical per-agent-instance conversation streams”; record envelopes separately contain <code>harness</code> and <code>session</code>.
</td>
<td>
The physical canonical stream is keyed per agent instance and can carry named conversation scopes/sessions, including child conversations. The public default agent submission targets the default harness/session. Replace “per session” with “per agent instance, with session scope on records.”
</td>
</tr>
<tr>
<td>F2 — Flue has “one store per session” on Node.</td>
<td>WRONG</td>
<td>
<code>PersistenceStores</code> contains <code>submissionStore</code>, <code>conversationStreamStore</code>, and <code>attachmentStore</code>.
</td>
<td>
Node opens one adapter/database for the runtime and that adapter serves many instances; it exposes three logical stores. Per-conversation ownership is required, but physical per-session storage is not. The plan confuses ownership/stream identity with store topology.
</td>
</tr>
<tr>
<td>F2 — “one store per session” holds on Cloudflare.</td>
<td>OVERSTATED</td>
<td>
Durability guide: “every agent conversation is a Durable Object with its own SQLite storage.” (<code>guide/durability.md:137</code>)
</td>
<td>
Cloudflare is structurally per agent conversation/instance, not necessarily per nested session. This target-specific physical isolation cannot be generalized to Node’s shared adapter.
</td>
</tr>
<tr>
<td>F2 — one live owner per conversation is a Flue contract.</td>
<td>CONFIRMED</td>
<td>
Node guide: “One live owner per conversation.” (<code>guide/durability.md:131</code>)
</td>
<td>
Correct and distinct from “one store per session.” Node requires affinity and non-overlapping ownership even with a shared database; Cloudflare gets single ownership from the Durable Object model.
</td>
</tr>
<tr>
<td>F2 — a generic <code>pause</code> record is part of Flue’s canonical record union.</td>
<td>WRONG</td>
<td>
The shipped <code>ConversationRecord</code> union lists messages, tool outcomes, settlement, state, compaction, lifecycle, data, metadata, steps, and resource snapshots—no pause or approval record.
</td>
<td>
Flue 2.0.3 has no framework-generic durable human-input pause record. Approval can be modeled in application state/tools, but the displayed <code>pause</code> schema comes from the proposed system/eve-style protocol, not Flue or the eleven-framework intersection.
</td>
</tr>
<tr>
<td>F3 — “at-least-once execution over exactly-once recording” is verbatim Flue wording.</td>
<td>CONFIRMED</td>
<td>
Flue durability guide: “at-least-once execution over exactly-once recording.” (<code>guide/durability.md:39</code>)
</td>
<td>
The document preserves the wording exactly, except it drops Flue’s preceding qualifier “The overall discipline is.” Keep the phrase, but retain the adjacent warning that external effects may repeat.
</td>
</tr>
<tr>
<td>F4 — “admit durably before any model work” is a verbatim quote.</td>
<td>OVERSTATED</td>
<td>
Exact Flue wording is “recorded durably before any model work begins.” (<code>guide/durability.md:11</code>)
</td>
<td>
The plan is a faithful paraphrase, not verbatim. If quotation-level precision matters, use Flue’s sentence fragment or write “durably record the payload before model work begins.”
</td>
</tr>
<tr>
<td>F4 — “exactly one terminal outcome per submission” is a Flue guarantee.</td>
<td>CONFIRMED</td>
<td>
Flue durability guide: “exactly one durable terminal outcome.” (<code>guide/durability.md:13</code>)
</td>
<td>
Correct as a concise paraphrase. The complete outcome set is <code>completed</code>, <code>failed</code>, or <code>aborted</code>, recorded as <code>submission_settled</code>.
</td>
</tr>
<tr>
<td>F5 — “An interrupted side effect is surfaced as unknown, never silently retried.”</td>
<td>OVERSTATED</td>
<td>
Flue says an “unresolved ordinary call is not re-executed.” (<code>guide/durability.md:37</code>)
</td>
<td>
This is true only for unresolved ordinary tools. It is not a universal statement about all side effects, event hooks, durable tools, delegated tasks, or model calls. Add the word “ordinary tool call.”
</td>
</tr>
<tr>
<td>F5 — durable tools are also converted to unknown outcomes.</td>
<td>WRONG</td>
<td>
Flue durable-tools section: <code>recovery re-executes the call instead of marking it interrupted</code>.
</td>
<td>
<code>durable: true</code> tools re-run their wrapper and replay already-recorded <code>step.do</code> values. The first unfinished step may execute again. Replacement wording: “Unresolved ordinary tools become unknown; durable tools and delegated tasks resume under their own replay rules.”
</td>
</tr>
<tr>
<td>F5 — Flue guarantees external side effects themselves exactly once.</td>
<td>WRONG</td>
<td>
Flue warns: “an effect at the boundary can repeat.” (<code>guide/durability.md</code>, External side effects)
</td>
<td>
Exactly-once applies to durable recording, not arbitrary external commits. <code>step.do</code> is also exactly-once-recorded and at-least-once-executed. External systems still need stable idempotency keys.
</td>
</tr>
<tr>
<td>F6 — “Of eleven frameworks, only two ship a tenancy model.”</td>
<td>OVERSTATED</td>
<td>
OpenAI documents organizations/projects with project owners and members; Cloudflare documents per-ID isolation and tenant routing; Mastra and LangGraph add the strongest resource authorization layers.
</td>
<td>
The count becomes two only after silently defining “tenancy model” as built-in or programmable per-agent/resource authorization. Broader platform tenancy has more than two counterexamples. State the criterion: “Only Mastra FGA and LangGraph Platform custom auth expose verified resource-level agent/workflow authorization in this survey.”
</td>
</tr>
<tr>
<td>F6 — Mastra’s tenancy/FGA layer is paywalled.</td>
<td>CONFIRMED</td>
<td>
Mastra repository: “These features require a valid enterprise license for production use.” (<a href="https://github.com/mastra-ai/mastra">primary source</a>)
</td>
<td>
Mastra’s relevant implementation lives under <code>ee/</code> and is source-available for development/testing but requires an enterprise license in production. “Paywalled” is colloquial; “production use requires a Mastra Enterprise license” is precise.
</td>
</tr>
<tr>
<td>F6 — LangGraph Platform’s custom tenancy/auth layer is paywalled.</td>
<td>WRONG</td>
<td>
LangChain auth docs: “Custom auth is supported for all plans in LangSmith.” (<a href="https://docs.langchain.com/langsmith/auth">primary source</a>)
</td>
<td>
The document directly contradicts the primary source. Managed deployment/compute may be metered and self-hosting is enterprise, but custom authentication and per-resource authorization are not accurately described as enterprise-paywalled. Replace with: “LangGraph Platform custom auth is supported on all LangSmith plans; hosting and deployment have separate pricing.”
</td>
</tr>
<tr>
<td>F6 — both Mastra and LangGraph charge for tenancy because tenancy itself is what the field monetizes.</td>
<td>WRONG</td>
<td>
LangChain’s official pricing includes a zero-seat-cost Developer plan, while its auth page says custom auth supports all plans.
</td>
<td>
The rhetorical conclusion fails once LangGraph’s premise fails. Mastra monetizes its EE authorization implementation; LangGraph makes custom auth available across plans and monetizes hosting/usage/team features separately.
</td>
</tr>
<tr>
<td>F6 — no other surveyed framework offers tenancy primitives.</td>
<td>WRONG</td>
<td>
OpenAI’s platform has project roles and project-scoped service accounts; Cloudflare has isolated Durable Object identities plus request auth hooks.
</td>
<td>
Those are weaker than a built-in per-agent membership graph, but they are genuine tenancy primitives. The report itself classified OpenAI and Cloudflare as partial rather than absent. Use a tiered comparison: platform roles/isolation, programmable per-resource authorization, and full membership/entitlement model.
</td>
</tr>
<tr>
<td>F7 — “stale answers never authorize the original call” originates in the field generally.</td>
<td>WRONG</td>
<td>
The cited mechanism belongs to Vercel eve’s request-id-matched pending-input protocol, specifically its stale-input-response handling.
</td>
<td>
Attribute it to eve. The prior report says stale approval/question payloads are demoted to ordinary user input when their exact request id is no longer pending. This is not established as a shared eleven-framework invariant.
</td>
</tr>
<tr>
<td>F7 — eve’s stale-answer behavior was fully verified from primary source in the supplied research.</td>
<td>UNVERIFIABLE</td>
<td>
The supplied source report itself says: “the indexed blob body for <code>harness/stale-input-responses.ts</code> was unavailable.”
</td>
<td>
The owning framework and intended behavior are strongly identified by adjacent tests/files, but the report admits the decisive source body was unavailable. Do not elevate that secondary reconstruction to an unqualified field law without pinning a commit and quoting the actual implementation/test.
</td>
</tr>
<tr>
<td>F7 — eve’s stale-answer rule generalizes fairly to LangGraph.</td>
<td>WRONG</td>
<td>
LangGraph docs: “Matching is strictly index-based.” (<a href="https://docs.langchain.com/oss/javascript/langgraph/interrupts">primary source</a>)
</td>
<td>
LangGraph resumes interrupts by task/order (or explicit interrupt-id maps for parallel interrupts), restarts the node, and does not document eve’s “demote stale response to ordinary user message” rule. The safe design principle is good; the attribution as field consensus is not.
</td>
</tr>
<tr>
<td>F7 — eve’s stale-answer rule generalizes fairly to OpenAI Agents SDK.</td>
<td>OVERSTATED</td>
<td>
OpenAI docs: pending calls are resolved with <code>state.approve(interruption)</code> or <code>state.reject(interruption)</code>. (<a href="https://openai.github.io/openai-agents-js/guides/human-in-the-loop/">primary source</a>)
</td>
<td>
OpenAI scopes a normal approval to a specific interruption/call, which supports one-shot intent, but its docs do not state eve’s stale-response demotion behavior. Say “several systems bind approval to a pending call,” not that all demote stale answers identically.
</td>
</tr>
<tr>
<td>F8 — “approval as one-shot capability” is an eleven-framework consensus.</td>
<td>OVERSTATED</td>
<td>
OpenAI offers both per-call approval and <code>alwaysApprove</code>; LangGraph accepts a resume value; Cloudflare resumes a waiting workflow.
</td>
<td>
One-shot, call-bound authorization is a strong local design choice and is supported by eve/OpenAI per-call patterns. It is not the only field semantic: sticky approvals, generic resume values, and workflow-level approval events also exist.
</td>
</tr>
<tr>
<td>F8 — “OTel redacted by default.”</td>
<td>WRONG</td>
<td>
Flue observability guide: “both trace adapters capture conversation content by default.” (<code>guide/observability.md:198</code>)
</td>
<td>
This is the reverse of Flue’s documented default. Use <code>content: false</code> for content-free spans or a transform for redaction. Sentry has a different posture, but the plan explicitly says OTel.
</td>
</tr>
<tr>
<td>F8 — runtime <code>observe()</code> is the appropriate Flue metering/telemetry source.</td>
<td>CONFIRMED</td>
<td>
Flue observability guide: “Telemetry, metering, and error reporting belong on the runtime stream.”
</td>
<td>
The L5 direction is supported. Keep operational events distinct from the per-conversation SDK <code>observe()</code>, which materializes durable UI state.
</td>
</tr>
<tr>
<td>F8 — “our capability model beats both” Mastra and LangGraph.</td>
<td>UNVERIFIABLE</td>
<td>
No primary framework source can establish a comparative claim about the audited local capability model.
</td>
<td>
Convert this to an explicit rubric and evidence table: structural filesystem/process confinement, request authentication, per-resource authorization, entitlement discovery, revocation latency, delegation, and auditability. As written it is an unsupported conclusion.
</td>
</tr>
<tr>
<td>F8 — Flue’s public schema has one <code>recorded_at</code> field matching the plan.</td>
<td>OVERSTATED</td>
<td>
<code>ConversationRecordEnvelope</code> uses <code>timestamp: string</code>; creation records also use <code>createdAt</code>.
</td>
<td>
Again, snake_case may be the local schema, but it is not Flue’s exact field vocabulary. Mark all renamed fields as design translations so readers can distinguish sourced mechanics from the proposed API.
</td>
</tr>
</tbody>
</table>

## Most serious problems

### 1. The claimed eleven-framework “intersection” is fabricated

The displayed schema is a design proposal, not an empirical intersection.

The survey contains frameworks with:

- no managed durable admission boundary;
- application-owned rather than framework-owned checkpoint persistence;
- no canonical append-only conversation journal;
- no framework pause record;
- no idempotency key for a whole agent run;
- and no terminal settlement contract comparable to Flue’s.

The claim therefore overstates both breadth and agreement.

It also mixes distinct layers:

- Flue’s submission ledger and canonical stream;
- eve’s request-id-aware human-input protocol;
- platform-level organization/workspace identity;
- and the plan’s own desired tenant and approval fields.

Replacement wording:

> Proposed boring-ui record schema, synthesized primarily from Flue’s accepted-work ledger and canonical stream, plus eve’s request-bound human-input protocol. The surveyed frameworks do not share this full contract.

### 2. “Both paywall tenancy” is false for LangGraph

Mastra’s relevant <code>ee/</code> authorization code does require an enterprise license for production use.

LangChain’s primary documentation says custom auth is supported for all LangSmith plans.

Self-hosted LangSmith is an enterprise add-on and hosted deployment/compute is priced, but that does not make custom per-resource authorization an enterprise-only feature.

The document’s larger thesis—“tenancy is what the field charges for”—therefore does not follow from its own two examples.

Replacement wording:

> Mastra’s production FGA implementation is enterprise-licensed. LangGraph Platform supports custom authentication and per-resource authorization across LangSmith plans, while charging separately for deployment, compute, team, and self-hosting features.

### 3. <code>incarnation</code> is assigned the wrong semantics

Flue’s incarnation identifies a created agent instance/stream lifetime.

Its public <code>uid</code> is minted at birth and remains constant for that incarnation.

It does not mean “which process generation served a submission.”

Execution and writer generations are represented by attempt ids, owner ids, leases, producer ids, and producer epochs.

Putting <code>incarnation</code> on every submission with the plan’s comment would encode the wrong invariant and invite incorrect recovery/fencing logic.

Replacement wording:

> <code>instance_uid</code> — immutable identity of this created instance lifetime; <code>attempt_id</code>/<code>owner_epoch</code> — execution ownership and fencing for a particular attempt.

### 4. The side-effect recovery rule loses Flue’s decisive qualification

Unknown-outcome repair applies to unresolved ordinary tools.

Durable tools re-execute and replay completed <code>step.do</code> records.

Delegated tasks resume from their own durable transcripts.

Event hooks and the first unfinished durable step may execute more than once.

External effects are never made exactly-once merely because the record is exactly-once.

Replacement wording:

> On recovery, unresolved ordinary tool calls become explicit unknown outcomes and are not blindly retried. Durable tools and delegated tasks resume under their documented replay rules; all external effects still require idempotency.

### 5. “One store per session” conflates three different things

Flue distinguishes:

- one live owner per conversation;
- one canonical physical stream per agent instance;
- and three logical persistence stores supplied by a Node adapter.

Node commonly shares one database/adapter across many agent instances.

Cloudflare gives each agent conversation Durable Object SQLite, but that target-specific topology still is not “one store per nested session.”

Replacement wording:

> One authoritative canonical stream per agent instance, with session scope on records; one live owner per conversation; physical storage topology remains target-specific.

### 6. The cursor schema does not match Flue

Flue records have ids and timestamps but no cursor field.

An opaque ordered offset is assigned to an atomic append batch.

Several records can share the same batch offset.

This matters for atomic tool-result/state commits and for correct resume semantics.

Replacement wording:

> Append records atomically in batches. Each committed batch receives an opaque ordered offset; clients resume strictly after a returned offset and never derive offsets arithmetically.

### 7. The plan reverses Flue’s telemetry content default

The plan says “OTel redacted by default.”

Flue says its two trace adapters capture conversation content by default.

Prompts, outputs, tool definitions, arguments, and results can flow to the configured backend once instrumentation is installed.

Content-free capture requires <code>content: false</code>; selective redaction requires a transform.

This is not editorial trivia—it is a data-governance and potentially security-relevant default.

Replacement wording:

> OTel content capture must be explicitly disabled or redacted in configuration; add a boring-ui wrapper that defaults to <code>content: false</code> if redaction-by-default is the desired policy.

### 8. The stale-approval principle is useful but misattributed as field consensus

The specific “detect stale request id, demote response to ordinary user input” behavior is attributed to eve.

The supplied source report admits it could not read the decisive implementation file body.

Other frameworks use different correlation/resume models:

- OpenAI normally resolves a specific pending interruption, with optional sticky approval;
- LangGraph uses interrupt ids/order-indexed resume values and restarts the node;
- Cloudflare resumes a waiting workflow via an external approval/rejection event.

The local safety invariant is still worth adopting, but it should be presented as a deliberate design choice.

Replacement wording:

> Bind every approval to the exact pending request id and canonical action arguments. Once that request is no longer pending, an answer cannot authorize it; a fresh action requires a fresh request.

### 9. The idempotency conclusion is right for the package but the documentation state is misstated

The prior report correctly found that the bundled agent-api markdown omits <code>idempotencyKey</code>.

It incorrectly inferred that the field is absent from Flue’s public API.

The shipped 2.0.3 declaration publicly exposes <code>idempotencyKey?: string</code>, and runtime code derives keyed submission identity from it.

The real finding is documentation drift between the reference page and the shipped package.

Replacement wording:

> Flue 2.0.3 publicly supports <code>idempotencyKey</code> in its package types and runtime; the bundled agent-api page is stale and omits it.

### 10. The Flue/pi description is directionally right but too compressed

The exact <code>ConversationRecordWriter</code> exists.

Pi is constructed with a live in-memory message array.

However, the writer is injected into Flue’s session wrapper, not pi.

Flue then subscribes to pi events, writes canonical records, reduces the log, reconstructs pi messages on recovery, persists tool outcomes, and performs compaction/retry/repair outside pi.

Replacement wording:

> Flue keeps pi as an in-memory turn engine. A Flue session wrapper owns the <code>ConversationRecordWriter</code>, journals pi events into the sole authoritative durable transcript, and reconstructs pi state from that transcript after interruption.

## Primary sources checked

- <code>@flue/runtime@2.0.3</code> shipped <code>dist/*.mjs</code> and <code>*.d.mts</code>, especially the session bundle, conversation writer, record types, and public dispatch types.
- <code>@flue/cli@2.0.3</code> offline <code>guide/durability</code>, <code>guide/database</code>, <code>guide/node-target</code>, <code>guide/observability</code>, <code>reference/agent-api</code>, and <code>reference/data-persistence-api</code>.
- <a href="https://github.com/mastra-ai/mastra">Mastra repository licensing statement</a> and <a href="https://github.com/mastra-ai/mastra/blob/main/LICENSE.md">license mapping</a>.
- <a href="https://docs.langchain.com/langsmith/auth">LangSmith authentication and resource authorization</a> and <a href="https://www.langchain.com/pricing">official pricing</a>.
- <a href="https://docs.langchain.com/oss/javascript/langgraph/interrupts">LangGraph JavaScript interrupts</a>.
- <a href="https://openai.github.io/openai-agents-js/guides/human-in-the-loop/">OpenAI Agents SDK JavaScript human-in-the-loop guide</a>.
- <a href="https://developers.cloudflare.com/agents/concepts/workflows/">Cloudflare Agents workflow approval guide</a>.
- <a href="https://github.com/vercel/eve/blob/main/packages/eve/CHANGELOG.md">Vercel eve changelog</a>; the decisive stale-input implementation body remained unavailable, so that narrow claim stays marked <code>UNVERIFIABLE</code>.
