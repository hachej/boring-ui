# Agent cloud vision

> North-star vision note. Non-binding on current beads. This document records
> the owner's long-term "agent cloud" shape so Step 1A/1B execution stays
> aligned with where the platform is headed. It creates no new work items.
> Decision 26 sequencing (Step 1A, then 1B, then Step 2, then Step 3) is
> unchanged by anything in this file.

## 1. Purpose

The owner's long-term vision is an "agent cloud": a developer writes a
domain-specific agent against the declarative framework and ships it with one
CLI command (`seneca deploy`), the same way a Vercel user ships a web app with
`vercel deploy`. This note exists to keep Step 1A/1B execution — domain →
workspace type → sole agent, then authenticated MCP onto that same
workspace/agent — pointed at that eventual shape, so nothing built now has to
be undone later. It is deliberately non-binding: it does not create, reorder,
or gate any bead, and it does not change [Decision 26](../../DECISIONS.md)'s
sequencing. If anything here conflicts with `plan.md` or
`AGENT-CONSUMPTION-MODES.md`, those documents control.

## 2. Three layers

The agent cloud has three layers. Keeping them distinct is the whole point of
this note.

### Framework (boring-ui packages)

What a developer writes against: declarative agent authoring (A1 — an
`AgentDefinition` plus assets, no imperative bootstrap code), workspace types,
and domain routing (Step 1A: exact domain → persisted workspace type → one
trusted server-only agent behavior). This is a library/schema surface, not a
service. It ships as the existing boring-ui packages (`@hachej/boring-agent`,
`@hachej/boring-workspace`, etc.) and runs wherever the host process runs.

### Control plane — Seneca ("the farm" / console)

Seneca is the multi-tenant control plane: auth, workspaces, the
agent-definition registry, sessions/transcripts, billing, and (eventually) a
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

- Definitions, schemas, config, tool declarations (name/description/JSON
  schema), workspace-type mappings → data → lives and is validated on the
  control plane.
- Handlers, shell invocations, repo/file work, anything that runs a model's
  tool call against real state → code → executes only in the sandbox, on the
  data plane.

This single question is the test for "does this belong on the control plane
or the data plane" for any future feature, not just custom tools.

## 4. Custom tools

A tool has two halves, and they live on different planes:

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

**v1 mechanism.** A tool handler is an entrypoint script inside the agent
bundle. Invocation is a sandbox exec: JSON args on stdin, JSON result on
stdout. This is the MCP-stdio pattern applied to a script instead of a
process, reuses the existing shell-in-sandbox execution path, and needs zero
new wire protocol.

**Forbidden.** Tenant tool definitions may never point at in-process JS
modules loaded via `import()` inside the control-plane process. That
in-process extension path exists for trusted first-party Pi plugins only —
code the platform operator wrote and reviewed, not tenant-supplied code. The
A1 compiler/validator must reject any tenant bundle that declares an
in-process handler; a tenant tool declaration with no sandboxed entrypoint is
invalid, not degraded.

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
`seneca deploy` POSTs a validated declarative `AgentDefinition` — no image
build, deploy is seconds. Step 1A's domain → workspace-type → sole-agent
routing *is* the per-tenant-domain mechanism for this tier — it is the
Vercel-domains analogue (a domain selects product configuration, the way a
custom domain selects a Vercel project; it never grants access on its own).
Step 1B's authenticated MCP onto that same workspace/agent is this tier's
external ingress surface.

### Enterprise / self-host

Instance-per-tenant: one deployment dedicated to one customer. The deployable
app repository owns its provider and operations configuration; this framework
repository retains only the topology and sandbox analysis in
[`docs/plans/remote-sandbox-self-host-analysis.md`](../../plans/remote-sandbox-self-host-analysis.md).
Same framework, same `AgentDefinition` shape, same sandbox contract — this is
a second consumption tier of the same product, not a fork of the codebase.

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

- Definitions stay declarative: the A1 compiler rejects executable hooks in
  anything destined for the control plane (see §4's forbidden case).
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
