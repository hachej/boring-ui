# 6. Authority and isolation

## One funnel

Every agent session enters through one gateway contract and one
construction funnel. The host mints authority; an agent never mints its own
scope, and authored plugin selection cannot grant authority without a
host-owned allowlist. Execution of a product operation is authorized under
actor ∩ installation ∩ job ∩ current policy, computed by the host.

## Execution context and capabilities

Every governed operation carries an execution context that answers six
questions: who acts, in which workspace and installation, in which Thread and
Run, through which surface, under which approval, delegated by whom.
Capabilities are effect-classed — observe, propose, mutate, external effect
— with an authorize step and an execute step; unknown names fail closed;
external effects require an approval reference. The effective grant set is
an intersection of what the agent declares, what the workspace grants, what
the installation binds and what the Thread restricts; it never widens.

## Request-bound authority and revocation

Effect, data and readiness endpoints use short-lived authority bound to
audience, workspace, sandbox or installation, operation, digest and expiry.
Bridge tokens today are workspace-scoped, short-lived and refreshable, with
revocation on refresh tokens only; binding them to installation, job,
operation and digest, and revoking live calls by epoch, are open obligations. Revocation denies further reads, activation and
delivery; it cannot undo what was already disclosed. Model credentials are
issued per invocation as a capability, never as a raw key crossing a runtime
boundary, so a product's consumer never shares the curator's key and the
builder never bypasses the tenant's key policy.

## Sandboxes

A sandbox is a disposable environment lease. One session may hold several
bounded leases; each is its own isolation boundary with its own mutable
namespace under workspace authority; leases never share mutable backing. The
sovereign fleet runs on hardware virtualization (Firecracker class); a
managed provider is an explicit interim with bounded claims. Spawned
processes receive an allowlisted environment, never the host's.

## The untrusted tier and runtime modes

Authored code is admitted only through isolation plus explicit promotion.
Generated front code renders in an isolated frame with brokered
capabilities; generated server code runs inside the product runtime under
the modes defined in chapter 4 and is never imported into the host process
outside the default-off `embedded` mode. The host refuses server modules from
agent-writable roots by default. A `local` runtime binds the sandbox's
hardened profile — no egress by default, CPU, memory, process and disk
limits — not only an environment allowlist. For the first proof the
bwrap/runsc floor is accepted for `local`; a hardware microVM is required
before any shared-tenant deployment.

## Data sovereignty and history

Durable workspace storage is operator-controlled; publication is
control-plane enforced so tearing down a lease never silently destroys
unpublished work. Session history is the host application's user data on
its durable volume. Accepted-work identity, the destructive-publication
ledger and the binding-admission ledger are the reusable two-phase patterns
for any new activation receipt.

## Crosswalk

Implementation status lives only in [`CROSSWALK.md`](CROSSWALK.md).

| Section | Ruling |
|---|---|
| One gateway/funnel; host-minted scope | DECISIONS D29, D33; RECONCILIATION §13(d) |
| Execution context; capability effect classes; intersection | V2-PORT-HANDBOOK Supporting types, Capability; V2 spec L3 |
| Request-bound authority; bridge tokens; revocation | ARCHITECTURE-PLAN §6, Track A (A8); WORKSPACE_BRIDGE_V1; §11(c) |
| Model credentials per invocation | ARCHITECTURE-PLAN A7; DECISIONS D27 |
| Sandbox leases; Firecracker floor; env allowlist | DECISIONS D31 + addenda; ARCHITECTURE-PLAN A4 |
| Untrusted tier; runtime modes; P0.6 | ARCHITECTURE-PLAN D-b as superseded by §13(c); P0.6; D33 |
| `local` floor default for the first proof | DIRECTION 2026-09-07 owner defaults |
| Sovereignty; session history | D31; AGENTS.md rule 9 |
