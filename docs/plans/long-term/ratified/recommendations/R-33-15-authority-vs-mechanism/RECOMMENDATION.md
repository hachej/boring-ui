# R-33-15 — Split authority from mechanism; draft D31

Status: proposed · Kind: decision amendment · Cost: low (docs) + gates R-33-14/12
Source: DeepSeek scout + D25–D29 re-read, 2026-08-14

## Claim

"Everything is a plugin" is a **capability** question. "Who may widen what an
agent can do" is a **security** question. D25–D29 answered the second and were
read as answering the first. Separate the axes explicitly, with one test, and
most of the apparent contradiction disappears.

## The test

> **Can this unit increase what the agent is permitted to do?**
>
> **Yes → authority.** Single, host-owned, inside the `createAgentHost()` funnel,
> never selected by authored data, never runtime-mutable.
>
> **No → mechanism.** Freely pluggable. Multiple implementations, selected at
> composition time by profile.

Authority is the power to **mint or widen** a capability, decide membership,
define what is durably true, or validate the fleet. Mechanism is everything that
operates *within* a capability already granted.

Note the test is about *widening*, not about *importance*. A loop plugin is
enormously consequential and still cannot widen anything — it can only spend
capabilities it was handed. That is why it is safe to make pluggable, and why
"but the loop is critical" is not an argument against it.

## Applying it to our six seams

| unit | can it widen? | class | verdict |
| --- | --- | --- | --- |
| Agent loop | No — spends granted capabilities | mechanism | **pluggable**; D25–D29 do not forbid this |
| Session persistence *backend* | No — stores what it is given | mechanism | **pluggable** (JSONL / SQLite) |
| Session **event vocabulary + append discipline** | Yes — defines what is durably true | authority | single, host-owned (this is R-33-10) |
| Model **adapter** | No — receives an opaque client | mechanism | **pluggable** |
| `ModelCapabilityIssuer` | Yes — mints the credential | authority | single, host-trusted (D27, unimplemented) |
| Sandbox **provider** | **Yes** — a weaker provider widens reach | authority-adjacent | host-selected only; see below |
| **Tool registration** | **Yes** — a new tool is new capability | authority | see below |
| Scope minting / fleet validation | Yes | authority | `createAgentHost()`, D29 |

## The two rows that explain our live defects

**Tool registration is authority, not mechanism.** Adding a tool adds capability
by definition. This reclassification explains two findings at once:

- `buildAgentComposition.ts:181` — `[...standardTools, ...(runtimeScope.extraTools ?? [])]`, first-wins. A plugin tool that shadows a standard tool name is a capability substitution, decided by array order.
- `mergeTools.ts:37,63` — the collision policy that would have made this explicit is **dead** (zero non-test consumers, per the census). The mechanism to treat collisions as an authority question was built and never wired.

**Sandbox provider selection is authority-adjacent.** Provider choice *is* the
isolation guarantee — `direct` and `runsc` do not confine equally. So R-33-14's
composition-time selection is safe only if selection stays host-owned and never
becomes profile-authorable by a tenant. Worth stating in D31 rather than
discovering later.

This also gives the sharpest statement of the external-plugin problem:
`runtimeBackendRegistry.ts:228,241,243` imports **external** plugin code into the
unsandboxed host and lets it register routes. That is untrusted authored content
acquiring authority — the exact thing D26 bans, and it is live.

## Why dsh can do what we cannot

`dsh` has **no trust split**: every plugin is trusted, so authority and mechanism
are the same class and everything is pluggable. That is coherent for a
single-tenant developer tool. It is also why they have no tenancy — the two
properties trade against each other, and they took the other side.

Our version: **maximally pluggable on the mechanism axis, strictly singular on
the authority axis.** That is a stronger position than either "everything is a
plugin" or "nothing is", and it is what our existing `trust:
"local-trusted-native"` marker was already reaching for.

## Proposed D31 — Behavior seams are composition-time, not runtime

Amendment retaining D28/D29 in full; supersedes nothing.

- **What** — Units that cannot widen agent capability may have multiple host-trusted implementations, resolved once at startup by `AgentFleetCompiler` inside `createAgentHost()` and named by a profile. Changing the selection requires deploy/restart. Units that can widen capability remain single, host-owned, and inside the funnel. Tool registration is classified as authority.
- **Why** — Six seams exist and none is selectable (census). D27/D28 already ratified plural trusted adapters four times (CLI fleet adapter, `ModelCapabilityIssuer` per host, remote Environment adapters, sandbox provider backend). D31 states the general rule those were instances of.
- **Rationale** — The funnel exists for scope minting and fleet validation, not to constrain what runs inside it. Composition-time selection adds no registry, no controller, no mutation lifecycle, no authored authority — the four things D25–D29 actually reject.
- **Re-evaluate when** — a named consumer needs runtime-mutable or tenant-authored behavior selection. That trigger returns to the D25–D29 rejection deliberately, and requires its own decision covering sandboxing of authored executable code.

## What D31 does NOT solve

User-authored **executable** plugins for senecaapp.ai. D26's rule stands
(*"Authored JSON never selects executable packages, tools, credentials, MCP
commands, models, or runtime policy"*), and the unsandboxed external import is
live. That needs a separate decision about confining authored code — D31 only
legalizes host-trusted plurality.

## Refutation — RUN, and it half-fired

Investigated 2026-08-14: [`research/loop-authority-trace.md`](research/loop-authority-trace.md).

| question | answer |
| --- | --- |
| Can a loop defeat approval? | **Void — no server-side approval gate exists.** Zero hits repo-wide outside front-end render states. Our model is admission/attenuation (D28), not approval. |
| Can a loop widen capability? | **No.** `AgentHarnessFactoryInput.tools` is pre-built and pre-attenuated; the harness has no tool-minting facility. Holds *only for host-trusted, in-process implementations* — an untrusted harness bypasses the agent abstraction entirely via `node:fs`. |
| Can a loop elide records? | **YES.** One writer repo-wide (`harnessPiChatService.ts:758`), fed solely by harness-emitted events; `eventStore?` optional and flag-gated off by default; the request ledger covers gateway operations, not tool calls. `AgentHarness.sessions: SessionStore` — the harness owns storage outright. |

**Result: the test survives with a precondition.**

> A loop may be classified as mechanism **only once the host owns the log.**
> Until then it is authority over the record, and D31 must not cover it.

Dependency: **R-33-01 → R-33-15/D31 → R-33-14.** D31 cannot be signed off before
R-33-01 lands, or it legalizes a seam that can rewrite history. R-33-01's spike
(`~/projects/spike-pi-storage`) is the enabling condition, already proven.

## Two findings that fell out

1. **The loop is already a swappable seam.** `harnessFactory` is threaded through
   every host (`createAgent.ts:72`, `agent-host/types.ts:379`, core `:203,1588`,
   workspace `:172,1694`, standalone `:48,207`, `bin/boring-agent.ts:138`). The
   claim "D25–D29 forbid a pluggable loop" was wrong twice: they do not, and we
   shipped it.
2. **The front ships approval affordances the server cannot honour.**
   `Tool.tsx:13-14` renders `'approval-requested'` / `'approval-responded'` and
   `tool-call-group-state.ts:1` has `'approval-needed'`, with **no server
   producer anywhere**. Needs its own issue — either wire a gate or remove the
   states.


## Review corrections — 2026-08-14 (PR #1256)

**The taxonomy was wrong.** I proposed splitting descriptor fields into
`isolation` vs `ergonomics`. The reviewer showed that several so-called
ergonomics fields are authority-sensitive: `allowPiExtensions`,
`httpWorkspaceScope`, `resolveCompanyContextFromHostWorkspace`, `sandboxHandle`.
Labelling them ergonomics would **hide** security weight — the opposite of the
goal. The correct split, adopted:

```
Descriptor mechanism facts
  pair, capabilities, roots, bash/filesystem, readiness

Host/deployment policy
  production admission, scope issuance, extensions,
  company-context access, provisioning, persistence
```

This is R-33-15's own test applied one level down, and it confirms the test by
finding a real mix: `SandboxRuntimeModeDescriptorV1` currently carries both
classes in one object. It is an authority-boundary refactor, not a nesting
change, and is tracked separately from PR #1256.

**My enforcement proposal violated my own test.** I recommended moving
`assertProductionAgentModeIsSafe` into `createAgentHost()`. That would have the
funnel infer deployment classification from ambient `NODE_ENV` — an agent minting
authority from its environment, exactly what this recommendation forbids.
`createAgentHost()` is a reusable mechanism (CLI, playgrounds, embedded hosts,
tests, full-app) and carries no deployment classification; enforcing there would
reject trusted local/direct deployments, and enforcing in
`createDescriptorRuntimeModeAdapter()` would miss Agent-owned V0 and custom
injected adapters. D28 assigns deployment policy to the host application, so
full-app is the correct owner today.

If universal enforcement is wanted, the correct shape is an **explicit
host-supplied runtime-admission policy passed into the funnel** — authority
handed in, never inferred. That deserves its own decision alongside D31.
