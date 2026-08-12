# Workspace agent packages

With `BORING_AGENT_FLEET=1`, a single-workspace host may discover an agent
definition from either the trusted repository's `.agents/personas/` packages
or a local package path registered in that workspace's
`.pi/settings.json#packages`. Registration makes an agent package discoverable.
It does not activate the agent: the class-B `.agents/factory/fleet.yaml` roster
must also seat the package's `boring.agent.definitionId`.

Agent fleet changes are boot-time changes. `/reload` can refresh ordinary
plugin resources, but installing, updating, seating, unseating, or removing an
agent requires restarting the workspace/CLI host.

The CLI workspaces hub has one Agent Host shared by every registered workspace.
Its global fleet therefore admits only personas from the trusted repository's
`.agents/personas/`; it does not admit agent definitions from any workspace's
local package registrations. Local packages keep their ordinary plugin
surfaces in their owning workspace. Seating workspace-local agent definitions
in workspaces mode requires a future workspace-scoped fleet boundary.

## Install and seat

From the workspace root, register a local package directory:

```bash
boring-ui-plugin install --local --workspace . ../agent-packages/my-agent
```

The package keeps all of its normal plugin surfaces. Its agent contribution is
still inert until the fleet roster names its definition id:

```yaml
seats:
  - seat: my-agent
    agentTypeId: my-agent-definition
    skills: []
```

Restart a single-workspace host with `BORING_AGENT_FLEET=1`. A valid seated
package appears in the agent catalog. An installed package without a matching
seat remains inert and reports `AGENT_DEFINITION_UNSEATED` during fleet
composition. The shared CLI workspaces hub never admits the local agent
contribution, even when the global roster names its definition id.

## Update

1. Update the source directory and bump both package/agent versions as needed.
2. For repository personas under `.agents/personas/`, run
   `pnpm write:skill-digests` from the repository root.
3. Restart the workspace/CLI host.

Digest refresh is intentionally repository-local in v1. The script reads only
`.agents/personas/`; it does not rewrite pins for agent packages installed from
another local directory. Such packages must already have matching
seat-authoritative skill pins. A mismatch excludes only that seat with
`AGENT_FLEET_SEAT_SKILL_DIGEST_MISMATCH`; the rest of the fleet still boots.

## Unseat or remove

To make a package inert but keep it installed, remove its seat from
`.agents/factory/fleet.yaml` and restart.

To remove its workspace registration as well:

```bash
boring-ui-plugin remove --local --workspace . my-agent-plugin-id
```

Then restart. If the roster still names the removed definition, that seat is
excluded with `AGENT_FLEET_SEAT_PERSONA_INVALID` while other agents boot.

## v1 distribution boundary

Repository personas may contribute agents to any fleet in v1. A
workspace-registered local package path may contribute an agent only to a
single-workspace host; it never enters the CLI workspaces hub's global fleet.
Git/npm package sources — including their materialized `.pi/git/` and
`.pi/npm/` directories — cannot contribute an agent until the
remote-distribution trust gate ships. All excluded packages' non-agent plugin
surfaces continue through the normal plugin pipeline unchanged.
