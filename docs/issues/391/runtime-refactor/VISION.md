# #391 vision — a workspace-first pluggable-agent platform

> Strategic direction only. [`../plan.md`](../plan.md) is the active delivery and
> dispatch authority. Historical files below this directory cannot override it.

## North star

A developer can define a focused agent declaratively, run it through an
authorized Boring workspace, ship it without editing platform packages, and
consume it through multiple surfaces while retaining clear identity,
provenance, policy, and EU-sovereign deployment options.

## Product principles

1. **Workspace-first authority.** A workspace and its membership model remain
   the live authorization boundary.
2. **One runtime owner.** Workspace and Sandbox compose as one lifecycle pair;
   agents attach to that pair rather than inventing parallel runtime owners.
3. **Static before dynamic.** Prove immutable startup composition before any
   install/update registry or control plane.
4. **Shared trust is explicit.** Agents in one workspace are logical children of
   the existing sole workspace-keyed runtime and share filesystem/runtime
   authority. Different prompts/tools are not a security boundary.
5. **Identity remains precise.** Routes, sessions, prompts, tools, receipts,
   logs, and artifacts identify the selected agent even when runtime is shared.
6. **Surfaces stay thin.** UI, MCP, HTTP, CLI, and future channels bind to the
   same workspace-backed behavior; they do not own the model loop.
7. **Packages stay acyclic.** Agent defines contracts and imports no runtime
   values; Workspace composes; Core authorizes; hosts supply concrete policy.
8. **Generality follows consumers.** New registries, transports, environments,
   providers, and marketplace behavior require a real named consumer.
9. **EU-sovereign operation remains possible.** US-hosted providers may be
   optional, never mandatory defaults.
10. **Existing user data survives.** On-disk Pi sessions and published package
    contracts are compatibility surfaces.

## Delivery horizons

### Horizon 1 — static multi-agent product proof

Reusable Core/Workspace/Agent packages support immutable startup agent
profiles. Full-app remains one hidden primary. Seneca proves two named agents in
one authorized workspace/runtime with distinct identity and intentional shared
filesystem visibility.

### Horizon 2 — richer agent capabilities

After the static proof, add only consumer-backed increments such as bounded
sandbox JSON tools and native agent-to-agent delegation. Each receives its own
plan, threat model, and proof.

### Horizon 3 — external distribution and platform expansion

MCP/artifacts, channels, marketplace/contracted-agent behavior, generic
environment attachment, provider extraction, mounts, and fleet/control-plane UX
remain possible directions. They are not implied prerequisites for Horizon 1.

## Explicitly retired first path

The deleted full-app AgentHost controller, revision/publication engine,
active-collection pointer, host reconciler, and CAS-like deployment path are not
part of the current architecture. Historical specifications remain for lessons
and provenance only.
