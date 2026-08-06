---
github: https://github.com/hachej/boring-ui/issues/1106
issue: 1106
state: needs-owner-approval
updated: 2026-08-06
flag: BORING_AGENT_FLEET (env, default off)
---

# gh-1106 slice 3 — config-driven production fleet loader

## Problem

The session plane supports N agents (#1045/#1102 chain) but production boots
one. The trust bridge (`createConfiguredAgentHostAgentSpec`) and authored
personas (`.agents/personas/*`) exist; only the playground composes a fleet
(`apps/workspace-playground/src/server/factoryAgents.ts`). Slices 1–2
(digest generator #1109, CI guard #1108) hardened the pinning that composition
relies on.

## Solution

Lift the playground's composition into a reusable, config-driven loader that
the production server (`createWorkspaceAgentServer` / CLI hub) invokes behind
a flag.

- **Source of truth** (ratified 2026-08-06, owner gate-1 round): personas are
  **plugin-shaped packages** — `.agents/personas/<seat>/package.json` with a
  `boring.agent` block (`definitionId`, `version`, `label`, `instructionsRef`)
  plus `instructions.md`. Same manifest grammar as every plugin (`boring.*` /
  `pi.*` namespaces); gh-1107 later adds `knowledge/` + packaging/registry with
  no format migration. Existing `agent.json` files migrate in this slice.
  Skill→seat digest bindings (authority) move OUT of playground code into
  `.agents/factory/fleet.yaml` (class B, workspace-editable), read by the
  loader alongside `policy.yaml` `models.seats` tiers (resolved via
  `docs/procedures/MODEL-CARD.md` at boot). An existing plugin (e.g.
  boring-macro if present) serves as manifest exemplar.
- **Authority**: per-seat `TrustedAuthoredAgentPolicy` — tools, filesystem
  bindings, skill allowlist with pinned digests (refreshed via #1109's
  `digests:write`). No authority in persona files (identity/authority split
  holds).
- **Loader**: `loadConfiguredAgentFleet(dir, policy)` in `packages/agent`
  (server), consumed by workspace app server and CLI. The playground migrates
  to it (deleting its bespoke `factoryAgents.ts` composition, keeping its
  fixtures) — one composition path, not two.
- **Failure mode**: fail-closed per agent — a persona that fails digest/schema
  validation is excluded with a stable diagnostic code; the server still boots
  with the valid subset (and always with the default agent).

## Decisions

1. Flag `BORING_AGENT_FLEET=1` gates fleet composition; absent = today's
   single-agent boot, byte-identical behavior.
2. Model tier → model ID resolution happens at boot, first *available* model
   in tier (availability = configured API key present), per MODEL-CARD
   priority order. No quota probing in v1.
3. Per-agent MCP grants (#1087) and agent-context filesystems (gh-1107) are
   explicitly out of scope — the loader exposes the policy seam they will
   plug into.

## Test Seams
- Highest public seam: boot the server with a fixture personas dir; assert
  `/api/v1/agents` catalog contents, per-agent instruction digests, exclusion
  diagnostics for an invalid persona.
- Existing prior art: `factoryAgents.test.ts` (migrates to the loader).
- Avoid testing: pi runtime internals; model availability probing.

## Acceptance

1. `BORING_AGENT_FLEET=1` boots the 5 factory seats from `.agents/personas/`
   in production server + CLI hub; `/api/v1/agents` lists them.
2. Flag off → current behavior byte-identical.
3. Invalid persona (bad digest/schema) → excluded, stable diagnostic, boot
   succeeds.
4. Playground uses the same loader (bespoke composition deleted).
5. Model per seat = policy.yaml tier resolved via MODEL-CARD priority.

## Proof
- Exact command: loader unit suite + a boot smoke with fixture personas
  asserting the catalog; playground E2E still green.
- Manual steps: run CLI hub with flag, open workspace, see 5 agents in the
  selector, chat with two different seats.

## Slices

### Slice: fleet-loader
**Bead:** to be created on approval (1 bead; splits only if review budget exceeded)
**Delivers:** loader + flag + playground migration + tests
**Blocked by:** none (works on current main; #1102's UI lands independently)
**Proof:** above
**Review budget:** inside (est. well under 1500 added lines)

## Out of Scope

- #1087 MCP grants, gh-1107 agent packaging, #1009 durability (auto-arms
  after this lands), Beadle automation, task-source registry (slice 4).

## Open Questions

None — deviations surface at review.
