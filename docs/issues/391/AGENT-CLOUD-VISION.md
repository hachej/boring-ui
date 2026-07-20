# Agent cloud vision

> **Hypothetical Step 3/later vision; non-binding and not an A1 schema.** Terms
> such as bundle, registry, deploy, tool declaration, and sandbox handler below
> describe possible future products only. They are not the current
> `AgentDefinition`, do not authorize authored executable references, and impose
> no requirement on the A1 compiler/validator. Decision 26, `plan.md`, and the
> #805 A1 plan control: current authored source is identity/safe metadata/
> instructions only; trusted host plugins own executable behavior; there is no
> mutable registry/control plane. Any future custom-tool/bundle/registry design
> requires a new accepted decision, schema version, security proof, and named
> consumer.

## 1. Purpose

The owner's long-term vision is an "agent cloud": a developer writes a
domain-specific agent against the declarative framework and ships it with one
CLI command (`seneca deploy`), the same way a Vercel user ships a web app with
`vercel deploy`. This note exists to keep Step 1A/1B execution — domain →
workspace type → default agent over a multi-agent-ready Workspace backend,
then authenticated MCP onto that same Workspace/default — pointed at that
eventual shape, so nothing built now has to
be undone later. It is deliberately non-binding: it does not create, reorder,
or gate any bead, and it does not change [Decision 26](../../DECISIONS.md)'s
sequencing. If anything here conflicts with `plan.md` or
`AGENT-CONSUMPTION-MODES.md`, those documents control.

## 2. Three layers

The agent cloud has three layers. Keeping them distinct is the whole point of
this note.

### Framework (boring-ui packages)

Today a developer writes declarative A1 identity/safe metadata/instructions and
the trusted host binds plugins. Hypothetical future schema versions may add
bounded data-only declarations after a separate decision. Workspace types and
domain routing remain library/host surfaces: exact domain → persisted typed
Workspace → Workspace-selected default/allowed policy. This is not a service or
current bundle contract.

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

The data plane is the only place user code executes: agent turns, shell
commands, custom tool handlers, repo operations. Today that is the Vercel
sandbox, reached through the existing `BORING_AGENT_MODE=vercel-sandbox` seam
(coding invariant 5: Workspace + Sandbox swap and dispose as one
runtime-mode pair). Later it may be a self-operated fleet ("seneca-cloud")
speaking the *same* sandbox contract, swapped in as an adapter behind that
seam — not a rewrite of the control plane, not a new service class. There is
no third "AgentHost" service in this model; AgentHost was removed (Decision
25) and nothing here proposes reviving it under a new name.

## 3. The one rule that keeps the split honest

For every artifact the framework or a tenant supplies, ask one question: does
it EXECUTE, or is it DATA?

- Current A1 definitions contain identity/safe metadata/instructions. A future
  approved schema might contain bounded tool declarations; that hypothetical
  data would be validated on the control plane. Workspace-type mappings remain
  host policy.
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

Shared Seneca control plane, per-execution sandboxes on the data plane.
A hypothetical future `seneca deploy` could POST a versioned declarative
deployment definition—not today's A1 `AgentDefinition`—with no image build, so
deploy is seconds. Step 1A's domain → typed Workspace → default-agent routing
over a multi-agent-ready backend *is* the per-tenant-domain mechanism for this
tier — it is the
Vercel-domains analogue (a domain selects product configuration, the way a
custom domain selects a Vercel project; it never grants access on its own).
Step 1B's authenticated MCP onto that same workspace/agent is this tier's
external ingress surface.

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
| Exact-revision rollback | Redeploy the previous SHA; executed proof stays a gate (see bead 1A.10b) |
| Admission-before-effects | Definition validation at `seneca deploy` time |
| Isolation / DR | Container + sandbox boundary, plus ordinary DB backups |

Consolidating many small tenants onto shared instances, if that is ever
needed, reuses Step 1A's workspace-type routing mechanism rather than
reviving a controller. Only that consolidation need — not raw scale — would
justify any admission-style machinery earning its way back in, and it would
require a new decision per Decision 25/26's re-evaluation clauses.

## 7. Policing rules

- Current A1 definitions stay identity/safe metadata/instructions only. A future
  versioned compiler would reject executable hooks destined for the control
  plane (see §4's hypothetical forbidden case).
- The sandbox contract (today `BORING_AGENT_MODE=vercel-sandbox`) is the most
  important versioned interface in this model — it is what lets the data
  plane be swapped later without touching the control plane or the
  framework.
- Sessions and transcripts stay on the control plane's durable volume, per
  AGENTS.md hard rule 9 — they are host app user data, not sandbox/workspace
  runtime state.
- Secrets are encrypted at rest on the control plane and injected per
  execution into the sandbox; they are never baked into an image or bundle
  (restated from §4, because it applies to all secrets, not only
  custom-tool secrets).

## 8. Non-goals now

- No `seneca-cloud` repository or self-operated fleet today — the data plane
  stays Vercel sandbox until Step 1A ships and the SandboxProviderV1
  extraction (§9) lands. See §9 for the target shape once that gate clears.
- No console build-out beyond what Step 1A/1B already need.
- No marketplace or billing surface until there is a first external
  developer or a second real paying tenant to build it for.
- Step 1A and Step 1B remain the only active work. Everything in this
  document is context for later steps, not a new work item.

## 9. Own-cloud SaaS data plane (owner decision 2026-07-19)

Owner goal: the SaaS tier ultimately runs on our own cloud. Vercel sandbox is
explicitly a BRIDGE to get Step 1A/1B shipped, not a permanent dependency —
the same cost logic that already drove the Neon and Fly exits elsewhere in
this stack.

Target architecture is two independent pieces behind the `SandboxProviderV1`
seam (being extracted, see [`docs/issues/808/plan.md`](../808/plan.md) /
PR #823):

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

Trigger/sequencing is unchanged by this decision: this work starts only
after Step 1A ships and the #823 `SandboxProviderV1` extraction lands, not
before.
