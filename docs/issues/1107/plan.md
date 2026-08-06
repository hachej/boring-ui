---
github: https://github.com/hachej/boring-ui/issues/1107
issue: 1107
state: needs-owner-approval
updated: 2026-08-06
flag: rides BORING_AGENT_FLEET (no new flag)
---

# gh-1107 — agent definition as plugin package

## Problem

Agents are almost plugins but not quite: #1114 gave personas the plugin
manifest *shape* (`package.json#boring.agent`) but a bespoke reader, skills
come from a separate factory file (`fleet.yaml`) instead of the plugin-native
`pi.skills`, and agents have no knowledge folder, so an agent cannot carry its
own context the way the healio design requires. Two half-pipelines invite the
drift class we killed twice today.

## Solution

One pipeline: an agent definition IS a plugin package with an `agent`
contribution. Discovery through `BoringPluginAssetManager`; skills declared in
`package.json#pi.skills`; knowledge as an agent-scoped readonly filesystem.

## Decisions (all owner-ratified 2026-08-06)

1. **Discovery**: personas discovered by the plugin system's asset manager —
   the fleet loader's direct dir read is deleted, not maintained.
2. **Skills via `pi.skills`** in the agent package. Trust preserved as a
   *class* split: `.agents/personas/**` stays permanently class B, and digest
   pinning moves with the declaration (`check:skill-digests` repoints).
3. **`knowledge/`**: readonly filesystem binding, provenance
   `agent-definition`, versioned with the package, id per the healio
   provenance model (generic fs id — no tenant names in core, per the
   genericity rule).
4. **Roster** (which agents are active per workspace): mode-supplied provider
   with one loader contract — CLI reads the workspace-defining yaml; hosted
   reads tenant governance config (#475 machinery); playground reads its
   fixture. **No DB truth.**
5. **Distribution**: repo-local packages only in v1; npm/registry install is a
   follow-up slice with its own gate.
6. **Migration is atomic**: `fleet.yaml` dies in the same PR that moves skill
   declarations into the persona packages (zero external consumers; born
   2026-08-06).
7. **#1100 Agent Details stays a separate epic**, sequenced after — the
   read-only UI face of these packages.
8. **#1087 MCP grants**: out of scope; the per-agent policy seam this creates
   is where it plugs in.

## Today / Delta

- Today: loader reads personas dir directly; skills digest-pinned in
  fleet.yaml; no knowledge; roster = hardcoded factory 5 (playground) or
  legacy default.
- Delta: slices below.

## Test Seams
- Highest public seam: boot a server with a fixture agent package (manifest +
  pi.skills + knowledge/) → `/api/v1/agents` catalog + skill composition +
  knowledge binding visible in the environment's filesystem catalog.
- Prior art: `loadConfiguredAgentFleet` tests, `factoryAgents.test.ts`,
  packageResources tests (#970 substrate).
- Avoid testing: plugin asset-manager internals (covered), pi runtime.

## Acceptance

1. The 5 factory personas are discovered via the plugin asset manager; the
   bespoke persona reader is deleted.
2. Each persona's skills come from its `package.json#pi.skills`, digest-
   verified at composition; `fleet.yaml` no longer exists;
   `check:skill-digests` guards the new location.
3. A persona with `knowledge/` gets a readonly fs binding scoped to that
   agent (visible in its environment, absent from other agents').
4. Roster: CLI workspace yaml + hosted governance config + playground fixture
   all feed the same loader option; unknown/disabled packages excluded
   fail-closed with stable codes.
5. Flag-off behavior remains byte-identical (rides BORING_AGENT_FLEET).

## Proof
- Exact commands: loader + composition suites; fixture-package boot smoke
  asserting catalog, skills, knowledge binding; `check:skill-digests` green.
- Manual: playground — chat with a seat, ask about its knowledge file.

## Slices

### Slice 1: discovery + pi.skills + fleet.yaml removal
**Bead:** on approval
**Delivers:** decisions 1, 2, 6 — asset-manager discovery, package-declared
skills, atomic migration of the 5 personas, digest tooling repointed
**Blocked by:** #1114 on main (armed), #970 on main (loop closed, CI pending)
**Review budget:** inside

### Slice 2: knowledge/ as agent-scoped readonly fs
**Bead:** on approval
**Delivers:** decision 3; one factory persona gains real knowledge content as
the exemplar
**Blocked by:** slice 1
**Review budget:** inside

### Slice 3: roster providers (CLI yaml + hosted governance)
**Bead:** on approval
**Delivers:** decision 4; playground fixture provider migrates too
**Blocked by:** slice 1 (parallel to 2)
**Review budget:** inside

## Out of Scope

Install/registry distribution (follow-up slice, own gate), #1100 UI, #1087
MCP grants, Beadle automation, multi-project rosters (#1056).

## Open Questions

None — all material decisions ratified via grill (2026-08-06).
