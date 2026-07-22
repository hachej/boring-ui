# Agent cloud vision

> **Hypothetical Step 3/later vision; non-binding and not an A1 schema.** Terms
> such as bundle, registry, deploy, tool declaration, and sandbox handler below
> describe possible future products only. They are not the current
> `AgentDefinition`, do not authorize authored executable references, and impose
> no requirement on the A1 compiler/validator. Decision 28, `plan.md`, and the
> #805 fleet plan control: current authored source is identity/safe metadata/
> instructions only; trusted host plugins own executable behavior; there is no
> mutable registry/control plane. Any future custom-tool/bundle/registry design
> requires a new accepted decision, schema version, security proof, and named
> consumer.

## 1. Purpose

The owner's long-term vision is an "agent cloud": a developer writes a
domain-specific agent against the declarative framework and ships it with one
CLI command (`seneca deploy`), the same way a Vercel user ships a web app with
`vercel deploy`. This note exists to keep current execution—static application
Agent fleet, Workspace-persisted default, service-shaped Agent applications,
governed Environment service, then authenticated MCP—pointed at that eventual
shape so nothing built now has to be undone later. Signup domain only initializes
the default. It is deliberately non-binding: it does not create, reorder, or
gate any Bead, and it does not change [Decision 28](../../DECISIONS.md)'s
sequencing. If anything here conflicts with `plan.md` or
`AGENT-CONSUMPTION-MODES.md`, those documents control.

## 2. Three layers

The agent cloud has three layers. Keeping them distinct is the whole point of
this note.

### Framework (boring-ui packages)

Today a developer writes declarative A1 identity/safe metadata/instructions and
the trusted host binds plugins. Hypothetical future schema versions may add
bounded data-only declarations after a separate decision. Host/CLI
configuration defines a static Agent fleet; Workspace persists its default and
orchestrates the fleet. Exact signup-domain mapping is a web-host initializer
only. This is not a mutable service registry or current bundle contract.

### Control plane — Seneca ("the farm" / console)

Seneca is the multi-tenant control plane: auth, workspaces, the
a hypothetical future agent-definition registry, sessions/transcripts,
billing, and (eventually) a
Vercel-style console for deploying and inspecting agents. The control plane
holds only DATA — configuration, definitions, records — never user-supplied
code that executes. That is precisely what makes it safe to run multi-tenant:
there is no tenant code-execution surface to isolate on this layer, only
authorization and bookkeeping.

### Data plane — sandbox runtime ("seneca-cloud")

The data plane is the only place user code executes: Agent turns, shell
commands, custom tool handlers, and repo operations. `boring-bash` owns the
transport-neutral Environment service used by Agent tools, bash, UI, and CLI;
`boring-sandbox` supplies Agent/Workspace-neutral providers such as Vercel today
and a self-operated fleet later. One canonical Environment filesystem—not a
host/Sandbox synchronization pair—is the working-data authority. Provider swap
is an adapter change, not a control-plane rewrite. There is
no third "AgentHost" service in this model; AgentHost was removed (Decision
25) and nothing here proposes reviving it under a new name.

## 3. The one rule that keeps the split honest

For every artifact the framework or a tenant supplies, ask one question: does
it EXECUTE, or is it DATA?

- Current A1 definitions contain identity/safe metadata/instructions. A future
  approved schema might contain bounded tool declarations; that hypothetical
  data would be validated on the control plane. Fleet configuration remains
  trusted host/CLI policy.
- Handlers, shell invocations, repo/file work, anything that runs a model's
  tool call against real state → code → executes only in the sandbox, on the
  data plane.

This single question is the test for "does this belong on the control plane
or the data plane" for any future feature, not just custom tools.

## 4. Hypothetical Step 3/later custom tools

This section is not an A1 contract and does not describe current
`AgentDefinition`. If separately approved, a future custom tool could have two
halves on different planes:

- **Declaration** — name, description, JSON schema. This is data: it is what
  gets handed to the model, it lives on the control plane (in the agent
  definition), and it is validated the same way any other definition field
  is.
- **Handler** — the code that actually runs when the model calls the tool.
  This is user code. It ships inside the agent bundle and executes ONLY in
  the sandbox, never on the control plane.

The agent loop itself is framework code and runs on the control plane; every
tool invocation crosses the sandbox boundary through the Operations adapter
(coding invariant 9: Pi file/shell tools flow through Pi factories plus
Operations adapters). That boundary crossing is not new machinery — it is the
same seam file/shell tools already use, generalized to tenant-declared tools.

**Hypothetical mechanism, not approved.** A future tool handler could be an
entrypoint script inside an agent bundle. Invocation is a sandbox exec: JSON args on stdin, JSON result on
stdout. This is the MCP-stdio pattern applied to a script instead of a
process, reuses the existing shell-in-sandbox execution path, and needs zero
new wire protocol.

**Forbidden.** Tenant tool definitions may never point at in-process JS
modules loaded via `import()` inside the control-plane process. That
in-process extension path exists for trusted first-party Pi plugins only —
code the platform operator wrote and reviewed, not tenant-supplied code. A
future versioned bundle compiler—not the A1 compiler—would have to reject an
in-process tenant handler. Current A1 rejects all authored tool/handler/package
selection before this distinction arises.

**Hygiene**, required before any tenant custom-tool execution ships:

- secrets are injected per invocation into the sandbox, never baked into
  images or into the agent bundle itself;
- every handler invocation has a timeout;
- default-deny network egress per tenant, with explicit allowlisting where a
  tool genuinely needs an external call.

## 5. Two consumption tiers

Two tiers map onto the modes and terms in
[`AGENT-CONSUMPTION-MODES.md`](AGENT-CONSUMPTION-MODES.md).

### SaaS

Shared Seneca control plane with governed Environment backends on the data
plane. A hypothetical future `seneca deploy` could POST a versioned declarative
deployment definition—not today's A1 `AgentDefinition`—with no image build, so
deploy is seconds. Current signup domains are acquisition/onboarding entrypoints:
they initialize a newly created Workspace's fleet default and then disappear
from authorization/routing. Workspace/default identity persists for later web,
CLI, MCP, or channel ingress. Authenticated MCP onto that same Workspace/default
is the external ingress surface.

### Enterprise / self-host

Instance-per-tenant: one deployment (compose-based today) dedicated to one
customer, following the same shape described in
[`docs/plans/self-host-app-db-with-vercel-sandbox-plan.md`](../../plans/self-host-app-db-with-vercel-sandbox-plan.md)
and [`docs/plans/remote-sandbox-self-host-analysis.md`](../../plans/remote-sandbox-self-host-analysis.md).
The same future framework/schema version and sandbox contract—not an A1
promise—would make this a second consumption tier of the same product, not a
fork of the codebase.

## 6. What the retired D1/AgentHost concepts become

AgentHost's controller/registry/CAS machinery was removed (Decision 25). Its
underlying concerns still exist; they map onto ordinary deploy-pipeline and
data-plane concepts instead of a bespoke controller:

| Retired AgentHost concept | Becomes, in the agent-cloud model |
| --- | --- |
| Revision pinning | Image digest / SHA pinning in the deploy pipeline |
| Exact-revision rollback | Redeploy the previous compatible SHA; executed proof stays an F8a/H8 gate. |
| Admission-before-effects | Definition validation at `seneca deploy` time |
| Isolation / DR | Container + sandbox boundary, plus ordinary DB backups |

Consolidating many small tenants onto shared instances, if ever needed, reuses
the static fleet plus Workspace/default and Environment-service contracts rather
than reviving a controller. Only a named lifecycle need—not raw scale—could
justify additional admission machinery, under a new decision.

## 7. Policing rules

- Current A1 definitions stay identity/safe metadata/instructions only. A future
  versioned compiler would reject executable hooks destined for the control
  plane (see §4's hypothetical forbidden case).
- The `boring-bash` Environment service contract is the consumer-facing
  versioned interface; `boring-sandbox` provider contracts are its backend seam.
  This lets execution move without touching Agent/Workspace semantics.
- Sessions and transcripts stay on the control plane's durable volume, per
  AGENTS.md hard rule 9 — they are host app user data, not sandbox/workspace
  runtime state.
- Secrets are encrypted at rest on the control plane and injected per
  execution into the sandbox; they are never baked into an image or bundle
  (restated from §4, because it applies to all secrets, not only
  custom-tool secrets).

## 8. Non-goals now

- No `seneca-cloud` repository or self-operated production fleet in the current
  product delivery. F1/F2 correct the local semantic/backend contracts; remote
  production rollout still follows #808's independent gates.
- No console build-out beyond what Decision 28 F0–F8b already need.
- No marketplace or billing surface until there is a first external
  developer or a second real paying tenant to build it for.
- Decision 28 F0–F8b is the active work. Everything else in this document is
  context, not an independent work item.

## 9. Own-cloud SaaS data plane (owner decision 2026-07-19)

Owner goal: the SaaS tier ultimately runs on our own cloud. Vercel sandbox is
explicitly a BRIDGE for the current fleet/Environment delivery, not a permanent dependency —
the same cost logic that already drove the Neon and Fly exits elsewhere in
this stack.

Target architecture is two independent backend concerns behind the neutral
`boring-sandbox` provider seam consumed by `boring-bash` (see
[`docs/issues/808/plan.md`](../808/plan.md)):

- **Placement** — a `remote-worker` executor fleet on owned VPS boxes,
  replacing the Vercel-hosted placement while speaking the same sandbox
  contract.
- **Isolation** — Docker + gVisor (`runsc`) per execution. Containers alone
  are not a tenant boundary. Firecracker was considered and rejected for its
  operational weight at current scale.

There is already a head start on `main`: a `runsc` preflight probe
(`packages/boring-sandbox/src/providers/runsc`, `productionReady: false` by
design) and a hostile-isolation qualification harness
(`scripts/qualify-docker-runsc-isolation.mjs`). The promotion path is for
that qualification harness to become a CI acceptance gate once the provider
is actually implemented.

Decision 28 sequences the neutral backend and Environment-service correction in
F1/F2 because they are direct consumers of the Agent/Workspace abstraction. The
remote-worker/runsc production rollout still obeys #808's independent security,
qualification, and release gates.
