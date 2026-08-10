# Landing-surface reconciliation memo (#391)

**Status: RATIFIED 2026-08-08 — path A chosen; Decision 30 accepted.**
Owner ratified path A ("static deployment for now") on 2026-08-08; the draft
below is promoted to [Decision 30](../../DECISIONS.md#30-presentation-only-hostname--landing-surface).
The 7 obsolete D1 beads in section 5 were verified already closed in the
committed beads DB (closed 2026-07-17, superseded by Decision 25 / PR #794);
no bead edits were needed in the ratification PR.

This memo reconciles the deleted AgentHost landing surface with the current
Decision 25/28 architecture, proposes a draft Decision 30 for owner review,
compares two delivery paths, and lists governance and bead cleanup items.

## 1. Timeline

| Date | Event | Evidence |
| --- | --- | --- |
| 2026-07-15 | D1-006 EU three-binding proof landed | commit `510dce875`, PR [#783](https://github.com/hachej/boring-ui/pull/783): "#391 feat(d1): D1-006 three-binding EU-host proof + DR + runbook" |
| 2026-07-17 | AgentHost assets physically deleted | commit `454d06f3b`, PR [#794](https://github.com/hachej/boring-ui/pull/794): "remove obsolete AgentHost assets" — deployment implementation, proof scripts, deploy assets, including `apps/full-app/src/server/deployment/agentHostLanding.ts` and its tests |
| 2026-07-17 | Decision 25 accepted | rationale: the AgentHost path "created deployment and control-plane complexity before proving the simpler product need: statically composing multiple named agents over the existing authorized workspace runtime" |
| 2026-07-21 | Decision 26 superseded by Decision 28 | D26 header: "SUPERSEDED by Decision 28 (2026-07-21)" — domain-routed typed Workspaces are history, not a build target |

Net effect: the landing surface was deleted as *cargo* of the AgentHost
removal, not because any decision ruled against landing content itself.

## 2. Finding: bounded landing content per exact hostname is UNOWNED, not forbidden

- Decision 28's forbid-list is **authority-scoped**: it rejects "AgentHost,
  deployment/publication content-addressed storage, mutable registries,
  authored executable catalogs, and second behavior composers", and its
  re-evaluation clause forbids letting "signup domain/Agent
  identity/Environment capability grant membership" or restoring
  "AgentHost/controller/publication machinery". None of that speaks to
  serving static presentation content keyed by hostname.
- Decision 23 (itself superseded for topology) already characterized landing
  as "a surface mapping rather than an authorization mechanism".
- Decision 28 explicitly permits an "exact trusted signup-domain mapping" to
  initialize `defaultAgentTypeId` for a newly created default Workspace, while
  domain "has no continuing routing, membership, selection, or authorization
  effect and never rewrites an existing Workspace".

Conclusion: no current decision owns hostname-keyed landing presentation.
It is a gap, and closing it needs a new decision, not an amendment.

### Draft Decision 30 (proposed, for owner ratification)

A host application may declare a **presentation-only hostname → landing map**:

- Exact trusted hostnames in static deployment config (no wildcards, no
  registry, no runtime mutation).
- Bounded content per host: title, summary, optional CTA label
  (length-validated, HTML-escaped — the deleted renderer's constraints).
- The CTA links to the ordinary member sign-in flow only.
- Zero effect on membership, routing, agent selection, or rewriting of any
  persisted Workspace default. Hostname selects pixels, never authority.
- Decision 28's signup-domain initialization hook is retained unchanged and
  remains the *only* place hostname touches Workspace state.

## 3. Path comparison for the owner

### Option A — lean rebuild (recommended), ~6–8 PRs

1. Persist `default_agent_type_id` per Workspace — already a Decision 28
   requirement in its own right ("Every initialized Workspace durably
   persists `defaultAgentTypeId`").
2. Exact trusted signup-domain → default-agent-type mapping (D28 hook).
3. Config-driven landing surface, recovering the 54-line renderer from
   `454d06f3b^:apps/full-app/src/server/deployment/agentHostLanding.ts`
   (escape/validation/`cache-control: no-store` logic is directly reusable;
   its `activeReader`/revision plumbing is not).
4. Two fleet seats declared for two hostnames.
5. Deploy assets (compose/Caddy host entries) for the two hosts.

Small, decision-aligned, no superseded machinery restored.

### Option B — AgentHost revival

Revert-scale work: PR #794 deleted the controller path wholesale, and its own
rollback guidance says to "revert cleanup commit … or revert the PR merge as
a unit. Do not restore only partial controller wiring." Revival therefore
means restoring the whole controller/revision/publication stack and amending
Decisions 25 and 28, both of which explicitly reject it. Not recommended.

**Recommendation: Option A.**

## 4. Governance flags

1. **`docs/DIRECTION.md` is not on `main`.** It claims sequencing supremacy
   ("the single source of sequencing truth … if an issue plan and this file
   disagree … this file wins") and is marked owner-ratified 2026-07-27, but it
   exists only on branches (e.g. commit `2306eb86d`). Propose landing it on
   `main` so the ratified spine is where agents actually read.
2. **Decision 29 is still PROPOSED** ("awaiting owner ratification") while
   shipped architecture depends on it. Ratify or amend.

## 5. Bead cleanup (list only — do not edit the beads DB in this PR)

The following D1-004/D1-005/D1-006 beads describe AgentHost code deleted by
PR #794 and should be closed as obsolete under Decisions 25/28:

- `wt-391-forward-34u`
- `wt-391-forward-ea3`
- `wt-391-forward-wyr`
- `wt-391-forward-oi8`
- `wt-391-forward-3k7`
- `wt-391-forward-vup`
- `wt-391-forward-3vt`
