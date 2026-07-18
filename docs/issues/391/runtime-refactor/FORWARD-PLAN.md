# Historical forward plan

> **Status: historical / non-dispatchable.** This file formerly converged the
> D1/AgentHost implementation path. PR #794 later physically removed obsolete
> AgentHost assets under explicit owner direction.

The active replacement is [`../plan.md`](../plan.md), with current sequencing
recorded in [Decision 26](../../../DECISIONS.md#26-domain-routed-agent-workspaces-before-same-workspace-multi-agent-expansion).

Do not use prior D1, AgentHost, CAS, controller, revision, publication,
active-collection, exact-host, or rollout sections as implementation input.
Git history and the linked PRs preserve the former analysis.

Current order:

```text
1A.0 canonical plan and tracker reset
-> 1A.1 persist workspace type safely
-> 1A.2a static product declarations and trusted domain resolution
-> 1A.2b prove two-domain authentication topology
-> 1A.3a typed request context, route inventory, and Core selection
-> 1A.3b enforce typed context across every workspace surface
-> 1A.4a durable typed-create admission
-> 1A.4b idempotent provisioning and retry semantics
-> 1A.5 typed workspace frontend flow
-> 1A.6a select sole behavior and preserve one runtime lifecycle
-> 1A.6b materialize authored behavior and bind explicit tool catalog
-> 1A.7 agent session identity and history compatibility
-> 1A.8a reusable conformance and full-app freeze
-> 1A.8b qualify the typed-aware rollback floor
-> 1A.9 exact package cohort qualification and release
-> 1A.10a Seneca exact-pin two-product integration
-> 1A.10b Seneca production two-domain proof and executed rollback
```

Decision 26 supersedes the intervening same-workspace-first plan. See
[`../ROADMAP-ALIGNMENT.md`](../ROADMAP-ALIGNMENT.md) for later MCP, multi-agent,
durable transport, A2A, contractor, and runtime-package work.
