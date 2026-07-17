# Historical forward plan

> **Status: historical / non-dispatchable.** This file formerly converged the
> D1/AgentHost implementation path. PR #794 later physically removed obsolete
> AgentHost assets under explicit owner direction.

The active replacement is [`../plan.md`](../plan.md), with durable supersession
recorded in [Decision 25](../../../DECISIONS.md#25-static-multi-agent-composition-after-agenthost-removal).

Do not use prior D1, AgentHost, CAS, controller, revision, publication,
active-collection, exact-host, or rollout sections as implementation input.
Git history and the linked PRs preserve the former analysis.

Current order:

```text
P0 plan reset
-> S1 static contract
-> S2 agent identity/session/provenance
-> S3 shared Workspace+Sandbox
-> S4 Core authorization/routing
-> S5 conformance + full-app freeze
-> R1 exact package release
-> N1 Seneca two-agent proof
```
