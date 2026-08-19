# Design inspiration sweep — ranked theft list

## 1. Make every error a projection for two audiences

**Value: 10/10. Adopt now.**

Flue has the cleanest mechanism in this sweep. `FlueError` separates caller-safe fields from operator-only fields at construction time. The caller gets a stable `type`, a safe `message`, safe `details`, and selected `meta`. Local development may additionally receive `dev`. The causal exception stays server-side. An unknown exception is projected to `internal_error` with a generic message. The original exception is logged with an `err_…` reference. That reference is returned in both the response body and `flue-error-ref` header. The same reference joins the caller report to the trace and full cause chain. Flue makes the two audiences hard to confuse because `details` and `dev` are distinct constructor fields. Its runtime source even describes them as two deliberately different explanations. The public contract is documented in [Flue error handling](https://flueframework.com/docs/reference/errors/). Our current envelope is superficially similar: `{ error: { code, message, details? } }`. The important difference is at the unknown-error boundary. `piChat.ts` currently uses `err.message` for a generic `Error` while changing only the code to `INTERNAL_ERROR`. That can put a provider message, file path, transport detail, or implementation name on the wire. Our `ErrorLogFieldsSchema` knows about request IDs, but the error response does not reliably return a correlation reference.

### Mechanism to steal

Create one `projectError(error, exposureContext)` funnel. It should return a wire projection and an operator projection from the same classified value. The wire projection should contain `code`, safe `message`, optional safe `details`, optional `action`, and `ref`. The operator projection should contain the original error, cause chain, stack, provider payload, request ID, and trace ID. Unknown exceptions must never donate their message to the wire projection in production. In local development, a separately labelled `developerMessage` may be added. Do not overload `details` as both a safe explanation and a debugging dump. Make the safe/unsafe choice explicit in the type system. Route handlers should be unable to serialize arbitrary `Error` objects.

### Why it works

It makes the security boundary structural rather than dependent on reviewer memory. It gives support a handle the user can actually quote. It lets provider-specific debugging remain rich without turning provider output into product copy. It makes internal failures actionable without pretending the caller can fix them.

### Cost to us

One new normalization boundary. A migration across route-local error writers. Tests proving secrets, paths, provider bodies, and causes do not cross the wire. A log-retention and redaction policy for the operator projection.

### Ratified-decision impact

- D25: no violation; this is a static shared primitive.
- D26 authored-data-not-code: no violation; authored data cannot select exposure policy.
- D27: strongly reinforces credential non-disclosure.
- D28 static fleet: no violation.
- D29: strengthens the single construction funnel if error projection is equally singular.
- D30: no violation.
- D31: no violation; `ref` should be an observation link, not a second state truth.
- Default-deny grants: no violation.

## 2. Turn the error-code registry into executable remediation metadata

**Value: 9.8/10. Adopt.**

Our error registry is already richer than either framework on paper. `ERROR_CODES.md` records the status, suggested client action, log level, and stability of each code. The weakness is that these fields are prose beside the executable schema. `error-codes.ts` contains the code enum and payload schema, but not the operational policy. Routes still choose status and messages locally. Retryability appears in some chat events but is not part of the common API error payload. Flue improves on this by letting typed HTTP errors own status and headers. Eve improves on it differently through a semantic-error catalog. Eve’s rules map arbitrary thrown errors into stable summaries and remediation-oriented categories. The raw failure goes to `.eve/logs`; the transcript receives a compact actionable error. Failure events receive a stable `semanticErrorId` for correlation. This is described in the [eve changelog](https://github.com/vercel/eve/blob/main/packages/eve/CHANGELOG.md).

### Mechanism to steal

Define a host-owned `ERROR_CATALOG` keyed by the public code. Each entry should declare:

- default safe message;
- HTTP status where HTTP applies;
- audience classification;
- retry class: never, immediate, backoff, or user-action;
- client action token;
- log severity;
- stability level;
- whether details are permitted and under which schema;
- whether the failure may settle accepted work;
- documentation anchor. Derive the Zod enum, documentation table, response helper, and parity test from that catalog. Keep contextual wording supplied by typed parameters, not arbitrary route prose. Do not force an inheritance class for every code. A discriminated object catalog is cheaper and fits our TypeScript surface better.

### Why it works

The registry stops being a promise that implementations can accidentally contradict. Clients can build deterministic UX from an action token instead of parsing English. Reviewers can see immediately whether a new error is public, retryable, and stable. Documentation drift becomes a build failure.

### Cost to us

Catalog migration for every existing code. Deciding ambiguous historical statuses and retry semantics. Generated-doc machinery and snapshot tests. Client coordination if `action` becomes a new stable wire field.

### Ratified-decision impact

- D25: no violation.
- D26: no violation if the catalog remains trusted host code.
- D27: reinforces fail-closed behavior through explicit audience metadata.
- D28: no violation; catalog is deployment-static.
- D29: reinforces the single funnel.
- D30: no violation.
- D31: no violation; errors remain events or projections of events.
- Default-deny grants: no violation.

## 3. Ship breaking changes as a machine-checked compatibility boundary

**Value: 9.6/10. Adopt before the next break.**

Flue’s migration guide is unusually candid and concrete. It pairs old and new code, names removals, and ends with an ordered checklist. It explicitly says when no framework replacement exists. It also declares a persisted-format jump from version 5 to 8. The runtime rejects incompatible stored state before application code runs. Operators must drain and delete old Durable Object classes or export and reseed data. That is harsh, but it prevents partial interpretation of old state. See [Migrating to Flue 2.0](https://flueframework.com/docs/guide/migration/). Eve has different useful pieces but no equally strong migration narrative. Its 0.x changelog calls out breaking removals such as `dispose()` becoming required `shutdown()`. It bumps the event-stream schema when the stream changes. It enforces peer ranges for mounted extensions. It fails boot for an incompatible bundled workflow version with an actionable error. It also tolerates older remote `/eve/v1/info` shapes by omitting unknown data instead of killing the connection. Neither project exposes a serious codemod or comprehensive upgrade command in the material inspected. Neither has source-attributed runtime deprecations as a general system. Flue has one process-once warning for `createSessionEnv`, but it only says what to rename.

### Mechanism to steal

Add a versioned compatibility manifest to every release that changes a durable or public contract. The manifest should name:

- source API breaks;
- configuration schema breaks;
- wire-schema breaks;
- persisted-state breaks;
- grant-policy changes;
- fleet-definition changes;
- default changes;
- whether automatic migration exists;
- the first version that rejects the old form. Add `boring upgrade check` or its repository-local equivalent. It should inspect code, config, stored schema metadata, and deployed version metadata without mutating them. Emit precise file-and-symbol diagnostics for detectable source changes. Supply codemods only for syntax-preserving transformations. Require an explicit operator acknowledgement for destructive or semantic migrations. At startup, reject unsupported persisted versions before an agent can observe them. Use versioned readers or an offline migration for data we promise to retain. Never silently reinterpret old state under a new schema.

### Why it works

“Breaking changes are allowed” becomes an engineering contract rather than permission to surprise users. The check separates syntactic toil from decisions that genuinely require judgment. The state gate prevents split-brain semantics across a rolling deployment. The manifest gives release notes a testable source of truth.

### Cost to us

An owned compatibility version for each public layer. Upgrade-check infrastructure and fixtures for old releases. Maintenance of bounded compatibility windows. Migration tooling for any durable data we cannot discard. Release discipline: every break must declare itself.

### Ratified-decision impact

- D25: no violation.
- D26: no violation; the manifest describes trusted contracts.
- D27: grant-policy changes must fail closed rather than inherit permissive behavior.
- D28: reinforces full validation before serve.
- D29: compatibility checks belong before the one construction funnel opens traffic.
- D30: no violation.
- D31: strongly relevant; event-log schema changes need versioned folds or offline migration.
- Static fleet: compatible if upgrade is deployment-time, not a live registry.
- Default-deny grants: compatible only if missing new grants stay denied.

## 4. Adopt a canonical lifecycle vocabulary and enforce it in APIs

**Value: 9.4/10. Adopt as part of the breaking-change window.**

Eve’s strongest design contribution may be its lifecycle nouns. A **session** is the durable conversational identity. A **turn** is one user-input work unit. A **step** is one model call within the turn. An **action** is a tool invocation within a step. An **event** records observable progress. The hierarchy reads naturally without requiring implementation knowledge. The current contract is documented in [Sessions, runs, and streaming](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md). Flue’s vocabulary is strongest after admission. A **submission** is accepted work with a durable ID. A **settlement** is its terminal durable result. An **instance** is runtime placement, not the user conversation. That makes “accepted” and “finished” separate facts. Our surface has accumulated collisions that now carry architectural risk. `AgentHost` was rejected as machinery by D25–D28, then reappeared as the name `createAgentHost()` in D29. The decision says the semantics differ, but users see the noun before they see the footnote. `session` can mean the product conversation, a Pi transcript/session, a harness live handle, or a gateway session. `agent` is qualified as type, ID, application, binding, definition, deployment, seat, and persona. `capability` is sometimes a broad feature and sometimes an authority-bearing object. `complete`, `finish`, `settle`, and `close` risk describing the same terminal transition.

### Mechanism to steal

Ratify this public vocabulary:

- **Agent type**: one deployment-static executable fleet member.
- **Authored source**: inert metadata and instructions associated with an agent type.
- **Agent binding**: a workspace-scoped authorization to use an agent type at a fleet generation.
- **Session**: the durable conversation/event-log identity.
- **Turn**: one accepted user or command cycle within a session.
- **Submission**: the durable receipt for accepted asynchronous work.
- **Attempt**: one execution try, which may be retried without changing submission identity.
- **Settlement**: the durable terminal fact for a submission.
- **Step**: one model inference within an attempt.
- **Tool call**: one model-requested operation.
- **Tool**: a model-callable operation.
- **Capability**: an unforgeable authority; never a synonym for tool.
- **Skill**: a loadable authored instruction package.
- **Instruction**: prompt material, whether always-on or skill-loaded.
- **Admit**: validate authority and durably accept work.
- **Dispatch**: route admitted work to an executor.
- **Execute**: perform an attempt.
- **Settle**: write the terminal durable fact.
- **Complete**: the successful settlement outcome, not the generic terminal verb. Rename `createAgentHost()` before it hardens, preferably to `createAgentGateway()`. Keep Pi-native and harness session handles internal and qualify them in code. Do not add **conversation** as a second public synonym for session. Do not use **run** without a qualifier; use attempt, turn, or submission.

### Why it works

Names expose the state machine before documentation does. Separating submission from attempt makes retries comprehensible. Separating tool from capability prevents authority from sounding like mere feature discovery. Removing `AgentHost` avoids reviving a rejected architecture through linguistic drift.

### Cost to us

A public rename and compatibility aliases where required. Documentation, telemetry, event names, tests, and client types must move together. Some names will remain temporarily doubled during migration. A lint rule or API review checklist is needed to keep the vocabulary closed.

### Ratified-decision impact

- D25: reinforces the refusal of registry/controller-style AgentHost semantics.
- D26: clarifies authored source versus executable agent type.
- D27: gives capability its authority-bearing meaning.
- D28: makes static fleet identity explicit.
- D29: requires renaming the chosen construction-funnel function; this changes the letter, not the intent.
- D30: reinforces that hostname is presentation, not an agent binding.
- D31: makes session/event-log identity unambiguous.
- Default-deny grants: reinforced by reserving capability for granted authority.

## 5. Add a host-side semantic classifier as a fallback, never as the source of truth

**Value: 9.0/10. Adopt with a hard boundary.**

Eve assumes third-party providers, workflows, and sandboxes will throw errors it did not author. Its semantic-error catalog applies declarative, linter-like rules to escaping exceptions. Rules recognize families such as gateway, provider, workflow, sandbox, and system failures. The user transcript receives a stable actionable summary. The private diagnostic log keeps the raw error. The event carries a stable correlation ID. This retrofits decent UX onto code that cannot be forced into a common subclass hierarchy. The useful move is classification at the boundary, not the particular regexes. The dangerous move would be treating pattern matching as canonical semantics. The documented eve wire still exposes mainly `{ code, message, details? }` for `step.failed` and `turn.failed`. Provider/developer/user/internal origin is not a documented first-class wire discriminator. The classification distinction therefore reaches the transcript and correlation path, but only partially reaches the wire.

### Mechanism to steal

First prefer typed errors produced by our own boundaries. Then inspect provider SDK error classes and stable machine fields. Only then apply bounded semantic rules to unknown errors. Each rule should produce:

- our stable code;
- origin: caller, authored-config, provider, platform, or internal;
- a safe message template;
- a remediation action;
- confidence;
- redaction instructions;
- the matching rule ID. Low-confidence matches should remain `INTERNAL_ERROR` or `PROVIDER_ERROR`, not claim false precision. Record the rule ID and original type only in operator diagnostics.

### Why it works

Provider errors become actionable before every adapter has perfect typed normalization. It improves the long tail without weakening the primary error contract. Rule IDs make classification changes measurable and reversible.

### Cost to us

A curated ruleset and regression corpus. Ongoing maintenance as providers change wording. False-positive monitoring. Security review for every captured field.

### Ratified-decision impact

- D25: no violation if rules are host-owned and static.
- D26: violation if authored data can add rules or map text to executable behavior; forbid that.
- D27: rules must never echo credential-bearing provider payloads.
- D28: no violation if compiled into the frozen deployment.
- D29: classification belongs inside the one error funnel.
- D30: no violation.
- D31: classification may annotate an event but must not replace the original durable fact.
- Default-deny grants: no violation.

## 6. Make missing-decision behavior explicit and testable

**Value: 8.8/10. Adopt.**

The frameworks do not have one philosophy for defaults. Their actual code paths choose among fail, defer, guess, and degrade. Flue fails when the required application entry is missing. The Vite diagnostic names the expected file and supplies a minimal code sample. Flue fails after render if no model was selected and points directly to `useModel(...)`. Flue defers the sandbox decision: without `useSandbox`, no sandbox environment exists. Shell and file facilities fail only when touched. Optional MCP connection failures warn and remove the associated tools. Target selection can be guessed from the installed deployment plugin. The config schema is strict and reports exact dotted paths for bad fields. Eve requires root instructions but makes `agent.ts` optional. It derives a name from `package.json`, then falls back to the directory name. It supplies a default harness and a default sandbox when neither is authored. It conditionally adds tools according to session context. It ignores unsupported root directories with diagnostics surfaced by `eve info`. Its discovery code is visible in [discover-agent.ts](https://github.com/vercel/eve/blob/main/packages/eve/src/discover/discover-agent.ts).

### Mechanism to steal

Create a reviewed missing-decision table for every configuration and runtime choice. Each choice must be labelled exactly one of:

- **fail** because guessing changes authority, identity, persistence, cost, or external effects;
- **defer** because the capability is optional and absence is safe;
- **derive** because there is one deterministic, non-authoritative value;
- **degrade** because an optional integration failed and its absence is visible;
- **default** because the default is inert, bounded, and documented. Generate tests from the table. Reject unknown security-relevant keys. Never silently drop unknown keys in one command while rejecting them in another. Flue currently does exactly that for `flue run`, which weakens its otherwise excellent strict-config story. For us, a missing grant, credential, agent type, fleet generation, or storage capability must fail. A missing optional display field may derive or default. A missing optional diagnostic integration may degrade with a visible event.

### Why it works

Progressive disclosure stops being a euphemism for inconsistent guessing. Reviewers can reason about every omission using the same safety test. CLI, server, and test harness behavior remain aligned.

### Cost to us

Inventorying every implicit default. Removing a few convenient but unsafe fallbacks. Golden diagnostics across CLI and server entry points.

### Ratified-decision impact

- D25: no violation.
- D26: reinforces failure when authored data attempts executable selection.
- D27: reinforces fail-closed credentials.
- D28: reinforces fail-loud fleet validation and no silent fallback.
- D29: the table should be enforced at the construction funnel.
- D30: requires hostname-derived values to remain cosmetic.
- D31: missing event-log state must not be guessed from caches.
- Default-deny grants: strongly reinforced.

## 7. Build a redacted, first-class support bundle

**Value: 8.6/10. Adopt in a narrower form than eve.**

Eve treats diagnostics as a product surface rather than scattered console output. `eve dev` writes per-process JSONL logs under `.eve/logs/`. The log captures framework, workflow, tool, stdout, and stderr records. Long stderr collapses in the transcript to a one-line pointer. The raw output remains in the private log. `eve logs` can read by ID, filename, prefix, transcript view, or JSON. `--events` interleaves persisted session events when the log is read. An environment dump includes framework, Node, and Vercel versions plus store and session statistics. The result is an inspectable support artifact with stable correlation rather than “paste your terminal.”

### Mechanism to steal

Add `boring diagnostics collect` with an explicit redaction contract. Collect only allowlisted fields:

- application and schema versions;
- fleet generation and static agent type IDs;
- enabled adapter kinds, never credentials;
- recent public error codes and correlation refs;
- event-log integrity and cursor summaries;
- bounded timing and queue statistics;
- configuration key presence, never secret values;
- relevant build hashes. Produce JSON plus a compact human-readable summary. Let the user inspect the bundle before sharing it. Join logs and events by ref at read time rather than duplicating raw event bodies. Keep the operator log and durable session log as distinct surfaces.

### Why it works

Support gets reproducible context without a remote shell. The user can verify exactly what leaves their machine. Correlation becomes a workflow, not a scavenger hunt.

### Cost to us

A redaction schema and adversarial tests. Platform-specific collectors. Versioning the bundle format. Clear retention and deletion behavior.

### Ratified-decision impact

- D25: no violation.
- D26: no violation if the collector is host-owned.
- D27: high implementation risk; credential presence may be reported but values must never be collected.
- D28: no violation; report fleet identity without creating a registry.
- D29: bundle should report whether construction-funnel invariants passed.
- D30: never treat hostname as authority evidence.
- D31: compatible only if events are referenced/read, not copied into a second truth store.
- Default-deny grants: no violation.

## 8. Preserve the last good development generation during reload

**Value: 8.3/10. Adopt for development and staged deploys only.**

Eve gives each development reload a generation. It compiles and starts a candidate before promotion. If candidate startup fails, the previous generation keeps serving. New work uses the latest successfully promoted generation. Already-admitted work remains pinned to the generation that admitted it. This is a small mechanism with unusually good failure semantics. It prevents a syntax error from destroying active local sessions. It also makes code identity explicit for long-running work.

### Mechanism to steal

Assign an immutable generation hash to a validated fleet build. Prepare the candidate off-path. Run complete fleet validation before promotion. Promote atomically for new admissions. Pin every admitted submission to its generation in the durable event. Let old in-flight work drain under its original implementation. In production, allow only deployment-controlled generations. Do not turn this into a mutable runtime fleet registry.

### Why it works

Reload failures become local diagnostics, not availability failures. Long-lived work no longer changes semantics halfway through execution. The generation hash improves incident reconstruction.

### Cost to us

Parallel process or module lifetimes during drain. Generation-aware routing and observability. Resource caps and forced retirement rules for stuck old work. Compatibility policy for events created by an old generation.

### Ratified-decision impact

- D25: production runtime mutation would violate static declarations; immutable deployed generations do not.
- D26: no violation if generations contain only trusted executable code.
- D27: credentials remain invocation-scoped across generations.
- D28: a mutable production generation registry would violate the static fleet; candidate validation plus atomic deployment does not.
- D29: each candidate must pass the one construction funnel before promotion.
- D30: no violation.
- D31: reinforces durable admission identity and replay provenance.
- Static fleet: **conditional**; dev/staged implementation yes, ad hoc production mutation no.
- Default-deny grants: grants must be reevaluated against the pinned generation without widening.

## 9. Use the public error taxonomy for durable settlement too

**Value: 8.1/10. Adopt.**

Flue does not invent a second failure language after work has been accepted. Settlement failures preserve `type`, safe `details`, and selected `meta`. The accepted submission ID correlates the initial 202 response with eventual settlement. Cancellation remains distinct from failure. An aborted durable submission is not confused with a local caller abandoning a wait. That distinction is subtle and excellent. Eve similarly separates `turn.cancelled` from `turn.failed`. Our registry currently spans HTTP and event conditions, but the projection rules are inconsistent. Some diagnostic conditions are represented as error codes despite successful HTTP responses.

### Mechanism to steal

Use one error code catalog across synchronous rejection and asynchronous settlement. Add a context field outside the code: `phase = admission | dispatch | execution | settlement | observation`. Keep terminal outcome separate: `succeeded | failed | cancelled | expired`. Persist the stable code and safe structured details in the event log. Store full causes only in operator diagnostics linked by ref. Distinguish cancellation of a wait from cancellation of the durable submission. Reserve “diagnostic” for non-terminal degradation such as optional discovery failure. Do not label a successful response as an error merely because it contains a warning.

### Why it works

Clients need one remediation model regardless of when a failure occurs. The phase explains where the failure happened without multiplying codes. Cancellation becomes safe to retry or resume according to durable reality.

### Cost to us

Event-schema migration. Reclassification of warning-like historical codes. Client updates for phase and terminal outcome.

### Ratified-decision impact

- D25: no violation.
- D26: no violation.
- D27: durable safe details must exclude credentials.
- D28: no violation.
- D29: consistent admission failures reinforce the funnel.
- D30: no violation.
- D31: strongly reinforces the event log as the single terminal truth.
- Default-deny grants: denied operations settle with a stable authorization failure and no extra disclosure.

## 10. Let the model repair bounded tool failures

**Value: 7.8/10. Adopt selectively.**

Eve returns many tool failures to the model as structured tool results. The turn does not automatically fail. The model can correct arguments, choose another tool, or explain the limitation. When `load_skill` receives a wrong name, the failure lists available names for self-correction. Successful batched calls may collapse in the UI while failed calls remain itemized. That combination reduces terminal failures and keeps the important exception visible.

### Mechanism to steal

Divide tool failures into three classes:

- **repairable**: validation, missing optional input, bounded not-found, transient conflict;
- **user-action**: approval, credential, or explicit policy decision required;
- **terminal/security**: denied grant, invariant breach, suspected exfiltration, corrupted state. Only repairable failures return to the model with safe structured hints. User-action failures pause or settle according to the durable contract. Terminal/security failures stop the attempt. Never reveal unavailable tool names across a grant boundary. List only tools or skills already visible to the current authorized scope. Cap repair attempts and emit their count in events.

### Why it works

The model is often the cheapest place to repair a malformed call. Users see fewer failures that are merely syntax mistakes. Bounded retries avoid hiding a genuinely unavailable capability.

### Cost to us

A repairability field in the error catalog. Per-tool safe hint schemas. Retry budgets and loop detection. Security testing for existence-oracle leaks.

### Ratified-decision impact

- D25: no violation.
- D26: no violation if authored instructions cannot reclassify failures.
- D27: provider or credential details must never become model-visible hints.
- D28: no violation.
- D29: the gateway must filter hints by branded scope on every retry.
- D30: no hostname-derived tool visibility.
- D31: each retry remains an event in the same durable truth.
- Default-deny grants: **high risk but compatible** only when denied and undiscoverable capabilities stay invisible.

## 11. Version the wire as a historical union, not a current fiction

**Value: 7.6/10. Adopt before event schema v2.**

Eve’s stream schema is explicitly versioned. Its current documentation also admits a revealing compatibility hole. Version 20 added `meta.id`. Historical stored events may still lack that field even when current TypeScript types claim it is a string. Those events pass through and cannot be deduplicated by the new ID. Compatibility exposure disappears only when old sessions expire. The honesty is good. The type lie is not worth copying.

### Mechanism to steal

Persist a schema version with every durable event or event-log segment. Expose historical data as a versioned discriminated union. Normalize only when the conversion is lossless and deterministic. Represent absent historical IDs as absent, never fabricated. Publish the minimum readable version and maximum writable version. During rolling deploys, new writers must emit a version all active readers understand. Add fixtures from every retained version to D31 replay proofs.

### Why it works

Types describe the data that actually exists. Rolling upgrades gain a precise compatibility rule. Replay failures surface in CI instead of during recovery.

### Cost to us

Versioned TypeScript unions and readers. Fixture retention. More explicit client handling during compatibility windows.

### Ratified-decision impact

- D25: no violation.
- D26: no violation.
- D27: no violation.
- D28: reinforces pre-serve validation.
- D29: no violation.
- D30: no violation.
- D31: directly required if the log is the single durable truth.
- Static fleet: no violation.
- Default-deny grants: no violation.

## 12. Emit source-attributed deprecations before hard removals

**Value: 7.3/10. Build what neither project finished.**

Flue’s 2.0 guide communicates breaks well after a developer goes looking for it. Its runtime has a one-time warning for `SandboxFactory.createSessionEnv`. The warning says to rename the method but does not identify the authored implementation site. Eve relies mainly on changelog entries and compile failures. Its rapid 0.x releases include hard removals and changed defaults without a general deprecation channel. This is an opportunity to improve on both rather than copy either.

### Mechanism to steal

Represent each deprecation in the compatibility manifest. At build or startup, emit:

- deprecated symbol or configuration path;
- source file and line when recoverable;
- replacement;
- behavior difference, not just a rename;
- first deprecated version;
- planned removal version;
- stable diagnostic code;
- link to migration instructions. Deduplicate warnings by source location, not globally by process. Make CI able to promote selected deprecations to errors. Do not emit runtime warnings for inactive code paths that static analysis can find earlier.

### Why it works

The warning appears where the developer can fix it. Stable codes make warnings searchable and suppressible with accountability. Removal dates turn vague intent into an upgrade schedule.

### Cost to us

Source-map plumbing for runtime-discovered cases. A deprecation lifecycle policy. Maintaining compatibility shims for a bounded interval.

### Ratified-decision impact

- D25: no violation.
- D26: no violation.
- D27: diagnostics must not print authored secret values.
- D28: deprecation checks should run during frozen fleet validation.
- D29: construction-funnel diagnostics gain source attribution.
- D30: no violation.
- D31: persisted-schema deprecations require migration, not warnings alone.
- Default-deny grants: a removed grant must become denied, never inherit a broader replacement.

## 13. Publish a refusal ledger as part of the architecture

**Value: 7.0/10. Adopt.**

Flue’s best philosophy is expressed as what it refuses. An agent is a program, not a static configuration object. The framework refuses closed model, sandbox, hosting, and protocol layers. It prioritizes non-trivial durable work over demo convenience. Flue 2.0 removed framework workflows rather than maintaining a competing orchestration abstraction. Its recommendation is awaited handles, durable tools, or an application-owned orchestrator. See [Why Flue](https://flueframework.com/docs/guide/why-flue/). Eve refuses assembly boilerplate: the agent is the directory. It refuses a separate provisioning experience by treating an agent as an ordinary Vercel project. It refuses requiring `agent.ts`; instructions plus defaults can be sufficient. It also effectively refuses being the deployer’s policy engine. Its docs warn that tools may run without approval and sandbox egress is not deny-all unless the deployer tightens controls. That last refusal is incompatible with our product. The positioning is stated in [Introducing eve](https://vercel.com/blog/introducing-eve) and the [eve docs](https://github.com/vercel/eve/blob/main/docs/README.md).

### Mechanism to steal

Add a concise, ratified “We do not build” ledger beside D25–D31. Candidate refusals:

- no runtime registry or controller for the agent fleet;
- no authored executable selection;
- no credentials in prompts, sessions, files, shell, logs, or durable events;
- no hostname-derived authority;
- no second durable state truth beside the event log;
- no implicit grant widening for convenience;
- no generic workflow DSL until a proven need survives existing primitives;
- no provider-specific error payload on the public wire;
- no compatibility fallback that silently changes identity or authority. Require proposals that cross a refusal to amend the decision explicitly.

### Why it works

Negative space resists feature accretion better than another list of principles. Reviewers can reject an attractive feature without relitigating the architecture. It makes violations visible before implementation effort creates sunk cost.

### Cost to us

The discipline to keep the ledger short. Occasional explicit amendments when evidence changes. Some integrations will be less magical.

### Ratified-decision impact

- D25–D31: codifies their shared negative constraints.
- Static fleet: explicitly reinforced.
- Authored-data-not-code: explicitly reinforced.
- Default-deny grants: explicitly reinforced.
- Violation risk: none unless the ledger accidentally freezes implementation details rather than boundaries.

## 14. Surface discovery mistakes without importing authored code

**Value: 6.7/10. Adopt selectively.**

Eve’s discovery path reads directory entries and builds a manifest without importing the authored modules. It reports unsupported root directories as diagnostics. `eve info` exposes what the framework discovered. Malformed or missing package names degrade to a directory-derived display name. Misplaced `*.eval.ts` files are diagnosed with the offending directory and correct location. This makes convention errors observable without executing the project merely to inspect it.

### Mechanism to steal

Add a read-only `fleet explain` view produced from the same static compiler as deployment. Show:

- accepted static agent type IDs;
- inert authored sources associated with each type;
- ignored files and exact reasons;
- missing required fields;
- duplicate or shadowed declarations;
- grants requested versus grants actually available;
- deployment generation;
- no secret values and no existence outside the caller’s administrative scope. Treat unsupported directories in executable or policy-sensitive namespaces as errors. Treat irrelevant files outside those namespaces as warnings or ignore them. Never import authored modules merely to list their declarations.

### Why it works

Developers can debug discovery without triggering side effects. The explanation uses the exact production compiler, so it does not become a second interpretation. Security-sensitive typos fail loud while harmless clutter remains cheap.

### Cost to us

Structured diagnostics from the fleet compiler. Scope-aware redaction for multi-tenant administration. A stable diagnostic format if IDEs consume it.

### Ratified-decision impact

- D25: reinforces static declarations.
- D26: reinforces inert authored data.
- D27: requested credentials may be described only by opaque identifiers or presence.
- D28: reinforces copied, frozen, fully validated fleet construction.
- D29: must reuse the same compiler/funnel, not create a second composer.
- D30: display hostnames may appear only as pixels.
- D31: no violation.
- Default-deny grants: explanation must not become an existence oracle for unavailable capabilities.

## Error taxonomy and UX — direct comparison

| Question | Flue | eve | ours | Design judgment |
|---|---|---|---|---|
| Stable machine identity | `type` on `FlueError` and settlement error | `code`, plus semantic rule/correlation IDs | documented `code` enum | All three have the seed; ours should make policy executable. |
| Safe caller message | Explicitly separate caller `message/details` | semantic summary in transcript; raw log separate | intended, but generic `Error.message` can escape | Flue is the standard to match. |
| Developer detail | `dev` locally; cause never wire | private JSONL log and dump | log fields exist, uneven correlation | Copy the separation, with stricter redaction than eve. |
| User error | Typed 4xx, generally unlogged/no ref | validation and tool errors can be model-repairable | many explicit validation codes | Add common action tokens. |
| Developer/config error | Exact diagnostics for app, model, options, config paths | discovery, eval placement, invalid sentinel diagnostics | startup validation exists across several funnels | Consolidate source attribution. |
| Provider error | typed provider class and selected bounded metadata | semantic provider/gateway classification | provider-specific codes exist | Normalize before projection; never leak raw bodies. |
| Internal error | generic response plus `err_` ref | stable summary plus private diagnostic | `INTERNAL_ERROR`, but message redaction is incomplete | P0 gap in ours. |
| Distinction reaches wire | Yes through stable type/status/meta, though not a universal origin enum | Partially; failure code/message/details and semantic ID, not a documented origin enum | Codes imply origin inconsistently | Add explicit `origin` only if clients need it; action matters more. |
| Async failure | same safe taxonomy in settlement | failed/cancelled session events | mixed event/API representation | Use one catalog plus phase/outcome. |
| Stream failure | envelope cannot repair a response after bytes begin | failure is naturally an event in the stream | streaming paths need the same explicit rule | Persist/emit a terminal event, then close. |

### What makes Flue errors actionable

The code is stable. The public prose is written for the caller. The local `dev` prose is written for the implementer. Typed HTTP errors own transport semantics. Unknown failures return a reference that joins to complete server evidence. Specific diagnostics include the invalid value, valid alternatives, or the exact corrective call. Cancellation and durable abortion are named separately.

### What weakens Flue errors

The caller action remains mostly prose rather than a machine field. The taxonomy does not expose one universal origin classification. Some provider metadata includes a bounded response body; bounded is not the same as safe. Mid-stream failures cannot use the standard HTTP envelope. The class hierarchy can tempt one subclass per case when a catalog would be simpler.

### What makes eve errors actionable

Unknown third-party errors are recognized semantically at a central escape boundary. The transcript receives a compact diagnosis instead of a stack. Raw logs remain queryable by a stable ID. Tool failures can be returned to the model for correction. Discovery mistakes name the ignored location and expected convention. Long output collapses without disappearing.

### What weakens eve errors

The origin distinction is not a clean, documented wire-level enum. Semantic matching can become brittle as dependency wording changes. The support dump’s breadth is dangerous without a strong allowlist. Permissive default execution makes some “user errors” into potentially consequential actions before diagnosis. Rapid breaking changes increase the number of errors that are really version mismatch.

## Breaking changes and upgrades — survivability scorecard

| Mechanism | Flue | eve | What we should do |
|---|---|---|---|
| Dedicated migration guide | Strong beta-to-2.0 guide | No equivalent found | Require one for every supported breaking release. |
| Old/new examples | Extensive | Changelog snippets/notes vary | Generate focused recipes from compatibility manifest. |
| Ordered checklist | Yes | No general checklist found | Include a machine-verifiable checklist. |
| Codemod | None found | None found | Build only for mechanical, semantics-preserving changes. |
| Runtime deprecation | One weak process-once alias warning found | No general system found | Add source-attributed stable diagnostics. |
| Config schema version | Strict current schema; no broad explicit config-version protocol found | Config evolves through releases | Add explicit compatibility metadata when semantics change. |
| Persisted schema gate | Strong hard rejection | Versioned streams/workflow compatibility checks | Gate reads and writes before serve. |
| In-place state migration | Not for the 5→8 boundary | Compatibility windows for some event history | Prefer migrations for retained user data; allow reset only when contract permits. |
| Version-gated behavior | Limited; mostly hard 2.0 boundary | peer ranges, info-shape tolerance, stream versions | Keep gates bounded and visible. |
| Changed defaults | Guide documents major changes | Changelog records model/depth changes | Treat authority/cost defaults as breaks even in 0.x. |
| Detection point | startup/runtime/config parse | typecheck, boot, discovery, changelog | Add one read-only upgrade check before deployment. |

### Flue’s most survivable breaking-change choices

It names removed concepts instead of hiding them behind compatibility aliases. It says when a feature, such as framework workflows, has no direct replacement. It rejects incompatible persisted state before application execution. It calls out semantic traps such as cancelling a wait versus aborting durable work. It warns that renaming an agent function changes durable identity unless identity is pinned.

### Flue’s least survivable choices

The version 5→8 state answer is operational deletion or manual export/reseed. There is no codemod for a broad surface rewrite. The lone deprecation warning lacks source attribution. `flue run` silently dropping unknown configuration keys contradicts the normal strict parser.

### Eve’s most survivable breaking-change choices

Stream changes carry a schema version. Mounted extensions are checked against compatible peer ranges. Old remote-info payloads degrade rather than severing a useful connection. Incompatible bundled workflow versions fail with a targeted boot diagnostic. Development generations preserve admitted work during reload.

### Eve’s least survivable choices

Breaking changes are frequent across 0.x minor and patch releases. The changelog is the main migration interface. Hard removals often rely on TypeScript or startup failures to teach the new contract. No general codemod, upgrade scanner, or source-attributed deprecation framework was found. Changed defaults can alter behavior without an explicit configuration migration.

## API vocabulary audit for ours

| Current or likely term | Problem | Canonical replacement or rule |
|---|---|---|
| `AgentHost` | Reuses the name of machinery rejected by D25–D28 | `AgentGateway` for the scoped runtime boundary; `compileAgentFleet` for construction. |
| agent | Too broad by itself | Qualify as agent type, authored source, binding, or runtime implementation. |
| agent ID / type ID | Frequently interchangeable | Public durable identity is `agentTypeId`; local object handles are not IDs. |
| application | Could mean product, code bundle, or agent behavior | Avoid in the agent contract unless it means the whole deployed product. |
| definition | Blurs inert declaration with executable composition | Use authored source for inert data and fleet entry for trusted resolved code. |
| session | Four implementation layers use it | Reserve public `session` for the durable D31 identity; qualify internal handles. |
| conversation | Synonym pressure with session | Do not add publicly; use only as explanatory prose. |
| run | Can mean turn, attempt, process, or workflow | Ban unqualified `run` in stable API names. |
| instance | Could mean agent type or process placement | Reserve for an ephemeral runtime placement, if exposed at all. |
| request | HTTP request versus durable work request | Use submission after admission; transport request before admission. |
| job | Competes with submission and workflow | Avoid unless a separate batch product emerges. |
| turn | Sometimes UI message pair, sometimes execution | Define as one accepted user/command cycle. |
| step | May be orchestration step or model call | Reserve for one model inference inside an attempt. |
| tool | Sometimes executable, sometimes grant | Reserve for model-callable operation. |
| capability | Sometimes general feature | Reserve for authority-bearing object or permission. |
| skill | Sometimes code plugin | Reserve for authored instruction package; executable plugins are adapters. |
| instruction | Prompt fragment versus command | Reserve for prompt material; use command for user/system action. |
| admit | Often conflated with enqueue | Validate authority and durably accept only. |
| dispatch | Often conflated with acceptance | Route already-admitted work only. |
| submit | May imply acceptance prematurely | Submission is created only after durable admission succeeds. |
| settle | Unfamiliar but exact | Use for any durable terminal outcome. |
| complete | Ambiguous success versus terminal | Use only for successful settlement. |
| cancel | Wait cancellation versus durable cancellation | Name `cancelWait` and `abortSubmission` separately. |
| error | Includes warning-like successful diagnostics | Use error for failed contract, diagnostic for non-terminal degradation. |
| retryable | Boolean loses required action | Replace with retry class plus backoff/action metadata. |
| grant | Sometimes declaration, sometimes effective authority | Distinguish grant request, grant policy, and effective grant. |
| binding | Useful but underspecified | Define as workspace + agent type + fleet generation authorization. |

### Vocabulary rules worth enforcing

One noun should identify one durable thing. One verb should identify one state transition. Transport verbs must not imply durable acceptance before the event exists. Authority nouns must not be reused for discoverable features. Implementation-library names such as Pi must not leak into public lifecycle nouns. Persisted identity terms require a migration plan before rename.

## Design philosophy — refusals to adopt

### Adopt from Flue

Refuse a static object as the universal expression of dynamic agent behavior. This is compatible with D26 because our authored data stays inert while trusted host code remains ordinary code. Refuse to own a workflow DSL until existing durable primitives fail a demonstrated use case. This avoids a second state machine competing with D31. Refuse closed provider and sandbox layers. This matches our adapter boundaries, provided openness does not let authored data select implementations. Refuse demo convenience when it compromises durable correctness. This is already close to our posture.

### Reject from Flue

Do not copy runtime-defined agent identity if it weakens the deployment-static fleet. Do not copy manual reset as the normal answer for retained durable state. Do not treat an absent sandbox as sufficient policy; our grants must remain explicit. Do not expose even a bounded provider body unless a field-level safe schema proves it suitable.

### Adopt from eve

Refuse loading an entire project tree merely to discover its shape. Refuse requiring boilerplate code when inert instructions are enough. Refuse a broken candidate reload the power to evict a working generation. Refuse terminal turn failure for a bounded, model-repairable tool mistake.

### Reject from eve

Do not make “agent is a directory” our executable trust model. That violates authored-data-not-code and the static trusted fleet. Do not make a default sandbox imply default tool authority. Do not leave approval and network-deny posture to deployer diligence. That directly violates default-deny grants and weakens D27. Do not couple agent lifecycle to one hosting platform merely to erase provisioning concepts. Do not derive durable identity from a path or package display name. Do not silently ignore typos in policy-sensitive namespaces.

## Defaults and progressive disclosure — actual decision matrix

| Missing decision | Flue mechanism | eve mechanism | Our required mechanism |
|---|---|---|---|
| App entry | Fail with exact file/sample | Directory shape is app; instructions root required | Fail fleet build with source location. |
| Agent implementation file | Function module required for a Flue agent | `agent.ts` optional | Trusted fleet entry required; authored data cannot synthesize one. |
| Model | Fail after render with `useModel` guidance | Scaffold/default/picker can supply one | Fail unless deployment-static policy selected an allowed model. |
| Sandbox | No environment until requested | Framework default sandbox | Defer capability, but never grant it implicitly. |
| Tools | Explicit hooks/providers | Default harness conditionally supplies many | Only effective default-deny grants expose tools. |
| Credentials | Provider/config dependent | Connections/platform integration | Fail closed under D27; never guess. |
| Name | Function durable identity | package name then directory | Explicit stable agent type ID in frozen fleet. |
| Unknown config | Strict reject, except `flue run` drops keys | Discovery diagnostics/varied config parsing | Reject security and behavior keys everywhere consistently. |
| Optional integration fails | MCP warning and tools omitted | optional adapter/info methods can degrade | Visible diagnostic; no authority widening. |
| Unsupported directory | Not central to Flue model | Ignore with `eve info` diagnostic | Error in reserved namespaces, ignore elsewhere. |
| Old stored schema | Hard fail | versioned compatibility varies | Fail before serve or run explicit migration. |
| Old remote metadata | Not highlighted | Best-effort omit unrecognized shape | Degrade only for observation, never authority. |
| Missing grant | Application policy concern | permissive unless tightened | Deny, without revealing inaccessible capability inventory. |

### The rule underneath the matrix

Fail when the missing value changes authority. Fail when it changes durable identity. Fail when it changes persistence interpretation. Fail when it can create external effects or material cost. Defer when the capability is optional and absence is inert. Derive only presentation values from deterministic local facts. Degrade only observation or optional integration quality. Default only when the default is bounded, inert, visible, and stable.

## Genuinely surprising findings

### The best eve feature is not agent execution; it is failure compression

Eve keeps full raw diagnostics while collapsing the ordinary transcript to one useful line. That is better than either flooding the user or discarding the evidence. The general pattern should apply to provider failures, tool stderr, and migration diagnostics.

### Flue makes error-detail intent a compile-time choice

Requiring separate caller and developer strings sounds verbose. That verbosity is the point: it creates friction exactly where accidental leakage otherwise occurs.

### Eve’s semantic classifier is an adapter for errors

It treats uncontrolled exception vocabularies like uncontrolled provider APIs. A stable boundary translates them without requiring ownership of their producers. This is useful as a fallback layer, not as canonical truth.

### Eve’s development generations encode admission semantics

Hot reload is usually treated as developer convenience. Eve turns it into a miniature deployment protocol: validate, promote, pin, drain. That is directly relevant to our accepted-work durability story even though render-per-turn is out of scope.

### Flue’s state-version failure is excellent error UX around an unpleasant product choice

`PersistedFormatVersionError` precisely names stored and supported versions. The operator still has to delete or manually reseed state. Good diagnostics do not make a destructive migration strategy good.

### Eve documents a temporal type hole

Current types claim an event ID that historical events may not have. The admission is valuable because most frameworks hide this edge. Our answer should be a versioned union, not a better footnote.

### Flue’s CLI has a progressive-disclosure inconsistency

The server config parser rejects unknown keys. `flue run` drops them. A convenience path therefore teaches a configuration that production may reject. Consistency across surfaces matters more than friendliness in one command.

### Eve explicitly assigns security posture to the deployer

The docs acknowledge permissive tool approval and network egress defaults. This is unusually candid. It is also the clearest reason not to copy eve’s default harness wholesale.

## Implementation order

### P0 — before more error codes ship

Create the two-audience error projection funnel. Redact unknown errors in production. Return a correlation ref. Turn the error registry into executable metadata. Add leak tests for provider messages, paths, headers, prompts, and credentials.

### P1 — before the next intentional breaking release

Ratify the lifecycle vocabulary. Rename `createAgentHost()`. Define compatibility layers and version ownership. Create the compatibility manifest and read-only upgrade check. Version D31 events as historical unions.

### P2 — after the common boundary exists

Add fallback semantic classification. Unify synchronous and settlement errors. Add source-attributed deprecations. Classify bounded model-repairable tool failures.

### P3 — operational leverage

Build the redacted support bundle. Add generation-aware candidate promotion for development. Expose static fleet discovery diagnostics from the one compiler. Publish the refusal ledger.

## Source ledger

### Flue primary sources

- [Error handling reference](https://flueframework.com/docs/reference/errors/)
- [Flue 2.0 migration guide](https://flueframework.com/docs/guide/migration/)
- [Why Flue](https://flueframework.com/docs/guide/why-flue/)
- Installed `@flue/runtime@2.0.3` error, config, provider, and Vite bundles in `/home/ubuntu/projects/spike-flue-celld/node_modules/`

### eve primary sources

- [Introducing eve](https://vercel.com/blog/introducing-eve)
- [eve repository](https://github.com/vercel/eve)
- [Documentation index](https://github.com/vercel/eve/blob/main/docs/README.md)
- [Project layout](https://github.com/vercel/eve/blob/main/docs/reference/project-layout.md)
- [Default harness](https://github.com/vercel/eve/blob/main/docs/concepts/default-harness.md)
- [Sessions, runs, and streaming](https://github.com/vercel/eve/blob/main/docs/concepts/sessions-runs-and-streaming.md)
- [TypeScript API](https://github.com/vercel/eve/blob/main/docs/reference/typescript-api.md)
- [Changelog](https://github.com/vercel/eve/blob/main/packages/eve/CHANGELOG.md)
- [Discovery implementation](https://github.com/vercel/eve/blob/main/packages/eve/src/discover/discover-agent.ts)

### Our sources

- `git show origin/main:packages/agent/docs/ERROR_CODES.md`
- `/home/ubuntu/projects/boring-ui-v2/packages/agent/src/shared/error-codes.ts`
- `/home/ubuntu/projects/boring-ui-v2/packages/agent/src/server/http/routes/piChat.ts`
- `git show origin/main:docs/DECISIONS.md`
- D31 draft material in the current research scratchpad

## already better in ours

Our default-deny grant model is materially safer than eve’s permissive harness defaults. Copying eve’s built-in tool availability would be copying backwards. D27’s opaque, invocation-scoped credential custody is stronger than either framework’s public error story demonstrates. Credentials are barred from prompts, sessions, files, shell, logs, and durable events by architectural decision. Our authored-data-not-code boundary is sharper than eve’s executable directory convention. It also avoids Flue’s possibility of treating arbitrary authored functions as the whole durable identity surface. Our deployment-static fleet is easier to validate and authorize than dynamic discovery or registration. D29’s one construction funnel plus CI invariant is stronger than convention-only consistency. Our branded scope is rechecked on every capability use. Neither mined framework exposes an equivalent default-deny, per-use authorization story in the reviewed material. D30 correctly keeps hostname routing out of authority. Path- or host-derived identity would be a regression. D31’s single durable event-log truth is stronger than a system that lets diagnostics, caches, or current TypeScript types reinterpret history. Our documented error registry already includes suggested client action, log level, and stability. Flue and eve motivate making those fields executable; they do not beat the breadth of the registry itself. Our explicit stable-versus-internal code policy is a better starting point than eve’s primarily changelog-shaped compatibility contract. Our refusal of silent storage fallback is stronger than convenience defaults in both frameworks. Our distinction between inert authored material and trusted executable adapters should remain non-negotiable.

## evaluated and rejected

### Eve’s permissive default harness

Rejected. Default tool execution without approval and non-deny-all network egress conflict directly with default-deny grants. They also make missing configuration an authority-expanding default.

### Eve’s executable directory as the trust boundary

Rejected. It is elegant for a developer framework but violates authored-data-not-code and the deployment-static fleet. Keep its read-only discovery diagnostics, not its execution model.

### Path- or package-derived durable identity

Rejected. Renames and moves should not silently fork durable state or authorization identity. Directory names may supply display labels only.

### Flue’s reset-first persisted-format migration

Rejected as a normal policy. It may be acceptable for explicitly disposable prerelease state. It is not acceptable for retained D31 event logs without a deliberate export, migration, or quarantine path.

### Raw provider body in caller-visible metadata

Rejected even when length-bounded. Length bounds control volume, not sensitivity. Normalize allowlisted fields and keep raw bodies in redacted operator diagnostics.

### A subclass for every error code

Rejected. Flue’s hierarchy demonstrates strong ownership of transport semantics, but our larger registry would become class-heavy. Use an executable catalog plus a small number of typed parameter carriers.

### Semantic pattern matching as the primary taxonomy

Rejected. Eve’s classifier is valuable for foreign exceptions. Our own producers must emit stable typed codes directly. Pattern rules are fallback adapters with confidence, never durable truth.

### A raw environment dump

Rejected. Eve’s support artifact is operationally excellent but too broad for D27 if copied literally. Use an allowlist, preview-before-share, and presence-only reporting for secrets.

### Silent ignore for unsupported security-sensitive directories

Rejected. An ignored typo in a tool, grant, connection, or policy namespace can produce a false sense of safety. Fail those builds; reserve warnings for inert clutter.

### Production hot mutation of the fleet

Rejected. Eve’s generation mechanism is valuable for dev and controlled deployment promotion. A user-mutable production generation registry would violate D25 and D28.

### A framework-owned general workflow DSL

Rejected for now. Flue’s removal is persuasive: a second orchestration state machine would compete with D31 and accepted-work semantics. Revisit only with concrete use cases existing primitives cannot express.

### Current-type fiction for historical events

Rejected. Eve’s documentation is honest about missing historical event IDs, but consumers should not receive a type stronger than stored reality. Use versioned unions and lossless normalization only.

### Runtime warnings without source attribution

Rejected as an upgrade strategy. Flue’s one-time rename warning is better than silence but does not scale. Warnings need source, stable code, replacement semantics, and removal version.

### Codemods as a universal migration answer

Rejected. Neither framework provides evidence that broad semantic breaks can be automated safely. Use codemods for syntax-preserving changes and explicit checks for authority, identity, storage, and default changes.

### A universal origin enum as the only client action signal

Rejected. Developer/user/provider/internal is useful for routing and analytics, but it does not tell a client what to do. Expose stable action and retry class; keep origin as a complementary field where needed.

### Copying either framework wholesale

Rejected. Flue is strongest at error projection, durable settlement language, and honest hard migration boundaries. Eve is strongest at diagnostics, lifecycle vocabulary, repairable failures, and generation-safe development. Our authority, fleet, credential, and durable-truth constraints are stronger than both and must remain the selection filter.
