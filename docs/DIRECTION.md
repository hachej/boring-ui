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

- **Chat streaming durability** (`0jpy.8` + `26v`, ONE lane; issue #1009):
  activate the dormant SqliteEventStreamStore. Trigger is explicit: `.31`'s
  concurrent streams + Seneca production chat. This is where Seneca hardening
  lives. Verified 2026-07-31: this is **wiring plus a read path**, not a build
  — the store and its consumer are both written, and no production caller
  passes `eventStore`. Resolve the agent-keying question (§Lane reality)
  BEFORE any durable schema is written.
- **F-graph execution begins** (Decision 28 detail: `docs/issues/391/plan.md`):
  F0b inventory → F1/F2 Environment contracts + boring-bash service → onward.
  F0a paperwork (the rebased #904 with its three shipped-reality amendments)
  is ratified during Wave 1; F1+ execution does NOT start before the Wave 1
  demo exists.

## Wave 3 — trigger: named consumers, not calendar

**BYOK and External MCP share one prerequisite** — a per-workspace credential
and registration substrate (§Lane reality). Whichever fires first builds it;
it is a named deliverable of this wave, not an implementation detail of
either lane. Sequence them adjacently.

- **BYOK** (KEY0 + parked PR #917; issue #1010): becomes load-bearing when
  multi-agent model costs are real. First step is ratifying the de-facto
  policy the shipped code implements. The `.30` model-cap revisit is
  MANDATORY here — it has no bead and nothing else forces it.
- **External MCP** (#900, re-land per #946: small reviewed slices,
  application-owned atomic backend; issue #1011): waits for its consumer —
  mail/tools for the CoS persona, or a client need. Do not re-land #937
  wholesale.
- **Authored catalog** (`0jpy.9`, includes fleet-time model-ID validation and
  maxTokensPerTurn enforcement): when personas become data.

## Wave 4 — v2 era

- **Sandbox/SBX1** (own-cloud runsc fleet; parked PR #916; issue #1012):
  infrastructure for remote/third-party agents. Trigger restated: after F7
  conformance. NOTE: two sandbox facts are true TODAY and are not Wave-4
  problems — see §Lane reality. Decide whether they wait for this wave.
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

## Lane reality (verified against `origin/main`, 2026-07-31)

Read this before dispatching any Wave 2–4 work. It is what the CODE does, not
what the plan folders say; where they disagree, this wins. Full evidence with
file paths lives in the lane issues (#1009 streaming, #1010 BYOK, #1011 MCP,
#1012 sandbox), each with a draft seed PR.

**The pattern: every lane is further built than its plan claims, and three of
four stop at the same missing layer — any way for a user to supply something**
(a key, a server URL, a trust decision). Infrastructure without an on-ramp.

| Lane | Today | The real delta |
|---|---|---|
| Streaming | In-memory ring buffer, NDJSON, correct reconnect. Level B holds — never a silent gap | Wiring + a durable read path. Store and consumer both written; nothing feeds them |
| BYOK | Encrypted `workspace_settings`; model keys come from process env **via Pi**, not from Boring | UI, store backend, authority verifier, and an **injection seam in the harness** — the hard one |
| MCP | Genuinely works: real SDK client, 7 tools live in the toolset, read-only by construction | Only 2 hardcoded providers. No user-supplied URL, no stdio/SSE, no per-server credentials |
| Sandbox | bwrap is real and used by full-app; Vercel Sandbox real; packages published | gVisor does not execute on main; `RemoteWorkerTransportV1` has no implementation |

**The shared substrate.** BYOK, MCP and sandbox converge on one missing
component: per-workspace credentials and registration. Evidence, not
architecture-astronomy: the encrypted settings table's only observed content
is MCP registration data (`__serverBoringMcpSourcesV1`); bead
`wt-391-forward-16f.7` wants BYOK migrated OFF that same table; and the frozen
credential contract's `sandbox-pipe`/`sandbox-tmpfs` delivery modes are stubs
on both ends. Streaming is the genuine exception — independent, and nearly
done.

**Parked PRs do not close their lanes.** #917 is storage+crypto only and
defers UI, lifecycle and resolver wiring by its own body. #916's body says do
not merge and its runsc isolation evidence is self-described as
non-admitting. Neither is a shortcut.

**Two sandbox facts true today, owned by no wave:** the CLI defaults to
`direct` — raw spawn, zero isolation — on every platform, with bwrap opt-in
behind `--mode local-sandbox`; and neither real backend isolates network
egress (bwrap defaults to `--share-net`). Defensible for a local dev tool the
user controls; wrong the moment anything less-trusted runs.

**Inert surfaces that read as working support** — fix or remove, do not build
on: `mcpServerRefs` on agent definitions is validated, frozen and
inventory-checked but never resolved into a connection; managed-agent MCP
ingress is hardcoded off in every released host.

**Streaming keying, decide before durable schema:** the buffer key is
`[sessionId, workspaceId, userId]` and the stream path is
`sessions/<sessionId>` — `agentTypeId` is in the URL but in neither. Not a
live defect (ids are minted unique; cross-agent addressing is rejected), but
durable rows would bake the omission in.

**Bookkeeping correction:** bead `0jpy.15` ("duplicate AgentLiveEventBuffer")
has a false premise — there is one such class with no external consumers. The
real duplication is two replay sources. Rewrite the bead before working it.

## Plan-folder map (what still binds)

| Folder | Status |
|---|---|
| `docs/issues/909/` | Frozen record of what shipped + follow-up beads. Binding for the Gateway contract (§6) |
| `docs/issues/391/` | Decision-28 detail for Waves 2+. Binding once its wave opens |
| `docs/issues/805/` | A1 shipped; remainder absorbed into 391's F-graph. Reference only |
| `docs/issues/808/`, `820/`, `806/`, `900/` | Lane detail for Waves 3–4. Reference until their trigger fires — but §Lane reality outranks them on what exists |

Lane tracking issues (each with a draft seed PR): #1009 streaming, #1010 BYOK,
#1011 external MCP, #1012 sandbox. Issues #820 and #808 are CLOSED; #1010 and
#1012 replace them as the tracking issues for their parked PRs.

Bead graph: epic `wt-391-forward-0jpy` follow-ups (Wave 1–2) + F-graph under
`wt-391-forward-step1a-current-xn9` (Wave 2+). Anything not reachable from
this file's waves is not dispatchable without an owner amendment here.
