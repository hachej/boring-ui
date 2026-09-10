# OpenComputer interface reference — borrow the solved shape, keep Boring authority

> **Research/reference, not a provider decision or implementation claim.**
> Reviewed from [OpenComputer documentation](https://docs.opencomputer.dev/)
> on 2026-09-10. OpenComputer is evidence that several difficult runtime
> interfaces have a coherent implementation. Boring keeps its existing
> premises, mechanisms, canonical records and placement control; this document
> identifies interface behavior to reuse when sharpening them. It does not
> require using OpenComputer's hosted control plane, SDK or runtime.

## Owner direction

Do not restart the architecture around an external provider, and do not rebuild
mechanisms Boring already has merely to resemble the reference. Use the
reference to make our public contracts smaller, more complete and more
executable—particularly agent definitions, durable Sessions, events, browser
access, BYOK, repository access and remote creator execution.

OpenComputer's names do not override ours. In particular, its Session commonly
combines a durable conversation and a run of work; Boring retains Thread as the
durable job root, Session as one runtime conversation, and RunId := RequestKey
as accepted execution identity.

## Interface lessons

| OpenComputer's demonstrated surface | Interface lesson for Boring | Existing Boring home / delta |
| --- | --- | --- |
| Agent = reusable identity + runtime + model + deployed behavior | Keep the identity row small; deploy immutable behavior revisions; pin the selected revision for a Session | Agent definitions/digests and package lane exist; release pins exact definition digest; clarify SDK create/deploy/read surface |
| Minimal agent directory (`agent.toml`, prompt, optional skills) with additive rungs | A useful agent definition starts small; tools, knowledge, sources, schedules and custom runtime remain additive | `compileAgentDirectory`, instructions/skills/knowledge already exist; define a minimal public SDK facade rather than expose package internals |
| Session = append-only event log + pinned snapshot + lifecycle | Session API exposes ordered turns, status, steering, cancellation, archive and result; configuration is pinned and credential rotation remains revocable | Session/harness/gateway exist; durable-stream and restart work remains; preserve Boring's separate Thread/Run identities |
| `queued · running · awaiting_input · idle · failed · archived` and explicit yield reasons | Clients render typed lifecycle, never parse prose to infer completion | Reconcile with Boring Run/Session status and `unknown-outcome`; do not copy names until the state-machine grill |
| Sequence-addressed SSE and scoped browser token | Browser reconnects from a cursor without org authority; read and steer are independently scoped and expiring | Gateway streaming and bridge tokens exist; bind future tokens to installation/job/operation/digest and revocation epoch |
| Idempotent create, idempotent steer, natural-key get-or-create kept distinct from metadata | Retry identity, resource identity and routing metadata are different fields | RunId := RequestKey and request ledger already provide the authority spine; apply the distinction at Session/Thread ingress |
| Signed webhook destinations for background completion | Browser closure cannot own job completion; durable delivery is retried, inspectable and redeliverable | Activity/accepted-work path is Boring-owned; use the behavior as conformance inspiration, not a second callback ledger |
| Fixed runtime tools plus explicit user-level `say` and blocking `ask` | Separate user posts, progress, internal events and decisions in the protocol | Chat purity and decision cards proposed in SENECA-EXPERIENCE; map worker results to typed messages, artifacts, evidence and decisions |
| Registered repository sources resolved to exact revisions | Sources are stable references authorized separately from the agent definition | Multi-filesystem bindings and mounts exist; define source admission and revision pinning in the SDK |
| Private checkout and PR publication without exposing GitHub credentials | External effects are platform-mediated operations, not ambient shell credentials | Use Boring capabilities/approvals and credential broker; creator edits candidate source, host publishes under current authority |
| Sealed surrogate secret; real value substituted by host-side egress proxy; host restrictions | BYOK means the key never enters the agent computer, prompt, transcript or tool environment | A7/D27 and CREDENTIALS-AND-EGRESS; sharpen the invocation and surrogate interfaces instead of mounting auth files |
| Hardware VM, snapshots, checkpoints, hibernate/wake, preview URLs | Computer lease lifecycle is independently addressable and replaceable; preview access is authenticated outside generated code | D31 sandbox descriptors/providers and product runtime modes already exist; keep Session, lease and installed runtime separate |
| Agent deployment attempts, immutable successful revisions, active pointer and rollback | Attempt, immutable revision and activation are separate; failure history remains inspectable | Native-creation candidate/release/installation/activation lifecycle is richer and remains canonical |
| Limits on tokens, turns and wall clock with honest incomplete usage | Limits declare enforcement semantics and overshoot; missing measurement is unknown, not zero | Metering and budgets exist; add explicit enforcement and evidence semantics to spawn/Run contracts |

## Agent SDK shape to clarify

OpenComputer demonstrates that the external surface can be small even when the
runtime is sophisticated. The Boring runtime SDK should expose equivalent
responsibilities using Boring identities and authority:

```ts
// Definition lifecycle
agents.define(source)             // validate + digest, no activation
agents.deploy(agentId, source)    // immutable attempt/revision
agents.get(agentId)

// Durable runtime conversation
sessions.create({
  agent: AgentRef,
  thread?: ThreadId,
  input: MessageEnvelope,
  sources?: SourceRef[],
  limits?: RunLimits,
  metadata?: JsonValue,
  idempotencyKey: RequestKey,
})
sessions.events(sessionId, { after, level })
sessions.steer(sessionId, message, { idempotencyKey })
sessions.cancel(sessionId)
sessions.archive(sessionId)
sessions.result(sessionId)

// Delegation remains admitted work
spawn({ agent, thread, task, resources, grants, budget })
```

This sketch is explanatory, not a frozen TypeScript contract. The grill must
resolve object boundaries, state transitions and authority before an interface
lands. Existing `AgentGateway`, records, request ledger, filesystem bindings,
sandbox providers and metering are implementation inputs—not discarded code.

## Where Boring deliberately goes further

OpenComputer does not remove the need for Boring's product model:

- Workspace and Seat participation;
- Thread as a durable job across 0..n Sessions;
- actor ∩ installation ∩ job ∩ current-policy authority;
- effect-classed domain operations and durable approvals;
- artifacts and Views shared across chat, canvas and standalone Experiences;
- expert-software building blocks and personalization;
- candidate → Release → Installation → activation against a generation vector;
- installed product runtime distinct from the creator's computer;
- domain records and private working state surviving software rollback;
- host-selected `embedded`, `local` and `remote` placement;
- sovereign deployment and provider replaceability.

These are not reasons to reproduce OpenComputer's execution plumbing. They are
the Boring layer above and around the interface behavior it demonstrates.

## Documentation caveats found during review

Treat marketing and individual pages as evidence with boundaries:

- Built-in runtimes and Flue have materially different pinning, limit and
  recovery guarantees.
- Generic session token limits can overshoot by one model turn and are not
  enforced on the documented Flue path.
- Cancellation is cooperative and may wait for an in-flight call.
- Preview authentication is opt-in in the documented sandbox API.
- The networking pages describe behavior through different layers; an empty
  allowlist and a sandbox without an attached secret store must not be treated
  as universal evidence of default-deny without an execution-specific check.
- Secret-store allowlists are documented as unions when stores are layered;
  Boring authority must remain narrowing-only.

Therefore we copy no security claim from prose. Each adopted behavior requires
our own conformance test against every runtime mode.

## Consequence for the program

Before creating new runtime infrastructure, compare the relevant Boring seam to
this reference and choose one of three dispositions:

1. **retain** — our existing contract already expresses and proves the behavior;
2. **sharpen** — preserve the mechanism and improve its public interface or
   conformance evidence;
3. **fill** — implement a genuinely missing behavior through the existing seam.

“Replace Boring with OpenComputer” and “clone OpenComputer as a parallel stack”
are both rejected interpretations of this research.
