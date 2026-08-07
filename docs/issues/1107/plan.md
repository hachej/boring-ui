---
github: https://github.com/hachej/boring-ui/issues/1107
issue: 1107
state: needs-owner-approval
updated: 2026-08-07
flag: rides BORING_AGENT_FLEET (no new flag)
---

# gh-1107 — agent definitions as plugin-shaped packages

## Problem

Agents are almost plugins but not quite. #1114 gave personas the plugin
manifest shape (`package.json#boring.agent` + `instructions.md`), and #1106
landed `loadConfiguredAgentFleet` (packages/agent/src/server/agentDefinition/)
reading `.agents/personas/` directly with skill digest pins in
`.agents/factory/fleet.yaml`. But the fleet loader is a bespoke discovery
path parallel to the plugin system's `BoringPluginAssetManager`
(packages/workspace/src/server/agentPlugins/), skills are named only in
`fleet.yaml` instead of the plugin-native `pi.skills`, and an agent cannot
carry its own knowledge. Two half-pipelines invite drift; the healio design
requires agent = installable, versioned, trusted package with knowledge.

## Solution

An agent definition IS a plugin package with an `agent` contribution:

- **Packaging**: today's persona package unchanged — `package.json` with
  `boring.agent` (`definitionId`, `version`, `label`, `instructionsRef`) +
  `instructions.md`. Additive fields only: `pi.skills` (existing plugin
  grammar) and an optional `knowledge/` folder. No format migration from the
  1106 manifest grammar (ratified).
- **Discovery** (ratified): via the plugin asset manager. `scan.ts` already
  treats any dir whose `package.json` has a `boring`/`pi` key as a plugin;
  the manifest validator gains the `boring.agent` contribution type, and
  `loadConfiguredAgentFleet` consumes asset-manager scan results instead of
  its own directory walk. `.agents/personas/**` becomes one more plugin root;
  compile/materialize primitives (`compileAgentDirectory`,
  `materializeAgentDirectory` symlink/containment guards) are reused as-is.
- **Skills via `pi.skills`** (ratified): the package declares its skills.
  Existing grammar (relative paths, preflight mustExist) keeps working for
  package-local skills; for the shared library (`.agents/skills/<name>/`),
  entries resolve by bare name against the workspace skill library — a
  documented widening applied uniformly for agent packages. Digest authority
  stays where 1106 put it: `fleet.yaml` becomes a pure name→digest pin map
  (authority only, no skill roster); composition verifies that every
  `pi.skills` entry has a matching, byte-true pin. `check:skill-digests` /
  `write:skill-digests` (scripts/refresh-skill-digests.mjs) repoint to walk
  persona packages for declarations and `fleet.yaml` for pins. Identity/
  authority split from 1106 holds unchanged.
- **`knowledge/` semantics**: an optional folder of files shipped inside the
  package. At composition it becomes a readonly filesystem binding scoped to
  that agent only: `RuntimeFilesystemBinding` (packages/agent
  server/runtime/mode.ts) gains an optional `provenance:
  'agent-definition'` field, surfaced in the environment's filesystem
  catalog. Content is versioned with the package (same digest discipline as
  instructions: `compileAgentDirectory` folds knowledge bytes into the
  definition digest). Generic ids only — no tenant names in core. Absent
  folder = no binding; other agents never see it.
- **Install / update in a workspace**: agent packages ride the existing
  plugin source machinery (packages/plugin-cli pluginSources: `local` |
  `git` | `npm`, registered in `.pi/settings.json#packages`). v1 supports
  repo-local packages (`.agents/personas/**`) plus local-source install of
  an agent package directory; update = replace/bump the package, rerun
  `write:skill-digests`, reboot — digest mismatch fail-closes that agent
  with a stable diagnostic while the rest of the fleet boots (1106
  behavior preserved). Remote (git/npm) agent install is a follow-up slice
  behind its own gate because it changes the trust story (see Owner
  decisions).

## Decisions

1. Discovery via `BoringPluginAssetManager`; the fleet loader's bespoke dir
   walk is deleted, not maintained (ratified).
2. Skills declared in `package.json#pi.skills` (ratified); `fleet.yaml`
   retained as authority-only digest pins (see Owner decision 1 for the
   alternative).
3. `knowledge/` = agent-scoped readonly fs binding, provenance
   `agent-definition`, versioned with the package (ratified concept).
4. No new flag; all behavior rides `BORING_AGENT_FLEET`. Flag off =
   byte-identical current behavior.
5. Fail-closed per package: schema/digest/preflight failure excludes that
   agent with a stable code; boot continues with the valid subset.

## Flag / Abstraction
- Needed?: no new flag — `BORING_AGENT_FLEET` already gates fleet
  composition end to end.
- Path: all changes live behind the loader/composition seam.
- Rollback: unset flag → single-agent boot, untouched.

## Test Seams
- Highest public seam: boot a server with a fixture agent package (manifest
  + `pi.skills` + `knowledge/`) → assert `/api/v1/agents` catalog, composed
  skill set, knowledge binding present in that agent's filesystem catalog
  and absent from a sibling agent's.
- Existing prior art: `loadConfiguredAgentFleet.test.ts` + fleet fixtures
  (`__tests__/fixtures/fleet/`), asset-manager scan/manifest tests,
  `factoryAgents.test.ts` (playground).
- Avoid testing: asset-manager internals (already covered), pi runtime,
  npm/git fetch paths (out of scope v1).

## Acceptance

1. The 5 factory personas are discovered via the plugin asset manager; the
   loader's bespoke persona directory walk is deleted.
2. Each persona's skills come from its `package.json#pi.skills`,
   digest-verified at composition against the authority pin map;
   `check:skill-digests` guards the new layout and CI stays green.
3. A persona with `knowledge/` gets a readonly, provenance-tagged fs binding
   visible only in that agent's environment.
4. An agent package installed via a local `.pi/settings.json` source appears
   in the fleet next boot; removing it (or a digest mismatch) excludes it
   fail-closed with a stable diagnostic.
5. Flag-off behavior byte-identical; playground keeps working through the
   same loader.

## Proof
- Exact command: `pnpm -C packages/agent test` (loader + composition
  suites), workspace plugin scan suite, `pnpm check:skill-digests`; boot
  smoke with fixture package asserting catalog + skills + knowledge binding.
- Screenshot/demo: playground agent selector showing the 5 seats; a chat
  where a seat answers from its knowledge file.
- Manual steps: run CLI hub with `BORING_AGENT_FLEET=1`, install a sample
  agent package locally, verify it appears; corrupt a digest, verify
  exclusion diagnostic.

## Slices

### Slice 1: discovery via asset manager + `pi.skills`
**Bead:** on approval
**Today:** `loadConfiguredAgentFleet` walks `.agents/personas/` itself;
skill names+digests both live in `fleet.yaml`; the asset manager knows
nothing about agent packages; `pi.skills` = relative paths only.
**Delta:** manifest validator learns `boring.agent`; loader consumes
asset-manager scan; the 5 personas gain `pi.skills` (bare-name resolution
against the shared skill library); `fleet.yaml` reduced to name→digest pins;
digest tooling repointed; bespoke walk deleted.
**Blocked by:** none (all substrate on main).
**Proof:** loader + scan suites, `check:skill-digests`, boot smoke.
**Review budget:** inside

### Slice 2: `knowledge/` as agent-scoped readonly fs
**Bead:** on approval
**Today:** `RuntimeFilesystemBinding` has no provenance; agents carry no
knowledge; definition digest covers instructions only.
**Delta:** optional `knowledge/` folder → readonly binding with
`provenance: 'agent-definition'`, folded into the definition digest; one
factory persona (steward) gains real knowledge content as the exemplar.
**Blocked by:** slice 1.
**Proof:** fixture-package boot smoke asserting binding presence/absence;
digest changes when knowledge bytes change.
**Review budget:** inside

### Slice 3: workspace install/update path
**Bead:** on approval
**Today:** fleet = whatever sits in `.agents/personas/`; plugin sources
(`.pi/settings.json#packages`, local/git/npm) exist but are not consulted
for agents; no documented update flow.
**Delta:** local-source agent packages from `.pi/settings.json` join
discovery through the same asset-manager scan; documented install/update/
remove flow (bump version → `write:skill-digests` → reboot); fail-closed
diagnostics for unknown/disabled packages.
**Blocked by:** slice 1 (parallel to slice 2).
**Proof:** install/remove/mismatch boot smokes; CLI-hub manual check.
**Review budget:** inside

## Out of Scope (non-goals)

- Remote distribution (git/npm install of agent packages) — follow-up slice
  with its own owner gate; trust model must be decided first.
- #1100 Agent Details UI (separate epic, sequenced after).
- #1087 per-agent MCP grants — plugs into the policy seam this creates.
- Any migration of the `boring.agent` manifest grammar (ratified: none).
- Roster/governance UI, multi-project rosters (#1056), Beadle automation.
- Knowledge editing/generation tooling; knowledge is authored bytes in v1.

## Owner decisions required

Only what code + ratified decisions cannot answer:

1. **Digest authority location.** Keep `fleet.yaml` as an authority-only
   pin map (recommended: preserves 1106's identity/authority split and its
   class-B "no agent class-A merge" guarantee), or delete `fleet.yaml` and
   move digests into each package's `pi.skills`, declaring
   `.agents/personas/**` permanently class B. One file fewer vs. authority
   colocated with agent-editable identity. Recommendation: keep the pin map.
2. **Roster source of truth.** Slice 3 makes discovery workspace-driven
   (`.agents/personas/` + local `.pi/settings.json` sources). Is
   "discovered = active" acceptable for v1, or do you want an explicit
   roster (per-workspace yaml / hosted governance config per #475) selecting
   which discovered agents boot? Recommendation: discovered = active in v1,
   roster provider as part of the hosted follow-up.
3. **Shared-skill embedding.** Bare-name `pi.skills` resolution keeps one
   copy of shared skills (recommended); the alternative — vendoring skill
   copies into each package for full self-containment — changes digest
   churn and library maintenance. Confirm the recommendation.

## Open Questions

None beyond the owner decisions above. Deviations surface at review; an
adversarial plan review runs before the owner gate — this plan does not
self-certify.
