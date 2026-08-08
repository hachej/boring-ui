---
github: https://github.com/hachej/boring-ui/issues/1107
issue: 1107
state: needs-owner-approval
updated: 2026-08-07
flag: rides BORING_AGENT_FLEET (no new flag)
---

# gh-1107 — agent definitions as plugin-shaped packages (r2)

r2 folds the adversarial review verdict (factory record): roster-gated
activation, explicit discovery seam, digest tooling derived from
declarations, definitionId conflict rule, skill-reference grammar.

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

An agent definition IS a plugin package with an `agent` contribution.
Discovery goes through the plugin asset manager; **activation stays
roster-gated**: a discovered persona package is inert until a class-B
`fleet.yaml` seat names it.

- **Packaging**: today's persona package unchanged — `package.json` with
  `boring.agent` (`definitionId`, `version`, `label`, `instructionsRef`) +
  `instructions.md`. Additive fields only: `pi.skills` (existing plugin
  grammar) and an optional `knowledge/` folder. No format migration from the
  1106 manifest grammar (ratified).
- **Discovery** (ratified) **and the dependency seam**: `packages/agent`
  cannot import `BoringPluginAssetManager` (workspace depends on agent, not
  the reverse). The workspace/CLI **boot layer** runs the asset-manager scan
  and injects the results — discovered-package descriptors (path, manifest,
  preflight status) — into `loadConfiguredAgentFleet`. The loader's own
  directory walk is deleted. Both hosts have the manager available today:
  `createWorkspaceAgentServer` (packages/workspace/src/app/server) and the
  CLI hub (`packages/cli/src/server/modeApps.ts` / `pluginDiscovery.ts`).
  Compile/materialize primitives (`compileAgentDirectory`,
  `materializeAgentDirectory` symlink/containment guards) are reused as-is.
- **Roster / activation** (review-resolved): `fleet.yaml` stays
  **seat-scoped** — `seat` + `agentTypeId` + skill digest pins, roughly
  today's shape — and remains the permanently class-B activation gate.
  Discovered ≠ active: only packages named by a seat boot. Skill *identity*
  moves to each package's `pi.skills`; `fleet.yaml` pins are the
  *authority* that composition verifies byte-true against the declared
  skills. Identity/authority split from 1106 holds. Hosted roster provider
  (#475 governance config) is a follow-up.
- **Skills via `pi.skills`** (ratified) with a grammar discriminator: an
  entry containing `/` is a package-relative path (existing plugin
  semantics, preflight mustExist); a bare token is a shared-library name
  resolved against `.agents/skills/<name>/`, reusing the loader's canonical
  skill-content path (symlink rejection + realpath containment). No
  vendoring of shared skills (ratified-by-review under this grammar).
  `check:skill-digests` / `write:skill-digests`
  (scripts/refresh-skill-digests.mjs) derive their expected-skill set from
  the persona `pi.skills` declarations — no hardcoded list.
- **`knowledge/` semantics**: an optional folder of files shipped inside the
  package. At composition it becomes a readonly filesystem binding scoped to
  that agent only: `RuntimeFilesystemBinding` (packages/agent
  server/runtime/mode.ts) gains an optional `provenance:
  'agent-definition'` field, surfaced in the environment's filesystem
  catalog. Knowledge bytes fold into the computed definition digest —
  identity is the **digest, not the version string** (churn is a non-issue:
  computed identity, no external pin). Generic ids only — no tenant names
  in core. Absent folder = no binding; other agents never see it.
- **Install / update in a workspace**: agent packages ride the existing
  plugin source machinery (packages/plugin-cli pluginSources: `local` |
  `git` | `npm`, registered in `.pi/settings.json#packages`). v1 supports
  repo-local packages (`.agents/personas/**`) plus local-source install of
  an agent package directory; installing makes it *discoverable* — it
  activates only when a class-B `fleet.yaml` seat names its definitionId.
  Update = replace/bump the package, rerun `write:skill-digests`, reboot;
  digest mismatch fail-closes that agent with a stable diagnostic while the
  rest of the fleet boots. **Digest-update tooling is scoped repo-local in
  v1**: refresh-skill-digests walks repo persona packages only; digest
  refresh for workspace-installed non-repo packages ships with the remote-
  distribution follow-up. Remote (git/npm) agent install is a follow-up
  slice behind its own gate (trust story changes).

## Decisions

1. Discovery via `BoringPluginAssetManager`, injected by the boot layer;
   `packages/agent` never imports workspace code; the loader's bespoke dir
   walk is deleted (ratified + F2 seam).
2. Activation is roster-gated by seat-scoped, class-B `fleet.yaml`
   (review-resolved F1). Discovered = inert until named by a seat.
3. Skills declared in `package.json#pi.skills` (ratified); `/` = path,
   bare = shared-library name (F5); digests pinned per seat in `fleet.yaml`.
4. `knowledge/` = agent-scoped readonly fs binding, provenance
   `agent-definition`, identity = computed digest (F6).
5. **definitionId conflict rule** (F4): two discovered packages claiming the
   same `definitionId` ⇒ **both fail-closed** with a stable error code
   (`AGENT_DEFINITION_ID_CONFLICT`); no "disabled" state exists — a package
   is active (seated), inert (discovered, unseated), or excluded (error).
6. No new flag; all behavior rides `BORING_AGENT_FLEET`. Flag off =
   byte-identical current behavior.
7. Fail-closed per package: schema/digest/preflight/conflict failure
   excludes that agent with a stable code; boot continues with the valid
   subset.

## Flag / Abstraction
- Needed?: no new flag — `BORING_AGENT_FLEET` already gates fleet
  composition end to end.
- Path: all changes live behind the loader/composition seam; scan injection
  is a loader option, so hosts opt in explicitly.
- Rollback: unset flag → single-agent boot, untouched.

## Test Seams
- Highest public seam: boot a server with a fixture agent package (manifest
  + `pi.skills` + `knowledge/`) seated in a fixture `fleet.yaml` → assert
  `/api/v1/agents` catalog, composed skill set, knowledge binding present in
  that agent's filesystem catalog and absent from a sibling agent's; assert
  an unseated discovered package does NOT boot; assert definitionId
  collision excludes both.
- Existing prior art: `loadConfiguredAgentFleet.test.ts` + fleet fixtures
  (`__tests__/fixtures/fleet/`), asset-manager scan/manifest tests,
  `factoryAgents.test.ts` (playground).
- Avoid testing: asset-manager internals (already covered), pi runtime,
  npm/git fetch paths (out of scope v1).

## Acceptance

1. The 5 factory personas are discovered via asset-manager scan results
   injected by the boot layer (workspace server + CLI hub); the loader's
   bespoke persona directory walk is deleted; no workspace import appears
   in `packages/agent`.
2. Each persona's skills come from its `package.json#pi.skills` (path vs
   bare-name grammar), digest-verified at composition against the
   seat-scoped `fleet.yaml` pins; a discovered-but-unseated package does
   not boot; `check:skill-digests` derives expectations from declarations
   and CI stays green.
3. A persona with `knowledge/` gets a readonly, provenance-tagged fs
   binding visible only in that agent's environment; its definition digest
   changes when knowledge bytes change.
4. An agent package installed via a local `.pi/settings.json` source
   becomes discoverable, and boots once seated in `fleet.yaml`; removal,
   digest mismatch, or definitionId conflict excludes fail-closed with
   stable diagnostics.
5. Flag-off behavior byte-identical; playground keeps working through the
   same loader.

## Proof
- Exact command: `pnpm -C packages/agent test` (loader + composition
  suites), workspace plugin scan suite, `pnpm check:skill-digests`; boot
  smoke with fixture package asserting catalog + skills + knowledge binding
  + unseated-inert + conflict exclusion.
- Screenshot/demo: playground agent selector showing the 5 seats; a chat
  where a seat answers from its knowledge file.
- Manual steps: run CLI hub with `BORING_AGENT_FLEET=1`, install a sample
  agent package locally, seat it, verify it appears; unseat it, verify
  inert; corrupt a digest, verify exclusion diagnostic.

## Slices

### Slice 1: discovery seam + `pi.skills` + roster gate
**Bead:** on approval
**Today:** `loadConfiguredAgentFleet` walks `.agents/personas/` itself;
skill names+digests both live in `fleet.yaml`; the asset manager knows
nothing about agent packages; `pi.skills` = relative paths only;
refresh-skill-digests carries its own skill list.
**Delta:** manifest validator learns `boring.agent`; boot layers
(workspace server, CLI hub) inject scan descriptors into the loader;
bespoke walk deleted; the 5 personas gain `pi.skills` (bare-name grammar);
`fleet.yaml` keeps seat + agentTypeId + digest pins (skill identity moves
out); definitionId conflict rule enforced; refresh-skill-digests derives
its expected set from `pi.skills` declarations.
**Blocked by:** none (all substrate on main).
**Proof:** loader + scan suites, `check:skill-digests`, boot smoke incl.
unseated-inert + conflict cases.
**Review budget:** inside

### Slice 2: `knowledge/` as agent-scoped readonly fs
**Bead:** on approval
**Today:** `RuntimeFilesystemBinding` has no provenance; agents carry no
knowledge; definition digest covers instructions only.
**Delta:** optional `knowledge/` folder → readonly binding with
`provenance: 'agent-definition'`, folded into the computed definition
digest (digest surfaced as identity, not version); one factory persona
(steward) gains real knowledge content as the exemplar.
**Blocked by:** slice 1.
**Proof:** fixture-package boot smoke asserting binding presence/absence;
digest changes when knowledge bytes change.
**Review budget:** inside

### Slice 3: workspace install/update path (repo-local digests)
**Bead:** on approval
**Today:** fleet = whatever sits in `.agents/personas/`; plugin sources
(`.pi/settings.json#packages`, local/git/npm) exist but are not consulted
for agents; no documented update flow.
**Delta:** local-source agent packages from `.pi/settings.json` join
discovery through the same injected scan; activation still requires a
`fleet.yaml` seat; documented install/seat/update/remove flow (bump →
`write:skill-digests` → reboot); fail-closed diagnostics for unknown or
conflicting packages. Digest-refresh tooling stays repo-local (honest v1
scope); non-repo digest refresh ships with remote distribution.
**Blocked by:** slice 1 (parallel to slice 2).
**Proof:** install/seat/unseat/remove/mismatch boot smokes; CLI-hub manual
check.
**Review budget:** inside

## Out of Scope (non-goals)

- Remote distribution (git/npm install of agent packages) and non-repo
  digest-refresh tooling — follow-up slice with its own owner gate.
- Hosted roster provider (#475 governance config) — follow-up; v1 roster is
  the class-B `fleet.yaml`.
- #1100 Agent Details UI (separate epic, sequenced after).

**Explicitly in-contract (owner-confirmed at gate):** a persona package is a
regular boring plugin and may carry any other plugin surface alongside
`boring.agent` — front assets/panes, `pi.*` declarations, server routes —
all flowing through the normal plugin pipeline unchanged. An agent can ship
its own UI enhancements in the same package. Only seat *activation* stays
roster-gated; the package's non-agent surfaces load like any plugin's.
- #1087 per-agent MCP grants — plugs into the policy seam this creates.
- Any migration of the `boring.agent` manifest grammar (ratified: none).
- Roster/governance UI, multi-project rosters (#1056), Beadle automation.
- Knowledge editing/generation tooling; knowledge is authored bytes in v1.

## Review-resolved decisions (r1 owner questions)

- Q1 digest authority: **resolved** — `fleet.yaml` retained, seat-scoped
  (roster + pins), permanently class B (F1).
- Q2 roster: **resolved** — discovered=active rejected; roster required in
  v1 via `fleet.yaml` seats; hosted roster provider is a follow-up (F1).
- Q3 shared skills: **ratified-by-review** — bare-name resolution, no
  vendoring, under the F5 grammar discriminator.

## Owner decisions required

None — all r1 questions were resolved by the adversarial review round;
remaining deviations surface at implementation review.

## Open Questions

None. An adversarial review preceded this revision; the owner gate is still
required — this plan does not self-certify.
