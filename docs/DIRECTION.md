# DIRECTION — the one spine

Owner-ratified 2026-07-27. This document is the single source of sequencing
truth for the platform. Every plan folder under `docs/issues/**` is DETAIL,
subordinate to this file: if an issue plan and this file disagree on what
happens next, this file wins until the owner amends it. Orchestrators dispatch
from the waves below — nothing else — regardless of what `br ready` surfaces.

## Vision (unchanged since #391)

A workspace where multiple agents — different models, different capabilities,
different costs — work for you in one console: a default deep-work agent
beside cheaper specialists, extensible toward authored agents (agents as
data), external capabilities via MCP, per-workspace keys, and eventually
third-party agents and a marketplace. The long-form vision persona is a
Chief-of-Staff agent managing issues, mail, and the boring-ui Inbox — that is
where this goes, not what we build next.

How-decisions along the way: Decision 26 (domain-routed workspaces) was
abandoned; Decision 28 (#889: application agent fleets, Workspace
orchestration, transport-neutral Environment service) is current. #909
delivered Decision 28's first construction segment.

## Built and released (do not re-plan this)

v0.1.91: the **AgentGateway v0** engine room — `createAgentHost()` single
construction funnel, `AgentFleetCompiler` fail-fast validation,
`EmbeddedAgentGateway` (frozen 7-method session contract, addressed HTTP
surface per agent), Environment leases, per-agent model policy
(`spec.model.preferred` + strict resolution), all five consumers (workspace,
core, CLI, playground, delegation) composing through it, enforced by CI
invariants. Also shipped: A1 authored-agent groundwork, boring-bash/sandbox
extraction, BYOK credential-injection contract, D1 tenant provisioning.
Authority for what exists: `docs/issues/909/plan.md` §6 (frozen).

## Wave 1 — NOW: the multi-agent console (beads .27 → .31)

Goal: **two agents, visibly, in one UI** — `default` plus a dummy second
agent on a cheaper model. Infra only; no persona content.

1. `wt-391-forward-0jpy.27` (in progress): browser wired to the addressed
   gateway routes — addressed reload-reconnect streams, dynamic agent
   selection from `GET /api/v1/agents`, full-app opt-in, two-agent fixture,
   E2E with a request-route assertion that fails on any legacy-wire use.
2. `wt-391-forward-0jpy.31`: the console UX — agent switcher, per-agent
   session grouping, presence, two agents streaming concurrently, switching
   without losing an in-flight turn.

**Done-bar: works in BOTH workspace-playground and full-app** (playground
green ≠ product works — the 0.1.91-era lesson). Supporting hygiene that lands
inside this wave as needed: `.29` (CSS build), `.26` (E2E in CI — minimal
slice absorbed by .27), `.28` (re-land native sessions + rename menu, after
.27), `.32` (full-app dev onboarding), `.33` (release smoke gate).

## Wave 2 — trigger: Wave 1 demo works

- **Chat streaming durability** (`0jpy.8` + `26v`, ONE lane): activate the
  dormant SqliteEventStreamStore. Trigger is explicit: `.31`'s concurrent
  streams + Seneca production chat. This is where Seneca hardening lives.
- **F-graph execution begins** (Decision 28 detail: `docs/issues/391/plan.md`):
  F0b inventory → F1/F2 Environment contracts + boring-bash service → onward.
  F0a paperwork (the rebased #904 with its three shipped-reality amendments)
  is ratified during Wave 1; F1+ execution does NOT start before the Wave 1
  demo exists.

## Wave 3 — trigger: named consumers, not calendar

- **BYOK** (KEY0 + parked PR #917): becomes load-bearing when multi-agent
  model costs are real. First step is ratifying the de-facto policy the
  shipped code implements.
- **External MCP** (#900, re-land per #946: small reviewed slices,
  application-owned atomic backend): waits for its consumer — mail/tools for
  the CoS persona, or a client need. Do not re-land #937 wholesale.
- **Authored catalog** (`0jpy.9`, includes fleet-time model-ID validation and
  maxTokensPerTurn enforcement): when personas become data.

## Wave 4 — v2 era

- **Sandbox/SBX1** (own-cloud runsc fleet; parked PR #916): infrastructure
  for remote/third-party agents. Trigger restated: after F7 conformance.
- **#905 v2 remote Host** (`0jpy.11`/`.16`): behind three gates — plugin
  trust cleanup (`.13`), the model-cap revisit (below), and an owner-recorded
  additive-v2 amendment.
- Marketplace-tier lanes (identity, billing, channels, catalog UX) stay
  frozen behind their existing owner gates.

## Decision log (owner, 2026-07-27)

| Decision | Ruling |
|---|---|
| Direction | Multi-agent console is the product thrust; Seneca is its first consumer, not a separate track |
| Demo fleet | `default` + dummy second agent (different model). CoS/personas = vision, not a current lane |
| Done-bar | Playground AND full-app |
| Model-policy cap (`.30`) | (a) caller's per-prompt model wins. MANDATORY revisit before the v2 remote tracer or BYOK, whichever first |
| F-graph | F0a paperwork now; F1+ execution frozen until the Wave 1 demo |
| Streaming | Enters exactly when multi-agent needs it (Wave 2 trigger), merged into one lane |

## Standing execution rules (earned this release cycle)

- Green CI is necessary, never sufficient: every wave's exit includes a real
  smoke of built artifacts (`.33` makes this a release gate).
- Tests must fail when the behavior is broken — no assertions on thrown
  objects where the client sees a different status; no fixtures that pass on
  empty output.
- One heavy executor at a time; independent review before merge; verify
  agent claims against `gh`/git ground truth, never against reports.

## Plan-folder map (what still binds)

| Folder | Status |
|---|---|
| `docs/issues/909/` | Frozen record of what shipped + follow-up beads. Binding for the Gateway contract (§6) |
| `docs/issues/391/` | Decision-28 detail for Waves 2+. Binding once its wave opens |
| `docs/issues/805/` | A1 shipped; remainder absorbed into 391's F-graph. Reference only |
| `docs/issues/808/`, `820/`, `806/`, `900/` | Lane detail for Waves 3–4. Reference until their trigger fires |

Bead graph: epic `wt-391-forward-0jpy` follow-ups (Wave 1–2) + F-graph under
`wt-391-forward-step1a-current-xn9` (Wave 2+). Anything not reachable from
this file's waves is not dispatchable without an owner amendment here.
