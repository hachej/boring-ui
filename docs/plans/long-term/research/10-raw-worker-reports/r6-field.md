# TypeScript production agent-framework field survey

## Verification legend

| Mark | Meaning |
|---|---|
| **YES** | The cited first-party source states the property. |
| **PARTIAL** | A narrower contract exists than the question asks for. |
| **ABSENT** | No framework contract was found; ordinary application code may supply it. |
| **UNVERIFIED** | The claim or exact semantic could not be established from current first-party documentation. |

## 1. OpenAI Agents SDK for TypeScript, Responses API, and hosted surfaces

### Q1 — AUTHORING

**Form:** code-first agents; optional visual graph authoring in the hosted Agent Builder.

The TypeScript package is `@openai/agents`.

An `Agent` carries a name, instructions, model configuration, tools, handoffs, guardrails, and output type.

`run()` executes the built-in agent loop until a final output, handoff, error, or configured limit.

Minimal SDK agent ([quickstart](https://openai.github.io/openai-agents-js/guides/quickstart/), [agents](https://openai.github.io/openai-agents-js/guides/agents/)):

```ts
import { Agent, run } from '@openai/agents';

const agent = new Agent({
  name: 'Assistant',
  instructions: 'Answer tersely.',
});

const result = await run(agent, 'Hello');
console.log(result.finalOutput);
```

Tools are ordinary functions wrapped with `tool()` or hosted tool descriptors.

Handoffs compose agents as tools or explicit delegation targets.

The Responses API is the underlying model/tool-call surface, not a separate graph runtime.

Responses can preserve model-visible conversation state by chaining `previous_response_id` or attaching a Conversation.

The Conversations API gives a durable conversation identifier shared across sessions, devices, or jobs ([conversation state](https://platform.openai.com/docs/guides/conversation-state)).

That object stores messages, tool calls, and tool outputs; it does not declare workflow steps.

The hosted Agent Builder authors workflows as typed visual graphs ([Agent Builder](https://platform.openai.com/docs/guides/agent-builder)).

Publishing Agent Builder creates a versioned workflow object that can be embedded through ChatKit or exported as SDK code.

Agent Builder is currently documented as deprecated, with shutdown scheduled for **2026-11-30**; it should not be selected as a new durable control plane.

“AgentKit” is best treated as the product umbrella around Agent Builder, ChatKit, tools, and eval/deployment surfaces rather than a second TypeScript runtime.

### Q2 — DURABILITY

**Verdict: ABSENT in the local Agents SDK run loop; PARTIAL in hosted Responses surfaces.**

| Concern | Documented contract |
|---|---|
| Admission | `run()` is an in-process call; no durable acceptance receipt or queue is documented. |
| Checkpoint | `RunState` is serializable, but the application must store it and later reconstruct the compatible agent graph. |
| Retry | Model/provider retries may occur, but no durable step retry/settlement contract is specified for the whole agent run. |
| Settlement | Tool and model calls are not documented as exactly-once or memoized across a process crash. |
| Idempotency | No SDK-wide run idempotency key or side-effect idempotency contract was found. |
| Crash survival | Nothing survives automatically; application-persisted `RunState`, Sessions, Conversations, or sandbox snapshots survive only according to their separate storage contracts. |

`RunState.toString()` and `RunState.fromString(agent, serialized)` support pausing and moving a run between processes ([human-in-the-loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)).

Serialized state includes approvals, usage, nested resumption state, and serializable application context.

This is a transportable checkpoint format, not an admission, retry, scheduler, or exactly-once contract.

The application owns persistence, concurrency control, version compatibility, retry policy, and side-effect deduplication.

Sessions persist conversation history through a pluggable interface ([sessions](https://openai.github.io/openai-agents-js/guides/sessions/)).

`OpenAIConversationsSession` stores history in an OpenAI Conversation; `MemorySession` is process-local.

Sessions do not checkpoint the instruction pointer of the agent loop.

Responses background mode accepts an asynchronous response with `background: true` and exposes pollable `queued` and `in_progress` states ([background mode](https://platform.openai.com/docs/guides/background)).

Background mode protects a single long model response from client timeouts or disconnects.

It does not document durable multi-step orchestration, per-tool settlement, or application side-effect replay.

Cancellation is documented as idempotent.

Background response data is retained temporarily and has separate Zero Data Retention implications; it is not a permanent execution journal.

OpenAI Conversations preserve model-visible items but do not make external tool effects transactional.

No general hosted OpenAI Agents SDK run service with a documented step-level recovery contract was verified.

### Q3 — TENANCY

**Verdict: PARTIAL platform tenancy; no built-in per-agent membership model.**

OpenAI API organizations contain projects with project owners, project members, and project-scoped service accounts ([project management](https://help.openai.com/en/articles/9186755-managing-your-work-in-the-api-platform-with-projects)).

Project resources and usage are isolated at the project boundary.

API keys may be `All`, `Restricted`, or `Read Only`, with endpoint-level permissions ([API-key permissions](https://help.openai.com/en/articles/8867743-assign-api-key-permissions)).

These controls authorize API/project resources, not an SDK `Agent` instance.

No SDK schema for tenant membership, agent owner/member roles, row-level agent grants, or per-handoff authorization was found.

Applications must authenticate end users and authorize access to agent IDs, conversations, threads, files, and tools.

### Q4 — HUMAN-IN-THE-LOOP

**Verdict: serializable durable pause if the application persists `RunState`; not managed durability.**

Marking a tool `needsApproval: true` causes the run to stop before the tool executes ([human-in-the-loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)).

The result exposes interruptions.

The caller applies `state.approve(interruption)` or `state.reject(interruption)` and resumes with `runner.run(agent, state)`.

The original server process need not remain alive if serialized state is stored externally.

The SDK therefore provides a durable-pause *representation*.

The SDK does not provide the durable inbox, claimant lock, expiry, notification, or resumption worker.

A rejected call becomes model-visible feedback according to the configured behavior; it is not silently executed.

### Q5 — SANDBOX / EXEC

**Verdict: hosted and local execution options; isolation varies; adapters are pluggable.**

The SDK exposes hosted tools including code interpreter, shell, computer, web search, and file search ([tools](https://openai.github.io/openai-agents-js/guides/tools/)).

Hosted shell runs in an OpenAI-managed container.

Hosted containers can be auto-created or referenced by container ID.

Outbound network is disabled by default and may be constrained by an organization allowlist plus request network policy ([shell tool](https://platform.openai.com/docs/guides/tools-shell)).

Network secrets can be supplied without exposing their values to the model-generated command text.

Local shell, computer, and editor interfaces delegate execution to application-provided implementations.

Local adapters have the privileges of their host unless the application adds isolation.

The Sandbox Agents beta provides `SandboxAgent`, manifests, explicit capabilities, and local Unix, Docker, or hosted sandbox clients ([Sandbox Agents](https://openai.github.io/openai-agents-js/guides/sandbox-agents/)).

Sandbox sessions and snapshots can preserve a workspace for later runs.

That persistence is filesystem/environment continuity, not agent-loop settlement.

The isolation contract is therefore pluggable at the SDK boundary, with stronger managed isolation only for the hosted container products.

## 2. Cloudflare Agents SDK, fibers, Think, and dynamic workflows

### Q1 — AUTHORING

**Form:** code-first stateful class; optional durable workflow class; first-party Think harness.

The `agents` package exposes `Agent`, which extends Cloudflare's server abstraction and ultimately a Durable Object ([Agent class](https://developers.cloudflare.com/agents/runtime/lifecycle/agent-class/)).

Each named agent instance is globally addressable and single-threaded.

Minimal stateful agent:

```ts
import { Agent } from 'agents';

export class CounterAgent extends Agent<Env, { count: number }> {
  initialState = { count: 0 };

  increment() {
    this.setState({ count: this.state.count + 1 });
  }
}
```

`this.state` is backed by the instance's SQLite storage and synchronized to connected clients ([state](https://developers.cloudflare.com/agents/runtime/lifecycle/state/)).

Agents may expose RPC methods, WebSocket connections, HTTP routes, schedules, queues, tools, and workflow entry points.

Durable work can be authored as an `AgentWorkflow` using Cloudflare Workflows ([workflows](https://developers.cloudflare.com/agents/concepts/workflows/)).

```ts
import { AgentWorkflow } from 'agents/workflows';

export class ReviewFlow extends AgentWorkflow<Env, Params> {
  async run(event, step) {
    const draft = await step.do('draft', () => createDraft(event.payload));
    await this.waitForApproval(step, { message: 'Publish?', metadata: { draft } });
    return step.do('publish', () => publish(draft));
  }
}
```

Think is Cloudflare's first-party stateful agent harness in `@cloudflare/think` ([Think](https://developers.cloudflare.com/agents/harnesses/think/)).

It supplies a Pi-inspired turn loop, session/message persistence, streaming, client tools, extensions, and programmatic submissions.

Applications subclass `Think`, implement model selection, and invoke `runTurn()` or durable submission methods.

Think Workflows expose `ThinkWorkflow` and `step.prompt()` for durable model turns ([Think Workflows](https://developers.cloudflare.com/agents/harnesses/think/workflows/)).

Dynamic Workflows load workflow code at runtime inside a tenant-selected Dynamic Worker ([Dynamic Workflows](https://developers.cloudflare.com/dynamic-workers/usage/dynamic-workflows/)).

The workflow receives a wrapped binding that carries tenant metadata.

This permits generated or customer-supplied workflow definitions without statically deploying every definition in the host worker.

### Q2 — DURABILITY

**Verdict: YES, with three distinct contracts: Durable Object state, fibers, and Workflows.**

#### Base agent state

The agent's SQLite/KV state survives isolate eviction and restart.

The instance is single-threaded, so requests to one ID are serialized by the Durable Object runtime.

Persisted state does not automatically make an arbitrary async method retryable or replay-safe.

#### Fibers

`runFiber(name, fn)` writes a fiber row to SQLite before invoking `fn` ([durable execution](https://developers.cloudflare.com/agents/runtime/execution/durable-execution/)).

On ordinary success, the row is deleted and the return value is delivered to the live caller.

On an ordinary thrown error, the row is deleted; the error propagates and is logged.

There are **no automatic retries** for a thrown fiber.

If the isolate disappears while the row remains active, the fiber is classified as orphaned on later activation/alarm.

`onFiberRecovered(fiber)` is then called.

The default recovery implementation logs and deletes the orphan.

If `onFiberRecovered` throws, the row remains and may be scanned again later.

`ctx.stash(value)` synchronously replaces a durable SQLite snapshot associated with the fiber.

Recovery code reads the last fully committed stash; partial in-memory changes are lost.

The framework does not replay the callback from the last source line.

Recovery behavior is application-defined: resume from stash, compensate, restart idempotently, or terminate.

The original `runFiber()` return value is not durably retained for a caller that disappeared.

`startFiber()` first creates a managed durable record and returns an acceptance receipt.

The receipt includes a `fiberId`, status, metadata, and whether this invocation was accepted.

An `idempotencyKey` deduplicates managed-fiber admission; a duplicate reports `accepted: false`.

Default `startFiber()` returns after durable acceptance; `waitForCompletion` optionally blocks the current caller.

Managed statuses include pending, running, interrupted, completed, error, and aborted.

Results are status-oriented; arbitrary callback return values are not documented as a durable result store.

Cancellation records `aborted` durably and signals a currently running isolate cooperatively.

An interrupted managed fiber can be completed from `onFiberRecovered` by returning a terminal result or explicitly resolved.

The managed-fiber contract supplies admission and recovery detection, not automatic replay or exactly-once effects.

#### Cloudflare Workflows

Workflow `step.do()` boundaries are persisted and recovered by the Workflows service ([workflows](https://developers.cloudflare.com/agents/concepts/workflows/)).

Successful step results are memoized and are not rerun during replay.

Failed steps use the configured retry policy.

Sleeping and waiting for events consume no continuously running process.

The workflow instance survives Worker or isolate loss.

Documentation describes `step.do()` as durable/exactly-once at the step boundary.

External effects whose response is lost before checkpoint still require idempotency at the target system.

Progress broadcasts, direct RPC, and similar non-step operations can repeat during replay and are explicitly non-durable.

#### Think submissions

Think writes a submission ledger before returning from `submitMessages()` ([programmatic submissions](https://developers.cloudflare.com/agents/harnesses/think/programmatic-submissions/)).

Submissions are FIFO and may carry an idempotency key and metadata.

The method returns a fast durable acknowledgement; execution may happen later.

Messages are appended to the session only when execution actually begins.

A submission cancelled before apply therefore does not pollute the conversation transcript.

Cancellation is itself durable.

Think Workflow `step.prompt()` submits idempotently through `step.do()`.

The documented inferred key includes workflow name, workflow ID, and step name; loops require a custom key to distinguish iterations.

An outbox plus alarms retries completion notification from Think back to the waiting workflow.

Timeout can cancel the submission by default; `cancelOnTimeout: false` changes that behavior.

#### Dynamic Workflows

Successful dynamic-workflow steps persist exactly as ordinary Workflow steps.

After isolate recycle, the engine reloads the correct Dynamic Worker and continues from stored progress.

Tenant metadata selects the runtime-loaded implementation but must not contain secrets.

### Q3 — TENANCY

**Verdict: PARTIAL primitives; no built-in membership or per-agent authorization model.**

An agent ID maps to an isolated Durable Object instance with private SQLite state.

This is a strong structural tenancy primitive, not authorization.

`routeAgentRequest()` exposes `onBeforeConnect` and `onBeforeRequest` hooks for authentication and ownership checks ([routing](https://developers.cloudflare.com/agents/runtime/communication/routing/)).

The application can derive the agent instance name from authenticated tenant/user identity.

The application must prevent a caller from selecting an instance it does not own.

Read-only connections can receive state and call non-mutating RPC while framework guards block `setState()` ([read-only connections](https://developers.cloudflare.com/agents/runtime/communication/readonly-connections/)).

That provides a capability tier, not a membership graph.

The Slack example maps Slack `team_id` to an isolated agent instance ([Slack agent](https://developers.cloudflare.com/agents/examples/slack-agent/)).

OAuth and workspace membership remain application/channel concerns.

Dynamic Workflows explicitly propagate a `tenantId` through a wrapped binding.

The tenant identifier chooses code/runtime scope; it does not authorize the initiating principal.

No framework entities for organization, member, invitation, agent role, or per-tool grant were found.

### Q4 — HUMAN-IN-THE-LOOP

**Verdict: YES, a durable pause in Workflows and a durable replay gate in Think.**

`waitForApproval()` persists a Workflow wait and releases compute ([workflows](https://developers.cloudflare.com/agents/concepts/workflows/)).

The Agent can later call `approveWorkflow()` or `rejectWorkflow()`.

Approval resumes the next durable step.

Rejection raises a `WorkflowRejectedError` inside the workflow.

The waiting process/isolate need not remain alive.

Think's execute tool stores pending execution records durably ([Think tools](https://developers.cloudflare.com/agents/harnesses/think/tools/)).

Model-written code may run until it reaches an unapproved action.

The runtime aborts at the approval boundary and records completed tool calls plus the pending action.

On approval, completed calls are replayed from recorded values instead of executed again.

The approved action is applied once through the runtime's continuation path, then the same program continues.

On rejection, the pending execution ends without applying the action.

The stored pending record is the authoritative argument set shown for approval.

Plain Agent methods have no automatic approval primitive unless they use Workflow, Think, or application state.

### Q5 — SANDBOX / EXEC

**Verdict: multiple isolation levels; model-code execution is isolated; workspace/container contracts are pluggable by surface.**

Code Mode asks the model to write code that calls typed tools, then performs one sandboxed execution ([Code Mode](https://developers.cloudflare.com/agents/tools/codemode/)).

Tool discovery can be progressive through search/describe rather than putting every schema in the prompt.

The code executes in an isolated Worker.

Direct outbound network is blocked by default; external access occurs through host-provided tools or upstream MCP calls ([MCP Code Mode](https://developers.cloudflare.com/agents/model-context-protocol/codemode/)).

The host remains responsible for authenticating and authorizing every bridged operation.

Think's `createExecuteTool()` combines model-written JavaScript, typed tools, durable replay, audit records, and approvals.

`@cloudflare/shell` exposes the documented `Workspace` integration used by Think tooling.

Cloudflare Sandbox uses Containers to provide a real filesystem, shell, language runtimes, and packages ([Sandbox](https://developers.cloudflare.com/agents/tools/sandbox/)).

Container workspaces may be long-lived and are isolated from the Agent Worker process.

The host chooses which tools, MCP servers, credentials, and network paths the sandbox can reach.

The exact current public contract of a separate `@cloudflare/workspace` package was **UNVERIFIED** in first-party docs.

Do not assume `@cloudflare/workspace` and the documented `Workspace` from `@cloudflare/shell` are interchangeable without checking the installed version.

## 3. Mastra

### Q1 — AUTHORING

**Form:** code-first agent plus typed workflow graph.

Minimal agent ([agents guide](https://mastra.ai/docs/agents/mcp-guide)):

```ts
import { Agent } from '@mastra/core/agent';

export const agent = new Agent({
  id: 'assistant',
  name: 'Assistant',
  instructions: 'Answer tersely.',
  model: 'openai/gpt-4o-mini',
});
```

Agents contain model, instructions, tools, memory, evaluators, processors, and optional workspace access.

Workflows are declared with `createStep()` and `createWorkflow()`, composed with `.then()`, branches, loops, parallels, and `.commit()` ([workflow overview](https://mastra.ai/articles/ai-workflow-automation)).

The agent loop and workflow engine are separate composable surfaces.

### Q2 — DURABILITY

**Verdict: ABSENT for a bare agent call; PARTIAL-to-YES for persistent workflows, depending on runtime.**

Mastra workflow snapshots contain workflow state, outputs, execution path, suspended paths, and remaining retries ([snapshots](https://mastra.ai/en/reference/workflows/snapshots)).

Snapshots are written to the configured Mastra storage provider.

On suspension, a snapshot is created automatically and used by resume.

Current workflow documentation describes step snapshots, restart from the last completed step, and configurable retry backoff ([enhanced workflows](https://mastra.ai/blog/mastra-workflows-enhanced)).

Retry configuration includes maximum retries, delay, multiplier, and maximum delay.

Exact default-engine semantics for durable admission before returning to the caller are **UNVERIFIED**.

Exact settlement behavior when an external effect succeeds but snapshot persistence fails is **UNVERIFIED**; tools should be idempotent.

The snapshot store is not documented as an exactly-once transaction coordinator for arbitrary side effects.

Mastra can deploy workflow work to Inngest for step memoization and retries.

Mastra also documents a Temporal integration for a stronger external durable scheduler.

Those integrations inherit their engines' durability constraints; they should not be attributed to every local Mastra run.

Concurrent-safe snapshot changes reduce overwrite races, but do not establish global exactly-once effects ([concurrent-safe snapshots](https://mastra.ai/blog/changelog-2026-03-04)).

### Q3 — TENANCY

**Verdict: YES in Mastra Enterprise FGA; optional and route-dependent.**

Mastra server auth can install an authentication provider for `/api/agents`, workflows, memory, tools, and related routes ([auth](https://mastra.ai/docs/server/auth)).

Enterprise FGA adds resource-level authorization intended for multi-tenant B2B applications ([FGA](https://mastra.ai/docs/server/auth/fga)).

Documented resource checks include `agents:execute` on an agent ID.

Workflow HTTP execution checks `workflows:execute` on a workflow ID.

Standalone tools and agent-scoped tools have distinct resource identifiers.

Memory thread and stored-resource access can be scoped to the actor.

WorkOS organizations and memberships can supply relationship data.

Custom `IFGAProvider` implementations can connect a different authorization store.

`requireActor` can force explicit actor propagation for sensitive agents/tools.

Important boundary: direct SDK calls such as `createRun().start()`, `.resume()`, or `.restart()` are not independently protected by server route middleware.

Code invoking those methods must enforce authorization itself or execute inside a protected route.

Durable workflow resumes do not automatically restore an initial actor as a timeless authority.

The trusted resume path must pass or reconstruct an authorized actor for the new request.

This is the clearest verified per-agent/per-workflow authorization model in this survey.

### Q4 — HUMAN-IN-THE-LOOP

**Verdict: YES when persistent workflow storage is configured.**

A workflow step calls `suspend()` with serializable data.

The engine stores the suspended path in the workflow snapshot.

`resume()` supplies human input and continues from stored workflow state ([resume workflows](https://mastra.ai/blog/resumeworkflows)).

The Node process need not remain blocked while waiting.

Streaming may close on suspension and be re-established for resume.

Without persistent storage, the pause is only as durable as the chosen in-memory adapter.

Bare agent tool approval has no separate universal durability guarantee; place it in a persistent workflow when crash survival is required.

### Q5 — SANDBOX / EXEC

**Verdict: YES; workspace and sandbox are separate, provider-pluggable abstractions.**

Mastra Workspaces expose filesystem, search, edit, command, and permission capabilities to agents ([workspaces](https://mastra.ai/blog/introducing-mastra-workspaces)).

Permissions can independently constrain read, write, delete, and command operations.

A local workspace inherits host trust unless a sandbox is attached.

Remote sandbox integrations include Daytona, E2B, and Blaxel, with provider-specific filesystem, process, network, persistence, and reconnect behavior ([remote sandboxes](https://mastra.ai/blog/introducing-remote-sandboxes)).

The workspace API is decoupled from the sandbox provider.

Applications can implement another provider adapter.

Isolation, network policy, persistence, and resource limits therefore depend on the selected backend rather than one Mastra-wide guarantee.

## 4. LangGraph JS and LangGraph Platform

### Q1 — AUTHORING

**Form:** explicit state graph or functional durable program.

Minimal graph ([LangGraph JS quickstart](https://docs.langchain.com/oss/javascript/langgraph/quickstart)):

```ts
import { StateGraph, StateSchema, MessagesValue, START, END } from '@langchain/langgraph';

const State = new StateSchema({ messages: MessagesValue });

const graph = new StateGraph(State)
  .addNode('reply', async (state) => ({ messages: [await callModel(state.messages)] }))
  .addEdge(START, 'reply')
  .addEdge('reply', END)
  .compile({ checkpointer });
```

Nodes are functions over typed state; edges encode control flow.

The Functional API expresses the same checkpointed runtime through `entrypoint` and `task` rather than a visible graph.

LangGraph Platform/Agent Server deploys compiled graphs as assistants, threads, runs, and crons.

### Q2 — DURABILITY

**Verdict: YES for checkpointed graph progress; not exactly-once for arbitrary side effects.**

A checkpointer saves a state snapshot at each super-step ([persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)).

`thread_id` is the durable continuation key.

After failure, execution resumes from the last successful checkpoint.

Completed nodes before that checkpoint are skipped.

Nodes after the checkpoint are rerun.

Within a failed parallel super-step, pending writes preserve successful sibling-node results so they need not be repeated.

Agent Server supplies checkpoint persistence automatically.

OSS users select a checkpointer such as Postgres, MongoDB, Redis, or SQLite.

Checkpoint saver interfaces are pluggable.

Functional `task` results are checkpointed and reused on replay ([Functional API](https://docs.langchain.com/oss/javascript/langgraph/functional-api)).

Failed or incomplete tasks rerun.

Task arguments/results must be serializable.

Side effects must be inside tasks to avoid replay from ordinary function code.

Even a task may externally commit before its result checkpoint is known; external writes still need an idempotency key.

Retry policies can be configured at nodes/tasks, but retry does not make side effects exactly-once.

OSS `invoke()` does not document a durable admission receipt before local process execution.

The exact Agent Server run-enqueue admission and duplicate-submission idempotency contract was **UNVERIFIED**.

Settlement is a committed checkpointed graph state, not a distributed transaction across tools.

Time travel can replay from a historical checkpoint or fork a new continuation.

State may be inspected and updated between checkpoints.

### Q3 — TENANCY

**Verdict: YES through LangGraph Platform custom auth; no built-in OSS agent-membership schema.**

Platform custom authentication runs an `@auth.authenticate` handler on requests ([authentication](https://docs.langchain.com/langsmith/auth)).

Resource authorization handlers can allow, deny, or filter access to threads, assistants, runs, and crons.

Metadata can bind a resource to a user or tenant.

Read/list queries can be filtered so one principal cannot discover another tenant's threads.

Documentation explicitly warns that authentication alone does not isolate users; resource handlers are required ([custom-auth setup](https://docs.langchain.com/langsmith/set-up-custom-auth)).

LangSmith also has organization/workspace RBAC for platform administration ([RBAC](https://docs.langchain.com/langsmith/rbac)).

This is programmable per-resource authorization, not a standardized end-user membership table embedded in a graph.

OSS LangGraph has no tenancy layer.

### Q4 — HUMAN-IN-THE-LOOP

**Verdict: YES, a durable checkpointed interrupt.**

`interrupt(value)` saves graph state and stops execution until a `Command({ resume })` arrives ([interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)).

No Node process or worker remains blocked.

The value is returned to the caller as an interrupt payload.

On resume, the **entire interrupted node restarts from its beginning**.

Code before `interrupt()` therefore executes again.

Any side effect before the interrupt must be idempotent or moved to a separate completed node/task.

Resume values are matched to interrupts by their order/index within the node.

Changing conditional interrupt order between attempts can misassociate resume values.

Multiple concurrent graph branches can hold independent interrupts.

The pause can last indefinitely as long as the checkpoint store retains the thread.

### Q5 — SANDBOX / EXEC

**Verdict: ABSENT in core LangGraph; optional and pluggable in adjacent Deep Agents tooling.**

LangGraph tools and nodes are ordinary JavaScript functions executing with the host process's privileges.

Core graph persistence does not isolate filesystem, process, or network access.

LangChain's Deep Agents layer, which is built on LangGraph, defines backend/sandbox interfaces ([sandboxes](https://docs.langchain.com/oss/javascript/deepagents/sandboxes), [backends](https://docs.langchain.com/oss/javascript/deepagents/backends)).

Documented providers include remote sandbox services and local shell backends.

Local-shell backends provide no meaningful isolation.

Remote provider guarantees differ by vendor.

Therefore sandboxing is pluggable in the broader stack but not part of LangGraph's execution contract.

## 5. Inngest AgentKit

### Q1 — AUTHORING

**Form:** code-first agents composed into a code-first network/router.

Minimal agent ([`createAgent`](https://agentkit.inngest.com/reference/create-agent)):

```ts
import { createAgent, agenticOpenai as openai } from '@inngest/agent-kit';

const assistant = createAgent({
  name: 'Assistant',
  system: 'Answer tersely.',
  model: openai('gpt-4o-mini'),
});
```

`createNetwork()` composes agents, shared state, tools, and a routing function ([`createNetwork`](https://agentkit.inngest.com/reference/create-network)).

Agent inference and tools can execute through Inngest steps.

### Q2 — DURABILITY

**Verdict: YES when run inside Inngest; step-level deterministic replay.**

Each Inngest step is separately executed and its result persisted ([execution model](https://www.inngest.com/docs/learn/how-functions-are-executed)).

After failure or sleep, the function is re-entered from the top.

Completed step results are injected instead of re-executed.

The same dynamic control path is reconstructed from memoized results.

AgentKit model calls use `step.ai` and inherit Inngest retries and caching ([agents](https://agentkit.inngest.com/concepts/agents)).

Successful `step.run` work is not run again on replay.

Failed steps retry according to policy.

The default documented function policy is four retries after the initial attempt, five total attempts ([error handling](https://www.inngest.com/docs/guides/error-handling)).

Non-retryable errors can settle a function failure.

A side effect may commit externally before its step result reaches Inngest; idempotency is still required.

Event IDs provide a 24-hour deduplication window.

Function idempotency expressions provide a separate documented 24-hour key window ([idempotency](https://www.inngest.com/docs/guides/handling-idempotency)).

Those protections apply only when IDs/expressions are correctly supplied.

They are not perpetual exactly-once guarantees.

Admission begins with receipt of an Inngest event or invocation; durable enqueue is the platform boundary.

Self-hosted/development invocation without the production service inherits that deployment's persistence.

### Q3 — TENANCY

**Verdict: ABSENT as an agent authorization model.**

No AgentKit tenant, membership, invitation, or per-agent ACL entity was found.

The application must authorize event creation, function invocation, conversation access, and tool effects.

Inngest concurrency keys can partition and fairly schedule work by account/tenant ([concurrency](https://www.inngest.com/docs/guides/concurrency)).

Concurrency partitioning is operational isolation, not an access-control decision.

Inngest team/project administration does not establish end-user authorization inside the agent application.

### Q4 — HUMAN-IN-THE-LOOP

**Verdict: YES, a durable event wait.**

`step.waitForEvent()` suspends the function until a matching event or timeout ([wait for event](https://www.inngest.com/docs/reference/typescript/v4/functions/step-wait-for-event)).

The match expression can correlate approval to user, run, or request ID.

The wait consumes no continuously running application process.

On match, the event becomes the memoized step result.

On timeout, the result is `null` and workflow logic chooses the settlement.

A timeout is required, so “indefinite” approval requires a deliberately long or renewed protocol.

Approval authorization is the application's responsibility; correlation alone does not prove approver authority.

### Q5 — SANDBOX / EXEC

**Verdict: ABSENT.**

AgentKit tools execute on the developer's Inngest function compute with that compute's privileges.

Neither AgentKit nor Inngest defines a filesystem/process sandbox contract for model-generated actions.

A sandbox service can be wrapped as a tool, but that is application composition rather than a framework adapter standard.

Network and secret isolation inherit the function host and deployment configuration.

## 6. Restate durable agents

### Q1 — AUTHORING

**Form:** durable service/workflow/virtual-object handler around any agent loop; not an agent DSL.

Minimal shape ([AI quickstart](https://docs.restate.dev/ai-quickstart), [durable agents](https://docs.restate.dev/ai/patterns/durable-agents)):

```ts
import * as restate from '@restatedev/restate-sdk';

const agent = restate.service({
  name: 'agent',
  handlers: {
    run: async (ctx, prompt: string) => {
      const answer = await ctx.run('model', () => callModel(prompt));
      return answer;
    },
  },
});
```

Vercel AI models can be wrapped with Restate durable-call middleware.

Tools and non-deterministic operations belong in `ctx.run()` or calls to another Restate service.

### Q2 — DURABILITY

**Verdict: YES, journaled deterministic replay.**

Restate persists an invocation and journals durable operations.

After handler loss, the handler restarts and replays completed journal entries instead of repeating their code.

The first incomplete operation executes again.

`ctx.run()` isolates non-deterministic work and records its result.

Handler failures are retryable by default; terminal errors stop the invocation ([error handling](https://docs.restate.dev/develop/ts/error-handling)).

Retry policy can cap attempts for a particular operation.

Stable durable helpers exist for time and UUID generation.

Calls between Restate handlers in one durable invocation are deduplicated by the runtime ([service communication](https://docs.restate.dev/develop/ts/service-communication)).

Calls to external systems still require an idempotency key because an externally committed response may be lost.

A Workflow run is uniquely keyed and executes once for that workflow ID.

A Virtual Object serializes operations per key and owns durable state ([services](https://docs.restate.dev/foundations/services)).

Settlement is a successful journaled result or terminal failure; retryable failure remains live.

The service/runtime boundary, not the client process, owns recovery after accepted invocation.

### Q3 — TENANCY

**Verdict: PARTIAL keyed isolation; no end-user membership or per-agent ACL.**

Virtual Object keys naturally isolate durable state per user, account, conversation, or agent.

Single-writer execution per key prevents concurrent state mutation races.

This does not authenticate the caller or decide whether it may address that key.

Request identity secures service-to-service communication, not application tenant membership.

The application/gateway must enforce tenant ownership before invoking a keyed handler.

No member, role, invitation, or agent-grant data model was found.

### Q4 — HUMAN-IN-THE-LOOP

**Verdict: YES, durable promise/event suspension.**

Awakeables and named Workflow promises can wait for an external resolve/reject signal ([external events](https://docs.restate.dev/develop/ts/external-events)).

The wait is stored in Restate and survives handler/process loss.

FaaS compute can be released while the invocation is suspended.

The resolver uses the awakeable/promise identity to correlate approval.

Authorization of the resolver remains an application concern.

Durable timers can implement deadlines without a blocked process.

### Q5 — SANDBOX / EXEC

**Verdict: ABSENT.**

Restate controls invocation durability, not the privileges of user handler code.

Model calls and tools run in the application service environment.

External sandbox APIs can be placed behind durable operations or services.

No framework-standard filesystem/process sandbox adapter was found.

## 7. DBOS TypeScript

### Q1 — AUTHORING

**Form:** durable TypeScript workflow around an agent/model loop; not a dedicated agent graph.

Minimal Vercel AI integration ([Vercel AI integration](https://docs.dbos.dev/integrations/vercel-ai)):

```ts
const model = wrapLanguageModel({
  model: openai('gpt-5'),
  middleware: durableCalls(),
});

const researchAgent = DBOS.registerWorkflow(async (prompt: string) => {
  return (await generateText({ model, prompt })).text;
}, { name: 'researchAgent' });
```

Tool bodies should be wrapped in `DBOS.runStep()` or a registered transaction.

The durable-calls middleware checkpoints model calls without changing the surrounding agent API.

### Q2 — DURABILITY

**Verdict: YES, Postgres-backed workflow recovery.**

DBOS persists workflow status and step outputs in Postgres ([workflow tutorial](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial)).

On restart, a workflow recovers from its last completed step.

Completed steps are not re-executed.

Steps are at-least-once until completion is recorded.

Registered database transactions are documented as exactly-once.

External effects in steps still require idempotency for the commit-before-checkpoint window.

Step retry count and backoff are configurable.

An uncaught workflow exception settles the workflow in `ERROR`; it is not automatically retried forever.

A supplied workflow ID acts as an idempotency key: the workflow body executes once for that ID.

`startWorkflow()` returns after the workflow has been durably started and is guaranteed to continue under a correctly configured recovery deployment ([methods](https://docs.dbos.dev/typescript/reference/methods)).

DBOS Conductor supplies managed recovery; self-hosted distributed deployments must run the documented recovery arrangement.

The model middleware records successful model-call results and reuses them on replay.

### Q3 — TENANCY

**Verdict: PARTIAL identity propagation; no verified TypeScript per-agent membership model.**

DBOS authenticated context can carry a user and roles through workflow execution ([plugins/context](https://docs.dbos.dev/typescript/reference/plugins)).

That context is useful for audit and application authorization.

A current TypeScript contract that automatically enforces `required_roles` per workflow/agent was **UNVERIFIED**.

No tenant, membership, invitation, or agent ACL resource model was found.

Applications must validate the caller before starting, messaging, cancelling, or reading a workflow.

Workflow IDs should include or map through an authorized tenant scope; obscurity is not authorization.

### Q4 — HUMAN-IN-THE-LOOP

**Verdict: YES, durable workflow messaging.**

`DBOS.recv()` waits for a message addressed to the workflow and survives process restart ([workflow communication](https://docs.dbos.dev/typescript/tutorials/workflow-communication)).

`DBOS.send()` delivers from another workflow exactly once under the workflow execution contract.

External senders can supply an idempotency key to prevent duplicate delivery.

The waiting worker need not stay allocated.

Timeout behavior can be handled in workflow code.

Message authorization is not supplied by the correlation key.

### Q5 — SANDBOX / EXEC

**Verdict: ABSENT.**

DBOS durability does not isolate JavaScript, filesystem, process, or network access.

Steps run with the application's Node/database privileges.

A remote sandbox can be invoked from a durable step.

No standard sandbox provider interface was found.

## 8. OpenClaw

### Q1 — AUTHORING

**Form:** configuration plus an agent workspace filesystem; built-in gateway/runtime.

Minimal multi-agent configuration ([agent runtime](https://docs.openclaw.ai/agent)):

```json5
{
  agents: {
    list: [
      { id: 'main', name: 'Assistant', workspace: '~/.openclaw/workspace' }
    ]
  }
}
```

Workspace bootstrap files define agent instructions, persona, tools, and local context.

The Gateway owns sessions, channels, routing, queues, cron, tools, and the turn loop.

OpenClaw source types import `@mariozechner/pi-agent-core` and `pi-coding-agent`, verifying Pi integration at code level ([source](https://github.com/openclaw/openclaw/blob/main/src/plugins/types.ts)).

The precise claim that every current OpenClaw agent-loop path is “built on Pi” is **UNVERIFIED** from the public runtime contract.

### Q2 — DURABILITY

**Verdict: PARTIAL recovery-oriented durability; no exactly-once step contract.**

The Gateway validates a turn, persists metadata, and returns a `runId` plus `acceptedAt` ([agent loop](https://docs.openclaw.ai/agent-loop)).

Per-session queues serialize turns.

Conversation/session metadata and transcripts are stored per agent.

Restart recovery reconciles interrupted main turns, subagent records, background tasks, outbound messages, and cron state ([restart recovery](https://docs.openclaw.ai/gateway/restart-recovery)).

Recovery is enabled by default.

Graceful restart drains active work for a bounded period.

Stale subagents may be finalized rather than resumed.

Repeatedly failing recovery records can be tombstoned to prevent a restart loop.

Unsafe transcript tails are not blindly replayed; the system may request that the user resend.

Outbound delivery has a retry queue.

Short-lived inbound deduplication exists for repeated channel messages ([messages](https://docs.openclaw.ai/messages)).

No general durable idempotency key for agent turns was found.

No per-tool persisted settlement or exactly-once side-effect guarantee was found.

Recovery is reconciliation by subsystem, not deterministic replay from journaled steps.

The status of a tool effect that committed immediately before a crash can remain ambiguous.

### Q3 — TENANCY

**Verdict: ABSENT for hostile multi-tenancy; channel allowlists and per-agent policy exist.**

Multiple agents can have separate workspaces, sessions, sandbox scopes, and tool policies ([multi-agent sandbox/tools](https://docs.openclaw.ai/tools/multi-agent-sandbox-tools)).

Channel pairing, sender allowlists, and access groups restrict who can message the gateway.

The documented trust model treats gateway-authenticated callers as trusted operators.

Exec approval is explicitly not a per-user authorization boundary.

No organization/member/agent-role data model was found.

Do not expose one Gateway as an isolation boundary between mutually hostile tenants.

### Q4 — HUMAN-IN-THE-LOOP

**Verdict: PARTIAL; approval exists, crash-durable pending approval is UNVERIFIED.**

Exec policy can require approval for commands outside an allowlist ([exec](https://docs.openclaw.ai/tools/exec)).

Native UI flows may wait inline.

Asynchronous execution can return an `approval-pending` identifier and later emit progress/completion.

Denial or timeout is terminal and does not silently execute the command.

The current documentation does not establish that a pending approval record survives a Gateway crash and resumes the original turn exactly once.

Accordingly it cannot be classified as a verified durable pause.

### Q5 — SANDBOX / EXEC

**Verdict: YES, configurable; off by default; not a complete security boundary.**

Tool execution can run in configured sandbox backends with per-agent, per-session, or shared scope ([sandboxing](https://docs.openclaw.ai/gateway/sandboxing)).

The Gateway itself remains on the host; sandboxing principally contains tool execution.

Host execution is possible and is the default in some modes.

Elevated execution deliberately escapes the sandbox.

Exec approvals can bind allowlisted canonical executable paths, arguments, working directory, and environment policy.

Documentation warns that approval/allowlists are guardrails, not a multi-user authorization boundary.

Backend-specific network, mount, persistence, and privilege guarantees must be checked separately.

The backend choice is configurable, but a public third-party sandbox-provider interface was **UNVERIFIED**.

## Cross-framework comparison

| Framework | Q1 — Authoring | Q2 — Durability | Q3 — Tenancy | Q4 — Human-in-the-loop | Q5 — Sandbox / exec |
|---|---|---|---|---|---|
| OpenAI Agents SDK / Responses / Agent Builder | Code-first `Agent`; Responses primitives; deprecated hosted visual graph | SDK **ABSENT**; serializable `RunState`; background Response **PARTIAL**, no step journal | Project roles/key scopes; no per-agent membership | Serializable pause; durable only when app persists and schedules resume | Hosted containers plus pluggable local interfaces; Sandbox Agents beta |
| Cloudflare Agents / Think | Durable Object `Agent`; `AgentWorkflow`; Think harness; runtime-loaded Dynamic Workflows | **YES**: state, managed admission fibers, app-defined fiber recovery, step-persistent Workflows | Per-ID isolation, auth hooks, readonly mode, tenant routing; no membership graph | **YES**: Workflow event pause; Think abort-record-replay approval | Isolated Worker code mode, Think runtime, Containers; host-authorized bridges |
| Mastra | Code-first `Agent`; typed workflow graph | Agent **ABSENT**; snapshots/retries for workflows; stronger optional Inngest/Temporal runtimes | **YES**: Enterprise FGA per agent/workflow/tool/memory, with route boundaries | **YES** with persistent workflow snapshot | Pluggable Workspace plus local/Daytona/E2B/Blaxel sandboxes |
| LangGraph JS / Platform | Explicit state graph or Functional API | **YES**: super-step checkpoints, pending writes, task memoization; external effects not exactly-once | Platform custom per-resource auth and workspace RBAC; OSS none | **YES**: durable interrupt; entire node restarts | Core **ABSENT**; adjacent Deep Agents backends are pluggable |
| Inngest AgentKit | Code-first agents and network/router | **YES**: event admission, step memoization/replay/retries; bounded idempotency windows | **ABSENT**; concurrency partitioning is not auth | **YES**: durable correlated event wait with timeout | **ABSENT** |
| Restate | Durable service/workflow/object wraps any loop | **YES**: journal replay, durable calls, keyed workflows/objects | Keyed state isolation; no membership/ACL | **YES**: awakeable or named durable promise | **ABSENT** |
| DBOS TypeScript | Registered workflow plus durable model middleware | **YES**: Postgres steps, durable start, workflow-ID idempotency, exactly-once DB transactions | Identity/role context only; no verified per-agent ACL | **YES**: durable workflow messaging | **ABSENT** |
| OpenClaw | Config plus workspace filesystem and Gateway | **PARTIAL**: accepted run, subsystem reconciliation, transcript/queue recovery; no step settlement | Channel allowlists and policy; not hostile multi-tenant | Approval exists; crash durability **UNVERIFIED** | Configurable sandbox scopes; host/elevated escape; off by default |

## Mechanisms not yet seen elsewhere

This section is deliberately conservative.

The comparison baseline is the previously analysed Flue, Vercel eve, and Anthropic Managed Agents.

Features that merely reproduce durable runs, tool calls, streaming, ordinary approval gates, filesystem workspaces, or hosted sandboxes are omitted.

### OpenAI Agents SDK / Responses / hosted surfaces

**No clearly novel durability or tenancy mechanism.**

Serializable `RunState` is useful portability, but application-owned checkpoint serialization is not treated as novel against the baseline.

Responses background mode is a durable single-response convenience, not a new agent execution model.

Agent Builder's versioned visual workflow publication is deprecating and does not establish a new recovery contract.

### Cloudflare Agents SDK / Think

**Managed fibers expose durable acceptance separately from recovery policy.**

`startFiber()` durably admits named work and deduplicates it, while `onFiberRecovered()` deliberately leaves semantic recovery to the agent.

This is a distinct middle layer between a raw async task and deterministic replay.

**Synchronous stash replacement gives explicit application-defined recovery capsules.**

The developer chooses the compact recovery state rather than accepting framework replay of every call.

**Think's abort-record-replay approval protocol is novel.**

Model-written code is aborted at an unapproved action; completed tool calls are replayed from records; only the approved action is applied before program continuation.

This turns approval into deterministic continuation of generated code rather than a generic “resume the loop” signal.

**Dynamic Workflows durably execute runtime-loaded, tenant-selected workflow code.**

The Workflow engine can reload the correct Dynamic Worker after isolate recycle while retaining step progress.

This separates durable workflow identity/state from statically deployed implementation code.

**Think's submission ledger delays transcript mutation until execution begins.**

Durably accepted then cancelled work can remain absent from the conversational record.

That separates queue truth from dialogue truth.

### Mastra

**Fine-grained authorization is a first-class agent runtime concern.**

Enterprise FGA names agent, workflow, standalone tool, agent-scoped tool, memory thread, and stored-resource permissions.

It also documents the critical boundary where direct SDK calls bypass route enforcement.

This is materially more specific than platform workspace roles or application-supplied authentication hooks.

The workspace/sandbox provider split is useful but not counted as novel against the prior managed-agent baseline.

### LangGraph

**Super-step checkpoints retain pending writes from successful parallel siblings.**

Recovery need not repeat successful sibling nodes merely because another node in the same parallel super-step failed.

**Interrupt resumption deliberately restarts the whole node and matches resume values by interrupt index.**

This exposes a precise, unusual replay law that makes pre-interrupt idempotency obligations inspectable.

**Checkpoint time travel is an execution primitive.**

A past state can be inspected, amended, replayed, or forked into a new continuation rather than only resumed at the latest point.

### Inngest AgentKit

**Event-native human correlation and tenant-fair execution are the differentiators, not a new agent abstraction.**

Approval is an ordinary durable event wait using the same event log and expression matcher as all other orchestration.

Account-keyed concurrency can fairly schedule noisy tenants, although it is explicitly not authorization.

If eve's previously analysed durable event execution already covers these patterns, then AgentKit adds **nothing genuinely novel**.

### Restate

**Keyed Virtual Objects combine single-writer agent state with journaled invocation replay.**

The same key supplies addressability, state ownership, serialization, and a recovery scope.

**Awakeables are externally resolvable durable continuations independent of a dedicated approval node.**

Any external protocol can hold and later resolve the continuation by identity.

If Flue's Durable Object base already provides equivalent keyed single-writer state and alarm recovery, only the journal/awakeable composition remains distinct.

### DBOS TypeScript

**Durable model-call middleware can retrofit checkpointing into an existing model interface.**

The agent code retains its normal Vercel AI shape while middleware journals individual model results.

**Exactly-once database transactions are available inside the same Postgres-backed workflow runtime.**

This is narrower than exactly-once tools, but stronger than generic step memoization for database-resident effects.

### OpenClaw

**Recovery is subsystem reconciliation for a persistent personal-assistant gateway.**

It separately reconciles conversational turns, subagents, background tasks, outbound delivery, and cron state rather than replaying one workflow journal.

Unsafe transcript tails can be surfaced to the user instead of automatically replayed.

If the prior eve analysis already includes channel/gateway recovery and outbound-delivery reconciliation, OpenClaw adds **nothing genuinely novel**.

Its configurable local sandbox and exec approvals are operationally useful but not novel relative to the prior managed-agent systems.
